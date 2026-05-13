package ai

import (
	"encoding/json"
	"log/slog"
)

// DeepSeekStreamMessage represents a single JSON line from
// `deepseek exec --output-format stream-json`.
// Fields are shared across event types — only relevant fields are populated per type.
type DeepSeekStreamMessage struct {
	Type    string `json:"type"`    // "content", "thinking", "tool_use", "tool_result", "metadata", "session_capture", "done", "error"
	Content string `json:"content"` // for content/thinking/session_capture events

	// tool_use event fields
	Name  string          `json:"name"`  // tool name
	ID    string          `json:"id"`    // tool call ID
	Input json.RawMessage `json:"input"` // tool input parameters
	Done  bool            `json:"done"`  // whether input accumulation is complete

	// tool_result event fields
	Output string `json:"output"` // tool output text
	Status string `json:"status"` // "success" | "error"

	// metadata event fields
	Meta *DeepSeekStreamMeta `json:"meta"`

	// error event fields
	Error string `json:"error"` // error message
}

// DeepSeekStreamMeta represents the meta field in a metadata event from DeepSeek TUI.
type DeepSeekStreamMeta struct {
	Model        string `json:"model"`
	InputTokens  int    `json:"input_tokens"`
	OutputTokens int    `json:"output_tokens"`
	SessionID    string `json:"session_id"`
}

// DeepSeekStreamParser parses JSON Lines output from
// `deepseek exec --output-format stream-json`.
type DeepSeekStreamParser struct {
	sessionID string // captured from session_capture event
	model     string // captured from metadata event
}

// GetCapturedSessionID returns the session ID captured from session_capture events.
// This is used for the --resume flow in subsequent requests.
func (p *DeepSeekStreamParser) GetCapturedSessionID() string {
	return p.sessionID
}

// ParseLine parses a single JSON line from DeepSeek TUI's stream-json output and sends
// StreamEvent(s) to the provided channel.
func (p *DeepSeekStreamParser) ParseLine(line string, ch chan<- StreamEvent) {
	var msg DeepSeekStreamMessage
	if err := json.Unmarshal([]byte(line), &msg); err != nil {
		slog.Debug("deepseek stream: skipping unparseable line", "line", line, "error", err)
		return
	}

	switch msg.Type {
	case "content":
		if msg.Content != "" {
			ch <- StreamEvent{Type: "content", Content: msg.Content}
		}

	case "thinking":
		if msg.Content != "" {
			ch <- StreamEvent{Type: "thinking", Content: msg.Content}
		}

	case "tool_use":
		ch <- StreamEvent{Type: "tool_use", Tool: &ToolCall{
			Name:  normalizeToolName(msg.Name),
			ID:    msg.ID,
			Input: normalizeDeepSeekInput(msg.Name, msg.Input),
			Done:  msg.Done,
		}}

	case "tool_result":
		if msg.ID != "" {
			ch <- StreamEvent{Type: "tool_result", Tool: &ToolCall{
				ID:     msg.ID,
				Output: truncateToolOutput(msg.Output),
				Status: msg.Status,
			}}
		}

	case "session_capture":
		if msg.Content != "" {
			p.sessionID = msg.Content
			slog.Debug("deepseek stream: captured session ID", "session_id", msg.Content)
			ch <- StreamEvent{Type: "session_capture", Content: msg.Content}
		}

	case "metadata":
		if msg.Meta != nil {
			p.model = msg.Meta.Model
			ch <- StreamEvent{Type: "metadata", Meta: &Metadata{
				Model:        msg.Meta.Model,
				InputTokens:  msg.Meta.InputTokens,
				OutputTokens: msg.Meta.OutputTokens,
				SessionID:    msg.Meta.SessionID,
			}}
		}

	case "done":
		ch <- StreamEvent{Type: "done"}

	case "error":
		if msg.Error != "" {
			ch <- StreamEvent{Type: "error", Error: msg.Error}
		}

	default:
		slog.Debug("deepseek stream: skipping unknown message type", "type", msg.Type)
	}
}

// normalizeDeepSeekInput normalizes tool input field names from DeepSeek TUI's
// camelCase to canonical snake_case.
func normalizeDeepSeekInput(toolName string, rawInput json.RawMessage) string {
	normalized, err := normalizeToolInput(rawInput, map[string]string{
		"dirPath":    "path",
		"oldString":  "old_string",
		"newString":  "new_string",
		"filePaths": "file_paths",
	})
	if err != nil {
		return string(rawInput)
	}
	return string(normalized)
}
