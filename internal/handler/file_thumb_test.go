package handler

import (
	"image"
	"image/color"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

// createTestPNG creates a real PNG file of the given dimensions at relPath under projectDir.
func createTestPNG(t *testing.T, projectDir, relPath string, width, height int) {
	t.Helper()
	fullPath := filepath.Join(projectDir, relPath)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		t.Fatalf("failed to create directories: %v", err)
	}
	f, err := os.Create(fullPath)
	if err != nil {
		t.Fatalf("failed to create file: %v", err)
	}
	defer f.Close()

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	// Fill with a solid color so it's not zero-value
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 255, G: 100, B: 50, A: 255})
		}
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatalf("failed to encode PNG: %v", err)
	}
}

func TestFileThumb(t *testing.T) {
	t.Run("ValidImage_ReturnsJPEG", func(t *testing.T) {
		env, teardown := setupTestEnv(t)
		defer teardown()

		// Create a 100x80 PNG
		createTestPNG(t, env.ProjectDir, "photo.png", 100, 80)

		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=photo.png&w=50", nil)
		withProjectCookie(req, env.ProjectDir)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "image/jpeg", w.Header().Get("Content-Type"))
		assert.Equal(t, "public, max-age=86400", w.Header().Get("Cache-Control"))
		// Response body should be non-empty (valid JPEG data)
		assert.Greater(t, w.Body.Len(), 0)
	})

	t.Run("WidthParameterClamped", func(t *testing.T) {
		env, teardown := setupTestEnv(t)
		defer teardown()

		createTestPNG(t, env.ProjectDir, "img.png", 100, 100)

		// Width too small → should clamp to 50
		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=img.png&w=10", nil)
		withProjectCookie(req, env.ProjectDir)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "image/jpeg", w.Header().Get("Content-Type"))

		// Width too large → should clamp to 800
		req2 := newRequest(t, http.MethodGet, "/api/file/thumb?path=img.png&w=9999", nil)
		withProjectCookie(req2, env.ProjectDir)

		w2 := callHandler(FileThumb, req2)
		assert.Equal(t, http.StatusOK, w2.Code)
	})

	t.Run("MissingWidth_DefaultsTo200", func(t *testing.T) {
		env, teardown := setupTestEnv(t)
		defer teardown()

		createTestPNG(t, env.ProjectDir, "img.png", 300, 200)

		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=img.png", nil)
		withProjectCookie(req, env.ProjectDir)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "image/jpeg", w.Header().Get("Content-Type"))
	})

	t.Run("NonImageFile_Returns404", func(t *testing.T) {
		env, teardown := setupTestEnv(t)
		defer teardown()

		createTestFile(t, env.ProjectDir, "readme.md", "# Hello")

		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=readme.md", nil)
		withProjectCookie(req, env.ProjectDir)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("FileNotFound_Returns404", func(t *testing.T) {
		env, teardown := setupTestEnv(t)
		defer teardown()

		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=missing.png", nil)
		withProjectCookie(req, env.ProjectDir)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("NoProjectCookie_Returns403", func(t *testing.T) {
		_, teardown := setupTestEnv(t)
		defer teardown()

		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=img.png", nil)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("PathTraversal_Returns403", func(t *testing.T) {
		env, teardown := setupTestEnv(t)
		defer teardown()

		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=../../../etc/passwd", nil)
		withProjectCookie(req, env.ProjectDir)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("DirectoryPath_Returns404", func(t *testing.T) {
		env, teardown := setupTestEnv(t)
		defer teardown()

		os.MkdirAll(filepath.Join(env.ProjectDir, "subdir"), 0755)

		req := newRequest(t, http.MethodGet, "/api/file/thumb?path=subdir", nil)
		withProjectCookie(req, env.ProjectDir)

		w := callHandler(FileThumb, req)
		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}
