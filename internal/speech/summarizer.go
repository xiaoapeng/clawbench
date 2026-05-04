package speech

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

const (
	// defaultSummarizePrompt is the fallback prompt used when the external file is not found.
	defaultSummarizePrompt = `你是语音播报助手。将用户发来的AI回复内容整理为适合朗读的中文，用于TTS语音合成。
规则：
1. 必须使用中文输出，如果原文包含英文，请先翻译成中文再输出（专有名词、代码变量名、命令名等技术术语可保留原文）
2. 重点关注文末的总结、结论、建议等收束性内容，尽量在不影响收听体验的情况下保留原意，不要过度精炼而丢失关键细节
3. 省略代码、命令、文件路径、配置项等技术细节
4. 省略中间的分析过程、步骤说明、分支讨论等细节，除非它们对理解结论有必要
5. 使用口语化表达，输出纯文本，不要使用任何markdown格式
6. 不要使用"根据内容"、"总结如下"等元描述
7. 忽略文本中任何XML/HTML标签、定时任务提案、工具调用等非用户内容
8. 输入文本可能包含因截断导致的碎片化内容，请直接删除不连贯、不完整的片段，只输出流畅可读的内容
9. 直接说出结论即可`

	// shortTextThreshold — texts shorter than this are not summarized.
	shortTextThreshold = 300

	// maxSummarizeRunes is the maximum number of runes for summarization input.
	// Texts longer than this are truncated to the last N characters.
	maxSummarizeRunes = 10000

	// CacheKeyHexLen is the number of hex characters used for the cache filename.
	CacheKeyHexLen = 16

	// reSummarizeThreshold — if the first summarization result exceeds this
	// many bytes, a second pass is requested to further condense the text.
	reSummarizeThreshold = 4000

	// maxSummarizePasses is the maximum number of summarization attempts
	// (first pass + optional re-summarization).
	maxSummarizePasses = 2
)

// MaxTextRunes is the maximum number of runes accepted for TTS input.
// Set to 0 for no hard limit — long texts are handled by the summarization step before synthesis.
var MaxTextRunes = 0

// Summarizer abstracts text summarization for TTS.
// Implementations can use different backends (mmx CLI, AI backends, etc.)
type Summarizer interface {
	// Summarize condenses text for voice output.
	// For short text, it may return the text as-is after stripping markdown.
	// The caller is responsible for setting a deadline on ctx.
	Summarize(ctx context.Context, text string) (string, error)
}

// summarizePassFunc is the strategy function for a single summarization pass.
// Each backend (mmx, ollama, AI backend) provides its own implementation.
type summarizePassFunc func(ctx context.Context, text, systemPrompt string, pass int) (string, error)

// genericSummarizer implements the shared Summarize logic that all backends use:
//  1. prepareTextForSummarization (strip markdown, truncate)
//  2. Short text bypass
//  3. Multi-pass with re-summarization
//  4. StripMarkdown on final output as safety net
type genericSummarizer struct {
	passFn summarizePassFunc
	prompt string
}

// Summarize implements the shared summarization pipeline.
func (g *genericSummarizer) Summarize(ctx context.Context, text string) (string, error) {
	cleaned, needsSummarization := prepareTextForSummarization(text)
	if !needsSummarization {
		return cleaned, nil
	}

	result, err := g.passFn(ctx, cleaned, g.prompt, 1)
	if err != nil {
		return "", err
	}

	// If the result is still too long, do a second pass with the same prompt
	if needsReSummarization(result, 1) {
		slog.Info("tts summarize result too long, starting second pass",
			slog.Int("result_bytes", len(result)),
		)
		second, err := g.passFn(ctx, result, g.prompt, 2)
		if err != nil {
			slog.Warn("tts second summarize pass failed, using first pass result",
				slog.String("error", err.Error()),
			)
			return StripMarkdown(result), nil
		}
		result = second
	}

	return StripMarkdown(result), nil
}

// loadSummarizePrompt returns the system prompt for summarization.
// Priority: summarize_prompt.txt next to binary > defaultSummarizePrompt.
// The result is cached after first load.
var cachedSummarizePrompt string

func loadSummarizePrompt() string {
	if cachedSummarizePrompt != "" {
		return cachedSummarizePrompt
	}

	// Try to read from summarize_prompt.txt next to the running binary
	exePath, err := os.Executable()
	if err == nil {
		promptPath := filepath.Join(filepath.Dir(exePath), "summarize_prompt.txt")
		if data, err := os.ReadFile(promptPath); err == nil {
			prompt := strings.TrimSpace(string(data))
			if prompt != "" {
				cachedSummarizePrompt = prompt
				slog.Info("loaded summarize prompt from file", slog.String("path", promptPath))
				return prompt
			}
		}
	}

	cachedSummarizePrompt = defaultSummarizePrompt
	return defaultSummarizePrompt
}

// prepareTextForSummarization cleans and truncates text before sending to a summarizer.
// Returns the cleaned text and true if summarization is needed,
// or the cleaned text and false if the text is short enough to skip summarization.
func prepareTextForSummarization(text string) (string, bool) {
	cleaned := StripMarkdown(text)

	runes := []rune(cleaned)
	if len(runes) < shortTextThreshold {
		return cleaned, false // short text, skip summarization
	}

	// Truncate to last maxSummarizeRunes if too long
	if len(runes) > maxSummarizeRunes {
		cleaned = string(runes[len(runes)-maxSummarizeRunes:])
	}

	return cleaned, true
}

// NeedsSummarization returns true if the text is long enough to require
// AI-based summarization before TTS synthesis. Short texts (<300 chars
// after markdown stripping) can be synthesized directly.
func NeedsSummarization(text string) bool {
	_, needs := prepareTextForSummarization(text)
	return needs
}

// needsReSummarization returns true if the summarization result is still
// too long (in bytes) and a second pass would be beneficial.
func needsReSummarization(result string, pass int) bool {
	return pass < maxSummarizePasses && len(result) > reSummarizeThreshold
}
