package model_test

import (
	"path/filepath"
	"testing"

	"clawbench/internal/model"

	"github.com/stretchr/testify/assert"
)

func TestValidatePath_ValidPath(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	path, valid := model.ValidatePath(base, "subdir/file.txt")
	assert.True(t, valid)
	assert.Contains(t, path, "subdir")
}

func TestValidatePath_BasePath(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	path, valid := model.ValidatePath(base, "")
	assert.True(t, valid)
	assert.Contains(t, path, "base")
}

func TestValidatePath_PathTraversal(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base", "dir")
	path, valid := model.ValidatePath(base, "../../etc/passwd")
	assert.False(t, valid)
	_ = path // path is returned but not valid
}

func TestValidatePath_SimpleTraversal(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	_, valid := model.ValidatePath(base, "../outside")
	assert.False(t, valid)
}

func TestValidatePath_ValidSubdirectory(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	path, valid := model.ValidatePath(base, "sub/deep/file.go")
	assert.True(t, valid)
	assert.Contains(t, path, "sub")
}

func TestValidatePath_EmptyBaseAndRel(t *testing.T) {
	path, valid := model.ValidatePath("", "")
	assert.True(t, valid)
	// Should resolve to current working directory
	assert.NotEmpty(t, path)
}

// --- Additional boundary tests ---

func TestValidatePath_MultipleTraversalAttempts(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	_, valid := model.ValidatePath(base, "../../../etc/shadow")
	assert.False(t, valid)
}

func TestValidatePath_DotPath(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	path, valid := model.ValidatePath(base, ".")
	assert.True(t, valid)
	assert.Contains(t, path, "base")
}

func TestValidatePath_DotSlashPath(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	path, valid := model.ValidatePath(base, "./file.txt")
	assert.True(t, valid)
	assert.Contains(t, path, "file.txt")
}

func TestValidatePath_MixedTraversalAndValid(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	// "sub/../sub/file.txt" should normalize to "sub/file.txt" which is valid
	path, valid := model.ValidatePath(base, "sub/../sub/file.txt")
	assert.True(t, valid)
	assert.Contains(t, path, "sub")
}

func TestValidatePath_TraversalWithValidPrefix(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	// "sub/../../outside" - the normalized path escapes the base
	_, valid := model.ValidatePath(base, "sub/../../outside")
	assert.False(t, valid)
}

func TestValidatePath_DeepNesting(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	deepPath := "a/b/c/d/e/f/g/h/file.txt"
	path, valid := model.ValidatePath(base, deepPath)
	assert.True(t, valid)
	assert.Contains(t, path, "file.txt")
}

func TestValidatePath_SpecialCharacters(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	path, valid := model.ValidatePath(base, "file with spaces.txt")
	assert.True(t, valid)
	assert.Contains(t, path, "file with spaces.txt")
}

func TestValidatePath_EncodedTraversal(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	// These should be treated as literal directory names, not traversal
	// filepath.Join normalizes them, so ".." in a path segment is the traversal
	_, valid := model.ValidatePath(base, "..")
	assert.False(t, valid)
}

func TestValidatePath_AbsoluteRelPath(t *testing.T) {
	base := filepath.Join(t.TempDir(), "base")
	// Go's filepath.Join concatenates even absolute relPath to base,
	// so "/tmp/other" + "/other" becomes "base/other" which is valid.
	// This is Go-specific behavior; the function still validates the final path.
	path, valid := model.ValidatePath(base, "/some/absolute/path")
	// filepath.Join(base, "/some/absolute/path") = "base/some/absolute/path" which IS under base
	assert.True(t, valid)
	assert.Contains(t, path, "base")
}
