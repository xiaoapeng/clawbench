package ai

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewBackend_Claude(t *testing.T) {
	backend, err := NewBackend("claude")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "claude", backend.Name())
}

func TestNewBackend_Codebuddy(t *testing.T) {
	backend, err := NewBackend("codebuddy")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "codebuddy", backend.Name())
}

func TestNewBackend_OpenCode(t *testing.T) {
	backend, err := NewBackend("opencode")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "opencode", backend.Name())
}

func TestNewBackend_Gemini(t *testing.T) {
	backend, err := NewBackend("gemini")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "gemini", backend.Name())
}

func TestNewBackend_Qoder(t *testing.T) {
	backend, err := NewBackend("qoder")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "qoder", backend.Name())
	// Verify AutoResumeBackend wrapping (Qoder has EnterPlanMode/ExitPlanMode)
	_, ok := backend.(*AutoResumeBackend)
	assert.True(t, ok, "qoder should be wrapped in AutoResumeBackend")
}

func TestNewBackend_Vecli(t *testing.T) {
	backend, err := NewBackend("vecli")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "vecli", backend.Name())
	// VeCLI is NOT wrapped in AutoResumeBackend (no ExitPlanMode detection)
	_, ok := backend.(*VeCLIBackend)
	assert.True(t, ok, "vecli should be a VeCLIBackend")
}

func TestNewBackend_Pi(t *testing.T) {
	backend, err := NewBackend("pi")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "pi", backend.Name())
	// Pi is wrapped in AutoResumeBackend (has ExitPlanMode)
	_, ok := backend.(*AutoResumeBackend)
	assert.True(t, ok, "pi should be wrapped in AutoResumeBackend")
}

func TestNewBackend_DeepSeek(t *testing.T) {
	backend, err := NewBackend("deepseek")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "deepseek", backend.Name())
	// DeepSeek is wrapped in AutoResumeBackend (supports ExitPlanMode)
	_, ok := backend.(*AutoResumeBackend)
	assert.True(t, ok, "deepseek should be wrapped in AutoResumeBackend")
}

func TestNewBackend_Codex(t *testing.T) {
	backend, err := NewBackend("codex")
	assert.NoError(t, err)
	assert.NotNil(t, backend)
	assert.Equal(t, "codex", backend.Name())
	// Codex is NOT wrapped in AutoResumeBackend (custom ExecuteStream)
	_, ok := backend.(*CodexBackend)
	assert.True(t, ok, "codex should be a CodexBackend (not wrapped in AutoResumeBackend)")
}

func TestNewBackend_Unsupported(t *testing.T) {
	_, err := NewBackend("unsupported")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported backend type")
}

func TestNewBackend_Empty(t *testing.T) {
	_, err := NewBackend("")
	assert.Error(t, err)
}
