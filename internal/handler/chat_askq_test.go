package handler

import (
	"strings"
	"testing"

	"clawbench/internal/model"
)

func TestConvertAskQuestionBlocks_WrongCloseTag_StripsTagFromText(t *testing.T) {
	// Regression test: When Strategy 2 (wrong-close regex) matches a non-standard
	// closing tag instead of the standard </ask-question>, the <ask-question> content
	// must be stripped from the text block. Previously, only Strategy 3 (unclosed)
	// set matchStartIdx, so Strategy 2 matches left the tag in the text, causing
	// duplicate ask-question cards (one from frontend detectAskQuestion, one from
	// the tool_use block).
	blocks := []model.ContentBlock{
		{Type: "text", Text: "Here is my analysis.\n\n---\n\n<ask-question>\n{\"questions\":[{\"header\":\"Pick\",\"multiSelect\":false,\"options\":[{\"label\":\"A\",\"description\":\"Option A\"}],\"question\":\"Which one?\"}]}\n</arg_value>"},
	}

	result := convertAskQuestionBlocks(blocks)

	askQCount := 0
	textHasAskTag := false
	for _, b := range result {
		if b.Type == "tool_use" && b.Name == "AskUserQuestion" {
			askQCount++
		}
		if b.Type == "text" && strings.Contains(b.Text, "<ask-question") {
			textHasAskTag = true
		}
	}

	if askQCount != 1 {
		t.Errorf("expected 1 AskUserQuestion tool_use block, got %d", askQCount)
	}
	if textHasAskTag {
		t.Error("text block should NOT contain <ask-question> tag - it must be stripped to avoid duplicate cards")
	}
}
