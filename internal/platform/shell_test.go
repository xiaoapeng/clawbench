package platform

import (
	"os"
	"testing"
)

func TestResolveLoginShell(t *testing.T) {
	// Save and restore original SHELL
	origShell := os.Getenv("SHELL")
	t.Cleanup(func() { os.Setenv("SHELL", origShell) })

	t.Run("respects non-sh SHELL", func(t *testing.T) {
		os.Setenv("SHELL", "/bin/zsh")
		got := ResolveLoginShell()
		if got != "/bin/zsh" {
			t.Errorf("got %q, want /bin/zsh", got)
		}
	})

	t.Run("falls back to passwd when SHELL is /bin/sh", func(t *testing.T) {
		os.Setenv("SHELL", "/bin/sh")
		got := ResolveLoginShell()
		// On this system, root's login shell in /etc/passwd is likely /bin/bash
		// or /usr/bin/zsh. We just verify it's NOT /bin/sh.
		if got == "/bin/sh" {
			t.Errorf("ResolveLoginShell() returned /bin/sh, expected login shell from /etc/passwd")
		}
		t.Logf("resolved login shell: %s", got)
	})

	t.Run("falls back to passwd when SHELL is empty", func(t *testing.T) {
		os.Unsetenv("SHELL")
		got := ResolveLoginShell()
		if got == "" {
			t.Errorf("ResolveLoginShell() returned empty string")
		}
		t.Logf("resolved login shell: %s", got)
	})
}

func TestSetLoginShell(t *testing.T) {
	origShell := os.Getenv("SHELL")
	t.Cleanup(func() { os.Setenv("SHELL", origShell) })

	os.Setenv("SHELL", "/bin/sh")
	SetLoginShell()

	got := os.Getenv("SHELL")
	if got == "/bin/sh" {
		t.Errorf("SHELL still /bin/sh after SetLoginShell(), got %q", got)
	}
	t.Logf("SHELL after SetLoginShell(): %s", got)
}
