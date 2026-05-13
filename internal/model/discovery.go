package model

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// BackendSpec defines a known AI backend for auto-discovery.
type BackendSpec struct {
	ID         string // agent id, e.g. "claude"
	Backend    string // backend type, e.g. "claude"
	DefaultCmd string // command to detect on PATH, e.g. "claude"
	Name       string // display name, e.g. "Claude"
	Icon       string // emoji icon, e.g. "🤖"
	Specialty  string // short description, e.g. "代码编写与推理"
}

// BackendRegistry lists all known AI backends for auto-discovery.
// When no agent configs exist, each entry is checked: if DefaultCmd
// is found on PATH, a YAML config is generated for that backend.
var BackendRegistry = []BackendSpec{
	{ID: "claude", Backend: "claude", DefaultCmd: "claude", Name: "Claude", Icon: "🤖", Specialty: "代码编写与推理"},
	{ID: "codebuddy", Backend: "codebuddy", DefaultCmd: "codebuddy", Name: "Codebuddy", Icon: "🐛", Specialty: "全栈开发助手"},
	{ID: "opencode", Backend: "opencode", DefaultCmd: "opencode", Name: "OpenCode", Icon: "📟", Specialty: "终端编码工具"},
	{ID: "gemini", Backend: "gemini", DefaultCmd: "gemini", Name: "Gemini", Icon: "💎", Specialty: "多模态推理"},
	{ID: "codex", Backend: "codex", DefaultCmd: "codex", Name: "Codex", Icon: "🐙", Specialty: "OpenAI 编码代理"},
	{ID: "qoder", Backend: "qoder", DefaultCmd: "qodercli", Name: "Qoder", Icon: "⚡", Specialty: "AI 编码助手"},
	{ID: "vecli", Backend: "vecli", DefaultCmd: "vecli", Name: "VeCLI", Icon: "🌿", Specialty: "字节跳动 AI 助手"},
	{ID: "deepseek", Backend: "deepseek", DefaultCmd: "deepseek", Name: "DeepSeek", Icon: "🔍", Specialty: "DeepSeek 推理与编码"},
}

// CheckCLIExists runs `cmd --version` with a 5-second timeout.
// Returns true if the command exits with code 0.
func CheckCLIExists(cmd string) bool {
	if cmd == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := exec.CommandContext(ctx, cmd, "--version").Run()
	return err == nil
}

// GenerateAgentYAML creates a YAML config for the given backend spec.
// models and system_prompt are left empty; command is omitted.
func GenerateAgentYAML(spec BackendSpec) ([]byte, error) {
	agent := Agent{
		ID:           spec.ID,
		Name:         spec.Name,
		Icon:         spec.Icon,
		Specialty:    spec.Specialty,
		Backend:      spec.Backend,
		Models:       []AgentModel{},
		SystemPrompt: "",
	}
	return yaml.Marshal(agent)
}

// DiscoverAgents scans the system for installed AI CLI tools and generates
// agent YAML configs in the given directory. It only runs when no agent
// configs exist (one-time generation).
//
// For each backend in BackendRegistry, it runs `{DefaultCmd} --version`
// concurrently. If the command succeeds, it writes a YAML file.
// Existing files are not overwritten.
func DiscoverAgents(dir string) error {
	// Ensure directory exists
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create agents directory: %w", err)
	}

	// Check all CLIs concurrently
	type result struct {
		spec   BackendSpec
		exists bool
	}
	results := make([]result, len(BackendRegistry))
	var wg sync.WaitGroup
	for i, spec := range BackendRegistry {
		wg.Add(1)
		go func(i int, spec BackendSpec) {
			defer wg.Done()
			results[i] = result{spec: spec, exists: CheckCLIExists(spec.DefaultCmd)}
		}(i, spec)
	}
	wg.Wait()

	generated := 0
	skipped := 0

	for _, r := range results {
		yamlPath := filepath.Join(dir, r.spec.ID+".yaml")

		// Don't overwrite existing files
		if _, err := os.Stat(yamlPath); err == nil {
			continue
		}

		if !r.exists {
			skipped++
			continue
		}

		data, err := GenerateAgentYAML(r.spec)
		if err != nil {
			skipped++
			continue
		}

		if err := os.WriteFile(yamlPath, data, 0644); err != nil {
			skipped++
			continue
		}

		generated++
	}

	return nil
}
