package speech

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	// kokoroScriptVenv is the primary path to the Kokoro TTS Python bridge script (in .venv).
	kokoroScriptVenv = ".venv/bin/kokoro_tts.py"
	// kokoroScriptRepo is the fallback path (tracked in git repo).
	kokoroScriptRepo = "scripts/kokoro_tts.py"

	// kokoroDefaultModelDir is the default directory for Kokoro model files.
	kokoroDefaultModelDir = ".clawbench/kokoro-models"
)

// KokoroProvider implements SpeechProvider using Kokoro-82M (local, ONNX-based TTS).
// It uses mmx for summarization (same as other providers) and the kokoro-onnx
// Python library for synthesis via a bridge script. Kokoro produces high-quality
// Chinese speech and runs locally with ONNX Runtime (no GPU required).
type KokoroProvider struct {
	// SummarizeModel is the model ID for text chat (default: "MiniMax-M2.7").
	SummarizeModel string
	// ModelPath is the path to the Kokoro .onnx model file.
	// If empty, defaults to .clawbench/kokoro-models/kokoro-v1.1-zh.onnx.
	ModelPath string
	// VoicesPath is the path to the Kokoro voices .bin file.
	// If empty, defaults to .clawbench/kokoro-models/voices-v1.1-zh.bin.
	VoicesPath string
	// Voice is the voice name (e.g. "zf_001", "zm_010" for v1.1; "zf_xiaobei", "zm_yunxi" for v1.0).
	Voice string
	// Lang is the language code for espeak phonemization (default: "cmn" for Mandarin Chinese).
	Lang string
	// Speed is the speech speed multiplier (default: 1.0).
	Speed float64
	// SummarizePrompt caches the loaded prompt (same logic as MiniMaxProvider).
	SummarizePrompt string
}

// NewKokoroProvider creates a KokoroProvider with sensible defaults.
func NewKokoroProvider() *KokoroProvider {
	return &KokoroProvider{
		SummarizeModel: "MiniMax-M2.7",
		Voice:          "zf_001",
		Lang:           "cmn",
		Speed:          1.0,
	}
}

// loadSummarizePrompt returns the system prompt for summarization.
// Priority: p.SummarizePrompt > summarize_prompt.txt next to binary > defaultSummarizePrompt.
func (p *KokoroProvider) loadSummarizePrompt() string {
	if p.SummarizePrompt != "" {
		return p.SummarizePrompt
	}

	exePath, err := os.Executable()
	if err == nil {
		promptPath := filepath.Join(filepath.Dir(exePath), "summarize_prompt.txt")
		if data, err := os.ReadFile(promptPath); err == nil {
			prompt := strings.TrimSpace(string(data))
			if prompt != "" {
				p.SummarizePrompt = prompt
				slog.Info("kokoro: loaded summarize prompt from file", slog.String("path", promptPath))
				return prompt
			}
		}
	}

	p.SummarizePrompt = defaultSummarizePrompt
	return defaultSummarizePrompt
}

// Summarize condenses text for voice output using mmx text chat.
// For short text (<300 chars), it strips markdown and returns the text as-is.
func (p *KokoroProvider) Summarize(ctx context.Context, text string) (string, error) {
	cleaned := StripMarkdown(text)

	if len([]rune(cleaned)) < shortTextThreshold {
		return cleaned, nil
	}

	messagesJSON := fmt.Sprintf(`[{"role":"user","content":%q}]`, cleaned)

	args := []string{
		"text", "chat",
		"--system", p.loadSummarizePrompt(),
		"--messages-file", "-",
		"--model", p.SummarizeModel,
		"--max-tokens", "1024",
		"--quiet",
	}

	cmd := exec.CommandContext(ctx, "mmx", args...)
	cmd.Stdin = strings.NewReader(messagesJSON)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("mmx text chat failed: %w (stderr: %s)", err, stderr.String())
	}

	result := strings.TrimSpace(stdout.String())
	if result == "" {
		return "", fmt.Errorf("mmx text chat returned empty output")
	}

	return result, nil
}

// Synthesize generates an audio file at outputPath using Kokoro via Python bridge.
// Text is piped via stdin to the bridge script.
func (p *KokoroProvider) Synthesize(ctx context.Context, text string, outputPath string) error {
	dir := filepath.Dir(outputPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory %s: %w", dir, err)
	}

	// Validate model files exist
	if p.ModelPath == "" {
		return fmt.Errorf("kokoro model path not configured")
	}
	if _, err := os.Stat(p.ModelPath); err != nil {
		return fmt.Errorf("kokoro model file not found: %s", p.ModelPath)
	}
	if p.VoicesPath == "" {
		return fmt.Errorf("kokoro voices path not configured")
	}
	if _, err := os.Stat(p.VoicesPath); err != nil {
		return fmt.Errorf("kokoro voices file not found: %s", p.VoicesPath)
	}

	// Resolve Python interpreter and bridge script path
	pythonPath := ".venv/bin/python3"
	scriptPath := kokoroScriptRepo // default to repo copy
	if exePath, err := os.Executable(); err == nil {
		binDir := filepath.Dir(exePath)
		candidatePython := filepath.Join(binDir, ".venv/bin/python3")
		if _, err := os.Stat(candidatePython); err == nil {
			pythonPath = candidatePython
		}
		// Prefer .venv copy (closer to Python env), fall back to repo copy
		for _, candidate := range []string{
			filepath.Join(binDir, kokoroScriptVenv),
			filepath.Join(binDir, kokoroScriptRepo),
		} {
			if _, err := os.Stat(candidate); err == nil {
				scriptPath = candidate
				break
			}
		}
	}

	args := []string{
		scriptPath,
		"--model", p.ModelPath,
		"--voices", p.VoicesPath,
		"--voice", p.Voice,
		"--lang", p.Lang,
		"--speed", fmt.Sprintf("%g", p.Speed),
		"--output", outputPath,
	}

	slog.Info("kokoro synthesize",
		slog.String("output", outputPath),
		slog.String("model", p.ModelPath),
		slog.String("voice", p.Voice),
		slog.String("lang", p.Lang),
		slog.Float64("speed", p.Speed),
		slog.Int("text_len", len(text)),
	)

	cmd := exec.CommandContext(ctx, pythonPath, args...)
	cmd.Stdin = strings.NewReader(text)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("kokoro failed: %w (stderr: %s)", err, stderr.String())
	}

	if _, err := os.Stat(outputPath); err != nil {
		return fmt.Errorf("output file not created: %s", outputPath)
	}

	return nil
}

// ResolveKokoroPaths resolves the Kokoro model and voices paths from defaults.
// If a path is explicitly set, it is returned as-is.
// Otherwise, the default directory is used.
func ResolveKokoroPaths(modelPath, voicesPath string) (string, string) {
	if modelPath == "" {
		modelPath = filepath.Join(kokoroDefaultModelDir, "kokoro-v1.1-zh.onnx")
	}
	if voicesPath == "" {
		voicesPath = filepath.Join(kokoroDefaultModelDir, "voices-v1.1-zh.bin")
	}
	return modelPath, voicesPath
}
