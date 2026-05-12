package cli

import (
	"fmt"
	"os"

	"clawbench/internal/model"
	"clawbench/internal/service"
)

var migrateHelp = HelpInfo{
	Usage:       "clawbench migrate",
	Description: "One-time migration: move task execution content into chat sessions. Run this on an existing database before deploying the new binary.",
}

// executionRow holds data read from the old task_executions table.
type executionRow struct {
	ID          int64
	TaskID      string
	Content     string
	TriggerType string
	CreatedAt   string
}

// RunMigrateCommand handles the 'clawbench migrate' subcommand.
func RunMigrateCommand(args []string) int {
	if len(args) > 0 && (args[0] == "--help" || args[0] == "-h") {
		printHelp(migrateHelp)
		return 0
	}

	loadConfig()
	service.InitDB()

	// Check if migration is needed: does task_executions have a 'content' column?
	var hasContentCol int
	err := service.DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('task_executions') WHERE name='content'").Scan(&hasContentCol)
	if err != nil {
		return outputError("failed to check schema: " + err.Error())
	}
	if hasContentCol == 0 {
		fmt.Println("No migration needed — schema is already up to date.")
		return 0
	}

	// Check if session_id already exists (partial migration)
	var hasSessionIDCol int
	service.DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('task_executions') WHERE name='session_id'").Scan(&hasSessionIDCol)
	if hasSessionIDCol > 0 {
		fmt.Println("No migration needed — session_id column already exists.")
		return 0
	}

	// Ensure chat_sessions has session_type column
	var hasSessionType int
	service.DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('chat_sessions') WHERE name='session_type'").Scan(&hasSessionType)
	if hasSessionType == 0 {
		if _, err := service.DB.Exec("ALTER TABLE chat_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'chat'"); err != nil {
			return outputError("failed to add session_type column: " + err.Error())
		}
		fmt.Println("Added session_type column to chat_sessions.")
	}

	// Add session_id column to old task_executions for tracking
	if _, err := service.DB.Exec("ALTER TABLE task_executions ADD COLUMN session_id TEXT NOT NULL DEFAULT ''"); err != nil {
		return outputError("failed to add session_id column: " + err.Error())
	}

	// Read all execution rows into memory first to avoid holding a read lock
	// while writing (MaxOpenConns=1 would deadlock otherwise)
	rows, err := service.DB.Query("SELECT id, task_id, content, trigger_type, created_at FROM task_executions")
	if err != nil {
		return outputError("failed to query task_executions: " + err.Error())
	}
	var executions []executionRow
	for rows.Next() {
		var ex executionRow
		if err := rows.Scan(&ex.ID, &ex.TaskID, &ex.Content, &ex.TriggerType, &ex.CreatedAt); err != nil {
			fmt.Fprintf(os.Stderr, "  skipping row: scan error: %v\n", err)
			continue
		}
		executions = append(executions, ex)
	}
	rows.Close()

	migrated := 0
	skipped := 0
	for _, ex := range executions {
		// Look up task for metadata
		var taskName, agentID, prompt, projectPath string
		err := service.DB.QueryRow(
			"SELECT name, agent_id, prompt, project_path FROM scheduled_tasks WHERE id = ?", ex.TaskID,
		).Scan(&taskName, &agentID, &prompt, &projectPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  skipping exec %d: task %s not found\n", ex.ID, ex.TaskID)
			skipped++
			continue
		}

		// Resolve backend from agent config
		backend := "codebuddy"
		loadConfig() // ensure agents are loaded
		if agent, ok := model.Agents[agentID]; ok && agent.Backend != "" {
			backend = agent.Backend
		}

		// Create chat session
		sessionID, err := service.CreateSession(projectPath, backend, taskName, agentID, "", "default", "scheduled")
		if err != nil {
			fmt.Fprintf(os.Stderr, "  skipping exec %d: failed to create session: %v\n", ex.ID, err)
			skipped++
			continue
		}

		// Write user message
		service.AddChatMessage(projectPath, backend, sessionID, "user", prompt, nil, false, taskName)

		// Write assistant message (if content exists)
		if ex.Content != "" {
			service.AddChatMessage(projectPath, backend, sessionID, "assistant", ex.Content, nil, false, "")
		}

		// Update session_id in the old row
		service.DB.Exec("UPDATE task_executions SET session_id = ? WHERE id = ?", sessionID, ex.ID)

		migrated++
		fmt.Fprintf(os.Stderr, "  migrated exec %d -> session %s\n", ex.ID, sessionID)
	}

	// Apply new schema: rename old → create new → copy data → drop old
	fmt.Println("Applying new schema...")
	service.DB.Exec("ALTER TABLE task_executions RENAME TO task_executions_old")
	service.DB.Exec(`CREATE TABLE task_executions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		task_id TEXT NOT NULL,
		session_id TEXT NOT NULL,
		trigger_type TEXT NOT NULL DEFAULT 'auto',
		status TEXT NOT NULL DEFAULT 'completed',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`)
	_, err = service.DB.Exec(`INSERT INTO task_executions (id, task_id, session_id, trigger_type, status, created_at)
		SELECT id, task_id, session_id, trigger_type, 'completed', created_at FROM task_executions_old`)
	if err != nil {
		return outputError("failed to copy data to new schema: " + err.Error())
	}
	service.DB.Exec("DROP TABLE task_executions_old")
	service.DB.Exec("CREATE INDEX IF NOT EXISTS idx_executions_task ON task_executions(task_id, created_at DESC)")
	service.DB.Exec("CREATE INDEX IF NOT EXISTS idx_executions_session ON task_executions(session_id)")

	fmt.Printf("Migration complete: %d executions migrated, %d skipped.\n", migrated, skipped)
	return 0
}
