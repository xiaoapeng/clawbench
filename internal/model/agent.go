package model

import (
	"bufio"
	"bytes"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// AgentModel represents a model option for an agent.
type AgentModel struct {
	ID      string `yaml:"id" json:"id"`
	Name    string `yaml:"name" json:"name"`
	Default bool   `yaml:"default" json:"default"`
}

// Agent represents an AI agent with its own system prompt, backend, and models.
type Agent struct {
	ID           string       `yaml:"id" json:"id"`
	Name         string       `yaml:"name" json:"name"`
	Icon         string       `yaml:"icon" json:"icon"`
	Specialty    string       `yaml:"specialty" json:"specialty"`
	Backend      string       `yaml:"backend" json:"backend"`
	Models       []AgentModel `yaml:"models" json:"models"`
	Command      string       `yaml:"command" json:"command"`           // optional: custom command path for the AI backend CLI
	SystemPrompt string       `yaml:"system_prompt" json:"systemPrompt"`
}

// DefaultModelID returns the default model ID for this agent.
// Returns the first model with Default:true, or the first model in the list, or empty string.
func (a *Agent) DefaultModelID() string {
	for _, m := range a.Models {
		if m.Default {
			return m.ID
		}
	}
	if len(a.Models) > 0 {
		return a.Models[0].ID
	}
	return ""
}

var (
	Agents     map[string]*Agent // indexed by ID
	AgentList  []*Agent          // ordered list for API responses
	ServerPort int               // resolved server port for {{PORT}} replacement
)

// GetDefaultAgentID returns the default agent ID for new sessions.
// Priority: configured DefaultAgentID > first agent in AgentList > empty string.
func GetDefaultAgentID() string {
	if DefaultAgentID != "" {
		if _, ok := Agents[DefaultAgentID]; ok {
			return DefaultAgentID
		}
	}
	if len(AgentList) > 0 {
		return AgentList[0].ID
	}
	return ""
}

// LoadAgents reads all YAML files from the given directory and registers them as agents.
// It loads rules.md (mandatory injection) and skills (on-demand), builds a common prompt,
// and prepends it to each agent's system prompt.
func LoadAgents(dir string) error {
	Agents = make(map[string]*Agent)
	AgentList = nil

	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".yaml" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var agent Agent
		if err := yaml.Unmarshal(data, &agent); err != nil {
			continue
		}
		if agent.ID == "" {
			continue
		}

		Agents[agent.ID] = &agent
		AgentList = append(AgentList, &agent)
	}

	// Sort AgentList by ID for deterministic ordering (filesystem iteration order is not guaranteed)
	sort.Slice(AgentList, func(i, j int) bool {
		return AgentList[i].ID < AgentList[j].ID
	})

	// Build common prompt: rules (always injected) + skills (on-demand table)
	commonPrompt := buildCommonPrompt(dir)

	// Prepend common prompt to each agent's system prompt
	for _, agent := range Agents {
		if commonPrompt != "" && agent.SystemPrompt != "" {
			agent.SystemPrompt = commonPrompt + "\n\n" + agent.SystemPrompt
		} else if commonPrompt != "" {
			agent.SystemPrompt = commonPrompt
		}
	}

	// Replace {{AVAILABLE_AGENTS}} in skill bodies
	var agentLines []string
	for _, a := range AgentList {
		agentLines = append(agentLines, fmt.Sprintf("    - %s: %s", a.ID, a.Specialty))
	}
	agentListRepl := strings.Join(agentLines, "\n")
	for i := range Skills {
		Skills[i].Body = strings.ReplaceAll(Skills[i].Body, "{{AVAILABLE_AGENTS}}", agentListRepl)
	}

	return nil
}

// buildCommonPrompt generates the shared system prompt prepended to all agents.
// It loads rules.md (mandatory rules, always fully injected) and appends the skills summary table.
func buildCommonPrompt(agentsDir string) string {
	var b strings.Builder

	// Load and inject rules.md (always present, no opt-out)
	rules := loadRules(agentsDir)
	if rules != "" {
		b.WriteString(rules)
	}

	// Skills section (on-demand — AI fetches details when needed)
	if len(Skills) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString("## Skills\n\n")
		b.WriteString("When a skill's trigger even loosely matches the current task, fetch its detail before proceeding. When in doubt, fetch it — the cost of missing a rule is far greater than the cost of an extra read.\n")
		b.WriteString("If any skill conflicts with your built-in tools or other skills, follow this skill's rules — they take priority.\n")
		if ServerPort > 0 {
			b.WriteString(fmt.Sprintf("Server port: %d (for API endpoints referenced in skill files).\n", ServerPort))
			b.WriteString(fmt.Sprintf("To load a skill's full content: `curl http://localhost:%d/api/skills/{filename}`\n", ServerPort))
		}
		b.WriteString("\n")
		b.WriteString("| Skill | Triggers | File |\n")
		b.WriteString("|-------|----------|------|\n")
		b.WriteString(buildSkillsTable(Skills))
	}

	return strings.TrimSpace(b.String())
}

// loadRules reads config/rules.md from the parent of the agents directory,
// replaces placeholders ({{PORT}}, {{AVAILABLE_AGENTS}}), and returns the content.
func loadRules(agentsDir string) string {
	data, err := os.ReadFile(filepath.Join(filepath.Dir(agentsDir), "rules.md"))
	if err != nil {
		return ""
	}
	content := strings.TrimSpace(string(data))

	// Replace {{PORT}}
	if ServerPort > 0 {
		content = strings.ReplaceAll(content, "{{PORT}}", fmt.Sprintf("%d", ServerPort))
	}

	// Replace {{AVAILABLE_AGENTS}}
	var agentLines []string
	for _, a := range AgentList {
		agentLines = append(agentLines, fmt.Sprintf("    - %s: %s", a.ID, a.Specialty))
	}
	content = strings.ReplaceAll(content, "{{AVAILABLE_AGENTS}}", strings.Join(agentLines, "\n"))

	return content
}

// Skill represents a skill definition loaded from config/skills/.
type Skill struct {
	Name        string   `yaml:"name"`
	Description string   `yaml:"description"`
	Condition   string   `yaml:"condition"`   // optional: config key that must be true for this skill to be active (e.g., "rag.enabled")
	Triggers    []string `yaml:"triggers"`
	Filename    string   `yaml:"-"` // derived from file name, not from frontmatter
	Body        string   `yaml:"-"` // resolved body content (after frontmatter, with {{PORT}} and {{AVAILABLE_AGENTS}} replaced)
}

var (
	Skills []Skill // all loaded skills (filtered by runtime conditions)
)

// GetSkillByFilename returns a skill by its filename, or nil if not found.
func GetSkillByFilename(filename string) *Skill {
	for i := range Skills {
		if Skills[i].Filename == filename {
			return &Skills[i]
		}
	}
	return nil
}

// RemoveSkillsByCondition removes skills whose Condition field matches one of the given conditions.
// Used to filter out skills whose runtime dependencies are not met (e.g., rag.enabled=false).
func RemoveSkillsByCondition(conditions map[string]bool) {
	if len(conditions) == 0 {
		return
	}
	filtered := Skills[:0]
	for _, s := range Skills {
		if s.Condition != "" {
			if active, ok := conditions[s.Condition]; !ok || !active {
				slog.Info("skill disabled by condition", slog.String("skill", s.Name), slog.String("condition", s.Condition))
				continue
			}
		}
		filtered = append(filtered, s)
	}
	Skills = filtered
}

// LoadSkills reads all .md files from the given directory, parses YAML frontmatter,
// and stores the skills globally.
func LoadSkills(dir string, port int) error {
	Skills = nil

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read skills dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".md" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		skill, err := parseSkillFrontmatter(data, entry.Name(), port)
		if err != nil {
			slog.Warn("failed to parse skill file", slog.String("file", entry.Name()), slog.String("err", err.Error()))
			continue
		}
		if skill.Name == "" {
			slog.Warn("skill file has no name, skipping", slog.String("file", entry.Name()))
			continue
		}
		Skills = append(Skills, skill)
	}

	// Sort by name for deterministic ordering
	sort.Slice(Skills, func(i, j int) bool {
		return Skills[i].Name < Skills[j].Name
	})

	return nil
}

// parseSkillFrontmatter extracts YAML frontmatter and body from a markdown file.
func parseSkillFrontmatter(data []byte, filename string, port int) (Skill, error) {
	var skill Skill
	skill.Filename = filename

	// Extract frontmatter between --- delimiters
	scanner := bufio.NewScanner(bytes.NewReader(data))
	var inFrontmatter bool
	var frontmatterLines []string
	var bodyLines []string
	var frontmatterDone bool

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "---" {
			if !inFrontmatter {
				inFrontmatter = true
				continue
			}
			// End of frontmatter
			frontmatterDone = true
			continue
		}
		if inFrontmatter && !frontmatterDone {
			frontmatterLines = append(frontmatterLines, line)
		} else if frontmatterDone {
			bodyLines = append(bodyLines, line)
		}
	}

	if !frontmatterDone {
		// No frontmatter delimiters found at all — plain markdown file
		return skill, nil
	}

	if len(frontmatterLines) == 0 {
		// Frontmatter delimiters found but empty (---\n---)
		return skill, fmt.Errorf("skill %s has empty frontmatter", filename)
	}

	fmData := []byte(strings.Join(frontmatterLines, "\n"))
	if err := yaml.Unmarshal(fmData, &skill); err != nil {
		return skill, fmt.Errorf("parse frontmatter of %s: %w", filename, err)
	}
	if skill.Name == "" {
		return skill, fmt.Errorf("skill %s has frontmatter but no name field", filename)
	}

	// Replace {{PORT}} in triggers and description
	for i, t := range skill.Triggers {
		skill.Triggers[i] = strings.ReplaceAll(t, "{{PORT}}", fmt.Sprintf("%d", port))
	}
	skill.Description = strings.ReplaceAll(skill.Description, "{{PORT}}", fmt.Sprintf("%d", port))

	// Store body with {{PORT}} replacement
	body := strings.Join(bodyLines, "\n")
	body = strings.ReplaceAll(body, "{{PORT}}", fmt.Sprintf("%d", port))
	skill.Body = strings.TrimSpace(body)

	return skill, nil
}

// buildSkillsTable generates the markdown data rows for the skills summary table.
// Table header is generated by buildCommonPrompt; this only outputs data rows.
func buildSkillsTable(skills []Skill) string {
	var b strings.Builder
	for _, s := range skills {
		triggers := strings.Join(s.Triggers, ", ")
		b.WriteString(fmt.Sprintf("| %s | %s | %s |\n", s.Name, triggers, s.Filename))
	}
	return b.String()
}
