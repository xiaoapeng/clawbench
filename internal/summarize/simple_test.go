package summarize

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewSimple(t *testing.T) {
	s := NewSimple()
	assert.NotNil(t, s)
}

func TestSimpleSummarizer_ShortText(t *testing.T) {
	s := NewSimple()
	text := "Hello, this is a short text."

	result, err := s.Summarize(context.Background(), text, "zh")
	assert.NoError(t, err)
	assert.Equal(t, text, result)
}

func TestSimpleSummarizer_LongText_Truncation(t *testing.T) {
	s := NewSimple()

	longText := strings.Repeat("a", 1500)
	result, err := s.Summarize(context.Background(), longText, "zh")
	assert.NoError(t, err)

	assert.LessOrEqual(t, len([]rune(result)), SimpleMaxSummarizeRunes)
	assert.Equal(t, strings.Repeat("a", 1000), result)
}

func TestSimpleSummarizer_BoundaryExactly1000(t *testing.T) {
	s := NewSimple()

	text := strings.Repeat("x", 1000)
	result, err := s.Summarize(context.Background(), text, "zh")
	assert.NoError(t, err)
	assert.Equal(t, text, result)
}

func TestSimpleSummarizer_MarkdownStripped(t *testing.T) {
	s := NewSimple()

	text := "**bold** and *italic* and `code`"
	result, err := s.Summarize(context.Background(), text, "zh")
	assert.NoError(t, err)
	assert.NotContains(t, result, "**")
	assert.NotContains(t, result, "*")
	assert.NotContains(t, result, "`")
}

func TestSimpleSummarizer_LanguageIgnored(t *testing.T) {
	s := NewSimple()

	text := "same text regardless of language"
	resultZh, _ := s.Summarize(context.Background(), text, "zh")
	resultEn, _ := s.Summarize(context.Background(), text, "en")

	assert.Equal(t, resultZh, resultEn)
}

func TestSimpleSummarizer_EmptyText(t *testing.T) {
	s := NewSimple()

	result, err := s.Summarize(context.Background(), "", "zh")
	assert.NoError(t, err)
	assert.Equal(t, "", result)
}
