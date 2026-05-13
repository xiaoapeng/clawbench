package speech

// This file previously contained summarization code that has been moved to
// internal/summarize/. The following items were migrated:
// - Summarizer interface → summarize.Summarizer
// - genericSummarizer → summarize.ttsPipeline
// - All summarizer implementations → internal/summarize/ package
// - StripMarkdown → summarize.StripMarkdown
// - Constants (shortTextThreshold, DefaultMaxSummarizeRunes, etc.) → summarize package
//
// This file is intentionally left empty. The speech package now only contains
// speech synthesis (TTS) providers.
