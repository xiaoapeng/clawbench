package speech

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// --- NewMiniMaxProvider defaults ---

func TestNewMiniMaxProvider_Defaults(t *testing.T) {
	p := NewMiniMaxProvider()
	assert.Equal(t, "speech-2.8-hd", p.TTSModel)
	assert.Equal(t, "female-chengshu", p.TTSVoice)
	assert.Equal(t, 1.5, p.TTSSpeed)
	assert.Equal(t, "mp3", p.TTSFormat)
}

// --- Synthesize integration test (requires mmx CLI) ---

func TestSynthesize_WithCLI(t *testing.T) {
	if _, err := os.Stat("/usr/local/bin/mmx"); err != nil {
		if _, err := os.Stat(filepath.Join(os.Getenv("HOME"), ".nvm/versions/node/v24.14.0/bin/mmx")); err != nil {
			t.Skip("mmx CLI not available, skipping integration test")
		}
	}

	p := NewMiniMaxProvider()
	outputPath := filepath.Join(t.TempDir(), "test_output.mp3")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := p.Synthesize(ctx, "这是一个测试语音。", outputPath, "")
	assert.NoError(t, err)

	// Verify output file exists and has content
	info, err := os.Stat(outputPath)
	assert.NoError(t, err)
	assert.Greater(t, info.Size(), int64(0))
}

// --- Synthesize creates output directory ---

func TestSynthesize_CreatesDirectory(t *testing.T) {
	if _, err := os.Stat("/usr/local/bin/mmx"); err != nil {
		if _, err := os.Stat(filepath.Join(os.Getenv("HOME"), ".nvm/versions/node/v24.14.0/bin/mmx")); err != nil {
			t.Skip("mmx CLI not available, skipping integration test")
		}
	}

	p := NewMiniMaxProvider()
	nestedDir := filepath.Join(t.TempDir(), "deep", "nested", "dir")
	outputPath := filepath.Join(nestedDir, "output.mp3")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := p.Synthesize(ctx, "测试目录创建。", outputPath, "")
	assert.NoError(t, err)

	// Verify the directory was created
	_, err = os.Stat(nestedDir)
	assert.NoError(t, err)
}

// --- Synthesize context cancellation ---

func TestSynthesize_CancelledContext(t *testing.T) {
	p := NewMiniMaxProvider()
	outputPath := filepath.Join(t.TempDir(), "cancelled.mp3")

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	err := p.Synthesize(ctx, "test", outputPath, "")
	assert.Error(t, err)
}
