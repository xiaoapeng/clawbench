package ai

import (
	"os"
	"os/exec"
)

// piBackend is the CLIBackend instance for Pi CLI.
var piBackend = &CLIBackend{
	name:           "pi",
	defaultCommand: "pi",
	buildArgs:      buildPiStreamArgs,
	newParser:      func() LineParser { return &PiStreamParser{} },
	filterLine:     nil,
	preStart:       piPreStart,
}

// piPreStart injects environment variables needed by Pi CLI.
// Pi's Anthropic provider requires ANTHROPIC_API_KEY, but in this environment
// the MiniMax proxy key (MINIMAX_API_KEY) is used as the Anthropic key.
// If ANTHROPIC_API_KEY is not already set, we copy MINIMAX_API_KEY to it.
func piPreStart(cmd *exec.Cmd, _ ChatRequest) {
	// cmd.Env is nil unless ScheduledExecution set it; in that case
	// it already contains os.Environ(). We need a mutable copy.
	env := cmd.Env
	if env == nil {
		env = os.Environ()
	}

	// Check if ANTHROPIC_API_KEY is already set
	hasAnthropicKey := false
	for _, e := range env {
		if len(e) >= len("ANTHROPIC_API_KEY=") && e[:len("ANTHROPIC_API_KEY=")] == "ANTHROPIC_API_KEY=" {
			hasAnthropicKey = true
			break
		}
	}

	// If ANTHROPIC_API_KEY is missing but MINIMAX_API_KEY is available,
	// inject it — MiniMax's Anthropic-compatible proxy uses the same key.
	if !hasAnthropicKey {
		minimaxKey := os.Getenv("MINIMAX_API_KEY")
		if minimaxKey != "" {
			env = append(env, "ANTHROPIC_API_KEY="+minimaxKey)
			cmd.Env = env
		}
	}
}

// buildPiStreamArgs constructs the CLI arguments for Pi streaming.
//
// Command: pi -p --mode json [flags] "prompt"
//
// Supported flags:
//   --session <id>              Resume a specific session
//   --continue                  Continue the most recent session
//   --no-session                Start a new session (no persistence)
//   --no-context-files          Skip AGENTS.md / CLAUDE.md discovery
//   --append-system-prompt <text> Append to Pi's built-in system prompt
//   --model <model>             Override model
//
// Working directory is set via cmd.Dir (CLIBackend sets cmd.Dir = req.WorkDir),
// not via a CLI flag — Pi does not have a --add-dir option.
func buildPiStreamArgs(req ChatRequest) []string {
	args := []string{"-p", "--mode", "json"}

	// Session management
	if req.Resume && req.SessionID != "" {
		args = append(args, "--session", req.SessionID)
	} else if req.Resume {
		args = append(args, "--continue")
	} else {
		args = append(args, "--no-session")
	}

	// Skip AGENTS.md / CLAUDE.md discovery — ClawBench injects its own rules
	args = append(args, "--no-context-files")

	// System prompt — use --append-system-prompt to preserve Pi's built-in prompt
	if req.SystemPrompt != "" {
		args = append(args, "--append-system-prompt", req.SystemPrompt)
	}

	// Model override
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}

	// Prompt is the last positional argument
	args = append(args, req.Prompt)

	return args
}
