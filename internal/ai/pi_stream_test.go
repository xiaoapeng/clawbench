package ai

import (
	"strings"
	"testing"
)

func TestPiStreamParser_SessionEvent(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"session","version":3,"id":"019e2110-274a-73ec-9e14-f1a7b5c13e6f","timestamp":"2025-01-01T00:00:00Z","cwd":"/home/user/project"}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "session_capture" {
			t.Errorf("expected session_capture event, got %s", evt.Type)
		}
		if evt.Content != "019e2110-274a-73ec-9e14-f1a7b5c13e6f" {
			t.Errorf("expected session ID in content, got '%s'", evt.Content)
		}
	default:
		t.Error("expected event on channel")
	}

	if id := parser.GetCapturedSessionID(); id != "019e2110-274a-73ec-9e14-f1a7b5c13e6f" {
		t.Errorf("expected captured session ID, got '%s'", id)
	}
}

func TestPiStreamParser_ThinkingDelta(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":0,"delta":"The user wants me to say hello."},"message":{"role":"assistant"}}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "thinking" {
			t.Errorf("expected thinking event, got %s", evt.Type)
		}
		if evt.Content != "The user wants me to say hello." {
			t.Errorf("unexpected content: %s", evt.Content)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestPiStreamParser_TextDelta(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":1,"delta":"Hello!"},"message":{"role":"assistant"}}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "content" {
			t.Errorf("expected content event, got %s", evt.Type)
		}
		if evt.Content != "Hello!" {
			t.Errorf("unexpected content: %s", evt.Content)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestPiStreamParser_ToolcallEnd(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_end","contentIndex":1,"toolCall":{"type":"toolCall","id":"call_1","name":"read","arguments":{"path":"/etc/hostname","limit":5}}},"message":{"role":"assistant"}}`, ch)

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
		if evt.Tool.ID != "call_1" {
			t.Errorf("expected tool ID 'call_1', got '%s'", evt.Tool.ID)
		}
		if !evt.Tool.Done {
			t.Error("expected Done=true")
		}
		// Pi read uses "path" → should be normalized to "file_path"
		if !strings.Contains(evt.Tool.Input, `"file_path"`) {
			t.Errorf("expected input field 'file_path', got '%s'", evt.Tool.Input)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestPiStreamParser_ToolExecutionEnd(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"tool_execution_end","toolCallId":"call_1","toolName":"bash","result":{"content":[{"type":"text","text":"xulongzhe-KLVL-WXX9"}]},"isError":false}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "tool_result" {
			t.Errorf("expected tool_result event, got %s", evt.Type)
		}
		if evt.Tool == nil {
			t.Fatal("expected Tool to be non-nil")
		}
		if evt.Tool.ID != "call_1" {
			t.Errorf("expected tool ID 'call_1', got '%s'", evt.Tool.ID)
		}
		if evt.Tool.Status != "success" {
			t.Errorf("expected status 'success', got '%s'", evt.Tool.Status)
		}
		if !strings.Contains(evt.Tool.Output, "xulongzhe-KLVL-WXX9") {
			t.Errorf("expected output to contain 'xulongzhe-KLVL-WXX9', got '%s'", evt.Tool.Output)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestPiStreamParser_ToolExecutionEndError(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"tool_execution_end","toolCallId":"call_2","toolName":"bash","result":{"content":[{"type":"text","text":"permission denied"}]},"isError":true}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "tool_result" {
			t.Errorf("expected tool_result event, got %s", evt.Type)
		}
		if evt.Tool.Status != "error" {
			t.Errorf("expected status 'error', got '%s'", evt.Tool.Status)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestPiStreamParser_MessageEndMetadata(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"message_end","message":{"role":"assistant","usage":{"input":1396,"output":27,"cacheRead":0,"cacheWrite":0,"totalTokens":1423,"cost":{"input":0.004188,"output":0.000405,"cacheRead":0,"cacheWrite":0,"total":0.004593}},"stopReason":"stop","responseId":"resp_123"}}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "metadata" {
			t.Errorf("expected metadata event, got %s", evt.Type)
		}
		if evt.Meta == nil {
			t.Fatal("expected Meta to be non-nil")
		}
		if evt.Meta.InputTokens != 1396 {
			t.Errorf("expected 1396 input tokens, got %d", evt.Meta.InputTokens)
		}
		if evt.Meta.OutputTokens != 27 {
			t.Errorf("expected 27 output tokens, got %d", evt.Meta.OutputTokens)
		}
		if evt.Meta.CostUSD != 0.004593 {
			t.Errorf("expected cost 0.004593, got %f", evt.Meta.CostUSD)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestPiStreamParser_AgentEndDone(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"agent_end","messages":[]}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "done" {
			t.Errorf("expected done event, got %s", evt.Type)
		}
	default:
		t.Error("expected event on channel")
	}
}

func TestPiStreamParser_ErrorMessage(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"403 forbidden"}}`, ch)

	// Should emit both metadata (with error info) and error event
	events := drainEvents(ch, 2)
	var foundError bool
	for _, evt := range events {
		if evt.Type == "error" {
			foundError = true
			if evt.Error != "403 forbidden" {
				t.Errorf("expected error message '403 forbidden', got '%s'", evt.Error)
			}
		}
	}
	if !foundError {
		t.Error("expected error event from message_end with stopReason=error")
	}
}

func TestPiStreamParser_SkipsUnknownTypes(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)
	parser.ParseLine(`{"type":"compaction_start","reason":"context_window"}`, ch)
	parser.ParseLine(`{"type":"agent_start"}`, ch)
	parser.ParseLine(`{"type":"turn_start"}`, ch)
	parser.ParseLine(`{"type":"turn_end"}`, ch)
	parser.ParseLine(`{"type":"message_start"}`, ch)
	parser.ParseLine(`{"type":"tool_execution_update"}`, ch)
	parser.ParseLine(`{"type":"auto_retry_start"}`, ch)

	select {
	case evt := <-ch:
		t.Errorf("expected no events for unknown types, got %+v", evt)
	default:
		// expected
	}
}

func TestPiStreamParser_ToolcallDeltaAccumulates(t *testing.T) {
	parser := &PiStreamParser{}
	ch := make(chan StreamEvent, 10)

	// toolcall_start — no event emitted, just tracks the tool
	parser.ParseLine(`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":1},"message":{"role":"assistant","content":[{"type":"toolCall","id":"call_abc","name":"edit","arguments":{},"partialJson":"","index":1}]}}`, ch)

	// Verify no event from toolcall_start
	select {
	case evt := <-ch:
		t.Errorf("expected no event from toolcall_start, got %+v", evt)
	default:
	}

	// toolcall_delta — accumulate partial JSON
	parser.ParseLine(`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_delta","contentIndex":1,"delta":"{\"path\": \"/tmp/test.go\"}"},"message":{"role":"assistant","content":[{"type":"toolCall","id":"call_abc","name":"edit","arguments":{},"partialJson":"{\"path\": \"/tmp/test.go\"}","index":1}]}}`, ch)

	// Verify no event from toolcall_delta
	select {
	case evt := <-ch:
		t.Errorf("expected no event from toolcall_delta, got %+v", evt)
	default:
	}

	// toolcall_end — emit tool_use with accumulated input and Done=true
	parser.ParseLine(`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_end","contentIndex":1,"toolCall":{"type":"toolCall","id":"call_abc","name":"edit","arguments":{"path":"/tmp/test.go","edits":[{"oldText":"foo","newText":"bar"}]}}},"message":{"role":"assistant"}}`, ch)

	select {
	case evt := <-ch:
		if evt.Type != "tool_use" {
			t.Errorf("expected tool_use event, got %s", evt.Type)
		}
		if evt.Tool == nil {
			t.Fatal("expected Tool to be non-nil")
		}
		if evt.Tool.Name != "Edit" {
			t.Errorf("expected canonical tool name 'Edit', got '%s'", evt.Tool.Name)
		}
		if !evt.Tool.Done {
			t.Error("expected Done=true")
		}
		// Pi edit: path → file_path, oldText → old_string, newText → new_string
		if !strings.Contains(evt.Tool.Input, `"file_path"`) {
			t.Errorf("expected 'file_path' in input, got '%s'", evt.Tool.Input)
		}
		if !strings.Contains(evt.Tool.Input, `"old_string"`) {
			t.Errorf("expected 'old_string' in input, got '%s'", evt.Tool.Input)
		}
		if !strings.Contains(evt.Tool.Input, `"new_string"`) {
			t.Errorf("expected 'new_string' in input, got '%s'", evt.Tool.Input)
		}
	default:
		t.Error("expected event on channel")
	}
}

// drainEvents reads up to n events from the channel
func drainEvents(ch chan StreamEvent, n int) []StreamEvent {
	var events []StreamEvent
	for i := 0; i < n; i++ {
		select {
		case evt := <-ch:
			events = append(events, evt)
		default:
			return events
		}
	}
	return events
}
