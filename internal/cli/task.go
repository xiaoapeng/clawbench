package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"clawbench/internal/model"
	"clawbench/internal/service"

	"gopkg.in/yaml.v3"
)

// RunTaskCommand dispatches "clawbench task <subcommand>" CLI invocations.
func RunTaskCommand(args []string) int {
	if len(args) == 0 {
		fmt.Fprintf(os.Stderr, "Usage: clawbench task <create|update|delete|pause|resume|trigger> [options]\n")
		return 1
	}

	// Initialize config and database (same logic as cmd/server/main.go)
	absBinPath, _ := filepath.Abs(os.Args[0])
	model.BinDir = filepath.Dir(absBinPath)

	var cfg model.Config
	var presence map[string]bool
	configPath := filepath.Join(model.BinDir, "config", "config.yaml")
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		configPath = filepath.Join("config", "config.yaml")
		if _, err := os.Stat(configPath); os.IsNotExist(err) {
			configPath = filepath.Join(model.BinDir, "config.yaml")
			if _, err := os.Stat(configPath); os.IsNotExist(err) {
				configPath = "config.yaml"
			}
		}
	}

	data, err := os.ReadFile(configPath)
	if err == nil {
		var raw map[string]any
		if err := yaml.Unmarshal(data, &raw); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to parse config: %v\n", err)
			return 1
		}
		presence = model.ParsePresenceMap(raw)
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to parse config: %v\n", err)
			return 1
		}
	}
	model.ApplyDefaults(&cfg, presence)
	model.ConfigInstance = cfg

	if err := service.InitDB(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize database: %v\n", err)
		return 1
	}

	scheduler := service.NewScheduler()
	if err := scheduler.LoadTasksFromDB(""); err != nil {
		slog.Warn("failed to load existing tasks from DB", slog.String("error", err.Error()))
	}
	service.GlobalScheduler = scheduler

	// Dispatch to subcommand
	switch args[0] {
	case "create":
		return runCreate(args[1:])
	case "update":
		return runUpdate(args[1:])
	case "delete":
		return runDelete(args[1:])
	case "pause":
		return runPause(args[1:])
	case "resume":
		return runResume(args[1:])
	case "trigger":
		return runTrigger(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand: %s\n", args[0])
		fmt.Fprintf(os.Stderr, "Usage: clawbench task <create|update|delete|pause|resume|trigger> [options]\n")
		return 1
	}
}

func outputJSON(v any) {
	b, _ := json.Marshal(v)
	fmt.Println(string(b))
}

func outputError(msg string) int {
	outputJSON(map[string]any{"ok": false, "error": msg})
	return 1
}

func outputTask(task *model.ScheduledTask) int {
	outputJSON(map[string]any{"ok": true, "task": task})
	return 0
}

func flagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	return fs
}

func runCreate(args []string) int {
	// Anti-recursion: scheduled executions cannot create new tasks
	if os.Getenv("CLAWBENCH_SCHEDULED") == "1" {
		return outputError("scheduled execution cannot create new tasks")
	}

	fs := flagSet("create")
	name := fs.String("name", "", "Task name (required)")
	cronExpr := fs.String("cron", "", "Cron expression (required)")
	agentID := fs.String("agent", "", "Agent ID (required)")
	prompt := fs.String("prompt", "", "Prompt for each execution (required)")
	repeatMode := fs.String("repeat", "unlimited", "Repeat mode: once|limited|unlimited")
	maxRuns := fs.Int("max-runs", 0, "Max runs (required when repeat=limited)")
	fs.Parse(args)

	if *name == "" || *cronExpr == "" || *agentID == "" || *prompt == "" {
		return outputError("missing required fields: --name, --cron, --agent, --prompt")
	}
	if *repeatMode != "once" && *repeatMode != "limited" && *repeatMode != "unlimited" {
		return outputError("invalid --repeat: must be once|limited|unlimited")
	}
	if *repeatMode == "limited" && *maxRuns <= 0 {
		return outputError("--max-runs required when --repeat=limited")
	}

	task := &model.ScheduledTask{
		ProjectPath: model.ConfigInstance.WatchDir,
		Name:        *name,
		CronExpr:    *cronExpr,
		AgentID:     *agentID,
		Prompt:      *prompt,
		RepeatMode:  *repeatMode,
		MaxRuns:     *maxRuns,
	}

	if err := service.GlobalScheduler.AddTask(task); err != nil {
		return outputError(fmt.Sprintf("failed to create task: %v", err))
	}

	return outputTask(task)
}

func runUpdate(args []string) int {
	fs := flagSet("update")
	name := fs.String("name", "", "Task name")
	cronExpr := fs.String("cron", "", "Cron expression")
	agentID := fs.String("agent", "", "Agent ID")
	prompt := fs.String("prompt", "", "Prompt")
	repeatMode := fs.String("repeat", "", "Repeat mode: once|limited|unlimited")
	maxRuns := fs.Int("max-runs", -1, "Max runs")
	fs.Parse(args)

	remaining := fs.Args()
	if len(remaining) == 0 {
		return outputError("task ID required")
	}
	taskID := remaining[0]

	task, err := service.GetTaskByID(taskID)
	if err != nil {
		return outputError(fmt.Sprintf("task not found: %v", err))
	}

	if *name != "" {
		task.Name = *name
	}
	if *cronExpr != "" {
		task.CronExpr = *cronExpr
	}
	if *agentID != "" {
		task.AgentID = *agentID
	}
	if *prompt != "" {
		task.Prompt = *prompt
	}
	if *repeatMode != "" {
		if *repeatMode != "once" && *repeatMode != "limited" && *repeatMode != "unlimited" {
			return outputError("invalid --repeat: must be once|limited|unlimited")
		}
		task.RepeatMode = *repeatMode
	}
	if *maxRuns >= 0 {
		task.MaxRuns = *maxRuns
	}

	if err := service.GlobalScheduler.UpdateTask(task); err != nil {
		return outputError(fmt.Sprintf("failed to update task: %v", err))
	}

	return outputTask(task)
}

func runDelete(args []string) int {
	fs := flagSet("delete")
	fs.Parse(args)

	remaining := fs.Args()
	if len(remaining) == 0 {
		return outputError("task ID required")
	}
	taskID := remaining[0]

	task, err := service.GetTaskByID(taskID)
	if err != nil {
		return outputError(fmt.Sprintf("task not found: %v", err))
	}

	service.GlobalScheduler.RemoveTask(taskID)
	return outputTask(task)
}

func runPause(args []string) int {
	fs := flagSet("pause")
	fs.Parse(args)

	remaining := fs.Args()
	if len(remaining) == 0 {
		return outputError("task ID required")
	}
	taskID := remaining[0]

	service.GlobalScheduler.PauseTask(taskID)

	task, err := service.GetTaskByID(taskID)
	if err != nil {
		return outputError(fmt.Sprintf("task not found: %v", err))
	}
	return outputTask(task)
}

func runResume(args []string) int {
	fs := flagSet("resume")
	fs.Parse(args)

	remaining := fs.Args()
	if len(remaining) == 0 {
		return outputError("task ID required")
	}
	taskID := remaining[0]

	if err := service.GlobalScheduler.ResumeTask(taskID); err != nil {
		return outputError(fmt.Sprintf("failed to resume task: %v", err))
	}

	task, err := service.GetTaskByID(taskID)
	if err != nil {
		return outputError(fmt.Sprintf("task not found: %v", err))
	}
	return outputTask(task)
}

func runTrigger(args []string) int {
	fs := flagSet("trigger")
	fs.Parse(args)

	remaining := fs.Args()
	if len(remaining) == 0 {
		return outputError("task ID required")
	}
	taskID := remaining[0]

	task, err := service.GetTaskByID(taskID)
	if err != nil {
		return outputError(fmt.Sprintf("task not found: %v", err))
	}

	if err := service.GlobalScheduler.TriggerTask(taskID); err != nil {
		return outputError(fmt.Sprintf("failed to trigger task: %v", err))
	}

	return outputTask(task)
}
