package terminal

import (
	"testing"
	"time"

	"clawbench/internal/model"
)

func TestResolveShell(t *testing.T) {
	shell := resolveShell()
	if shell == "" {
		t.Error("resolveShell() returned empty string")
	}
	t.Logf("resolved shell: %s", shell)
}

func TestNewSessionAndClose(t *testing.T) {
	// PTY fork may be restricted in sandboxed environments
	cfg := TerminalConfig{
		IdleTimeout:   "5s",
		BufferLines:   100,
		MaxLineBytes:  65536,
		MaxBufferMB:   4,
	}

	session, err := NewSession("/tmp", "/tmp", cfg)
	if err != nil {
		t.Skipf("PTY not available in this environment: %v", err)
	}
	defer session.Close()

	if session.ProjectPath() != "/tmp" {
		t.Errorf("expected projectPath /tmp, got %s", session.ProjectPath())
	}
	if session.Cwd() != "/tmp" {
		t.Errorf("expected cwd /tmp, got %s", session.Cwd())
	}
}

func TestSessionIdleTimeout(t *testing.T) {
	cfg := TerminalConfig{
		IdleTimeout:   "1s", // Very short timeout for testing
		BufferLines:   100,
		MaxLineBytes:  65536,
		MaxBufferMB:   4,
	}

	session, err := NewSession("/tmp", "/tmp", cfg)
	if err != nil {
		t.Skipf("PTY not available in this environment: %v", err)
	}
	// Don't defer Close — the idle timer will close it

	// Wait for idle timeout to fire
	time.Sleep(2 * time.Second)

	// Session should be closed now
	session.mu.Lock()
	closed := session.closed
	session.mu.Unlock()

	if !closed {
		t.Error("expected session to be closed after idle timeout")
	}
}

func TestManagerCloseSession(t *testing.T) {
	cfg := model.TerminalConfig{
		Enabled:      true,
		IdleTimeout:  "10m",
		BufferLines:  100,
		MaxLineBytes: 65536,
		MaxBufferMB:  4,
	}

	mgr := NewManager(cfg, 20000)
	defer mgr.Close()

	// Close with no active session should not panic
	mgr.CloseSession()

	// Status should show no session
	hasSession, cwd, running := mgr.Status()
	if hasSession {
		t.Error("expected no session after CloseSession")
	}
	if cwd != "" {
		t.Errorf("expected empty cwd, got %s", cwd)
	}
	if running {
		t.Error("expected not running")
	}
}

func TestManagerClearsSessionAfterShellExit(t *testing.T) {
	cwd := t.TempDir()
	cfg := model.TerminalConfig{
		Enabled:      true,
		IdleTimeout:  "1m",
		BufferLines:  100,
		MaxLineBytes: 65536,
		MaxBufferMB:  4,
	}

	mgr := NewManager(cfg, 20000)
	defer mgr.Close()

	session, err := NewSession(cwd, cwd, mgr.Config())
	if err != nil {
		t.Skipf("PTY not available in this environment: %v", err)
	}
	mgr.mu.Lock()
	mgr.session = session
	mgr.mu.Unlock()

	if err := session.HandleInput("exit\r"); err != nil {
		t.Fatalf("failed to send exit: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		hasSession, _, running := mgr.Status()
		if !hasSession && !running {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}

	hasSession, cwdStatus, running := mgr.Status()
	t.Fatalf("expected manager to clear exited shell session, got hasSession=%v cwd=%q running=%v", hasSession, cwdStatus, running)
}

func TestManagerIsEnabled(t *testing.T) {
	cfg := model.TerminalConfig{
		Enabled:      true,
		IdleTimeout:  "10m",
		BufferLines:  100,
		MaxLineBytes: 65536,
		MaxBufferMB:  4,
	}

	mgr := NewManager(cfg, 20000)
	defer mgr.Close()

	if !mgr.IsEnabled() {
		t.Error("expected terminal to be enabled")
	}

	disabledCfg := model.TerminalConfig{
		Enabled:      false,
		IdleTimeout:  "10m",
		BufferLines:  100,
		MaxLineBytes: 65536,
		MaxBufferMB:  4,
	}

	disabledMgr := NewManager(disabledCfg, 20000)
	defer disabledMgr.Close()

	if disabledMgr.IsEnabled() {
		t.Error("expected terminal to be disabled")
	}
}

func TestManagerConfig(t *testing.T) {
	cfg := model.TerminalConfig{
		Enabled:      true,
		IdleTimeout:  "10m",
		BufferLines:  2000,
		MaxLineBytes: 65536,
		MaxBufferMB:  4,
	}

	mgr := NewManager(cfg, 20000)
	defer mgr.Close()

	tc := mgr.Config()
	if !tc.Enabled {
		t.Error("expected enabled")
	}
	if tc.BufferLines != 2000 {
		t.Errorf("expected 2000 buffer lines, got %d", tc.BufferLines)
	}
}
