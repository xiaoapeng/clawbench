package ai

import (
	"strings"
	"testing"
)

func TestDeepSeekStreamParserContent(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"content","content":"hello world"}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "content" {
			t.Errorf("expected content event, got %s", evt.Type)
		}
		if evt.Content != "hello world" {
			t.Errorf("expected 'hello world', got '%s'", evt.Content)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestDeepSeekStreamParserThinking(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"thinking","content":"reasoning about the problem..."}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "thinking" {
			t.Errorf("expected thinking event, got %s", evt.Type)
		}
		if evt.Content != "reasoning about the problem..." {
			t.Errorf("unexpected content: %s", evt.Content)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestDeepSeekStreamParserToolUse(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"tool_use","name":"read_file","id":"call_001","input":{"file_path":"/tmp/test.go"},"done":true}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "tool_use" {
			t.Errorf("expected tool_use event, got %s", evt.Type)
		}
		if evt.Tool == nil {
			t.Fatal("expected Tool to be non-nil")
		}
		if evt.Tool.Name != "Read" {
			t.Errorf("expected canonical tool name 'Read', got '%s'", evt.Tool.Name)
		}
		if evt.Tool.ID != "call_001" {
			t.Errorf("expected tool ID 'call_001', got '%s'", evt.Tool.ID)
		}
		if !evt.Tool.Done {
			t.Error("expected Done=true")
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestDeepSeekStreamParserToolResult(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"tool_result","id":"call_001","output":"file contents here","status":"success"}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "tool_result" {
			t.Errorf("expected tool_result event, got %s", evt.Type)
		}
		if evt.Tool.ID != "call_001" {
			t.Errorf("expected tool ID 'call_001', got '%s'", evt.Tool.ID)
		}
		if evt.Tool.Status != "success" {
			t.Errorf("expected status 'success', got '%s'", evt.Tool.Status)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestDeepSeekStreamParserSessionCapture(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"session_capture","content":"4bf83f0f-a9b6-47b4-bcde-68af7354cd9f"}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "session_capture" {
			t.Errorf("expected session_capture event, got %s", evt.Type)
		}
		if evt.Content != "4bf83f0f-a9b6-47b4-bcde-68af7354cd9f" {
			t.Errorf("unexpected session ID: %s", evt.Content)
		}
	default:
		t.Error("expected event on channel")
	}

	// Verify GetCapturedSessionID
	if id := parser.GetCapturedSessionID(); id != "4bf83f0f-a9b6-47b4-bcde-68af7354cd9f" {
		t.Errorf("expected captured session ID, got '%s'", id)
	}
}

func TestDeepSeekStreamParserMetadata(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"metadata","meta":{"model":"deepseek-v4-flash","input_tokens":100,"output_tokens":50,"session_id":"abc-123"}}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "metadata" {
			t.Errorf("expected metadata event, got %s", evt.Type)
		}
		if evt.Meta == nil {
			t.Fatal("expected Meta to be non-nil")
		}
		if evt.Meta.Model != "deepseek-v4-flash" {
			t.Errorf("expected model 'deepseek-v4-flash', got '%s'", evt.Meta.Model)
		}
		if evt.Meta.InputTokens != 100 {
			t.Errorf("expected 100 input tokens, got %d", evt.Meta.InputTokens)
		}
		if evt.Meta.OutputTokens != 50 {
			t.Errorf("expected 50 output tokens, got %d", evt.Meta.OutputTokens)
		}
		if evt.Meta.SessionID != "abc-123" {
			t.Errorf("expected session ID 'abc-123', got '%s'", evt.Meta.SessionID)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestDeepSeekStreamParserDone(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"done"}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "done" {
			t.Errorf("expected done event, got %s", evt.Type)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestDeepSeekStreamParserError(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"error","error":"API rate limit exceeded"}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "error" {
			t.Errorf("expected error event, got %s", evt.Type)
		}
		if evt.Error != "API rate limit exceeded" {
			t.Errorf("unexpected error message: %s", evt.Error)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestDeepSeekStreamParserSkipInvalidJSON(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	// Should not panic or send events for invalid JSON
	parser.ParseLine("not json", ch)
	parser.ParseLine("", ch)

	select {
	case evt := <-ch:
		t.Errorf("expected no events for invalid JSON, got %+v", evt)
	default:
		// expected
	}
}

func TestDeepSeekStreamParserSkipUnknownType(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"unknown_type","data":"something"}`, ch)

	select {
	case evt := <-ch:
		t.Errorf("expected no events for unknown type, got %+v", evt)
	default:
		// expected
	}
}

func TestBuildDeepSeekStreamArgsBasic(t *testing.T) {
	req := ChatRequest{
		Prompt: "what is 1+1?",
	}
	args := buildDeepSeekStreamArgs(req)

	expected := []string{"exec", "--auto", "--output-format", "stream-json", "what is 1+1?"}
	if len(args) != len(expected) {
		t.Fatalf("expected %d args, got %d: %v", len(expected), len(args), args)
	}
	for i, arg := range args {
		if arg != expected[i] {
			t.Errorf("arg[%d]: expected '%s', got '%s'", i, expected[i], arg)
		}
	}
}

func TestBuildDeepSeekStreamArgsWithModel(t *testing.T) {
	req := ChatRequest{
		Prompt: "hello",
		Model:  "deepseek-v4-pro",
	}
	args := buildDeepSeekStreamArgs(req)

	found := false
	for i, arg := range args {
		if arg == "--model" && i+1 < len(args) && args[i+1] == "deepseek-v4-pro" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected --model deepseek-v4-pro in args: %v", args)
	}
}

func TestBuildDeepSeekStreamArgsWithResume(t *testing.T) {
	req := ChatRequest{
		Prompt:   "continue",
		SessionID: "4bf83f0f-a9b6-47b4",
		Resume:   true,
	}
	args := buildDeepSeekStreamArgs(req)

	found := false
	for i, arg := range args {
		if arg == "--resume" && i+1 < len(args) && args[i+1] == "4bf83f0f-a9b6-47b4" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected --resume 4bf83f0f-a9b6-47b4 in args: %v", args)
	}
}

func TestBuildDeepSeekStreamArgsWithSystemPrompt(t *testing.T) {
	req := ChatRequest{
		Prompt:       "review code",
		SystemPrompt: "You are a code reviewer.",
	}
	args := buildDeepSeekStreamArgs(req)

	found := false
	for i, arg := range args {
		if arg == "--system-prompt" && i+1 < len(args) && args[i+1] == "You are a code reviewer." {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected --system-prompt in args: %v", args)
	}
}

func TestBuildDeepSeekStreamArgsFull(t *testing.T) {
	req := ChatRequest{
		Prompt:       "explain this",
		Model:        "deepseek-v4-flash",
		SessionID:    "session-abc",
		Resume:       true,
		SystemPrompt: "Respond in Chinese",
	}
	args := buildDeepSeekStreamArgs(req)

	argsStr := strings.Join(args, " ")
	checks := []string{
		"exec",
		"--auto",
		"--output-format stream-json",
		"--resume session-abc",
		"--system-prompt Respond in Chinese",
		"--model deepseek-v4-flash",
		"explain this",
	}
	for _, check := range checks {
		if !strings.Contains(argsStr, check) {
			t.Errorf("expected '%s' in args: %s", check, argsStr)
		}
	}
}

func TestDeepSeekToolNameNormalization(t *testing.T) {
	parser := &DeepSeekStreamParser{}
	ch := make(chan StreamEvent, 10)

	tests := map[string]string{
		"read_file":   "Read",
		"write_file":  "Write",
		"edit_file":   "Edit",
		"shell":       "Bash",
		"bash":        "Bash",
		"list_files":  "LS",
		"grep":        "Grep",
		"glob":        "Glob",
	}

	for input, expected := range tests {
		parser.ParseLine(`{"type":"tool_use","name":"`+input+`","id":"t1","input":{},"done":true}`, ch)
		evt := <-ch
		if evt.Tool.Name != expected {
			t.Errorf("normalizeToolName(%q) = %q, want %q", input, evt.Tool.Name, expected)
		}
	}
}
