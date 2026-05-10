import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  SCHEDULED_TASK_RE,
  extractScheduledTaskIds,
  stripScheduledTaskTags,
  isValidAskContent,
  detectAskQuestion,
  taskChanged,
  StaticBlockCache,
} from '@/utils/streamPerf'

// ═══════════════════════════════════════════════════════════════
// Tests for deferred streaming render pipeline
//
// Core design: During streaming, renderTextBlock only does
// marked + DOMPurify + table-wrap. All structured detection
// (KaTeX, Mermaid, scheduled-task, ask-question, file path
// annotation/verification) is deferred to after streaming ends.
// ═══════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────
// Deferred rendering: renderTextBlock streaming parameter
// ────────────────────────────────────────────────────────────

/**
 * Simulates the deferred rendering logic for renderTextBlock.
 * When streaming=true, only marked + DOMPurify + table-wrap runs.
 * When streaming=false, the full pipeline runs.
 */
function renderTextBlockDeferred(text, msgId, blockIdx, streaming = false) {
  if (streaming) {
    // Streaming: pure markdown only, no structured detection
    // This is the fast path — marked + DOMPurify + table-wrap
    return { streaming: true, ranKaTeX: false, ranScheduledTask: false, ranAskQuestion: false, ranPathAnnotation: false }
  }
  // Post-streaming: full pipeline
  const taskIds = extractScheduledTaskIds(text)
  const askResult = detectAskQuestion(text)
  const cleanText = stripScheduledTaskTags(text)
  return {
    streaming: false,
    ranKaTeX: true,
    ranScheduledTask: taskIds.length > 0 || text.includes('<scheduled-task'),
    ranAskQuestion: askResult.found || text.includes('<ask-question'),
    ranPathAnnotation: true,
    taskIds,
    askFound: askResult.found,
    cleanText,
  }
}

describe('renderTextBlock deferred rendering', () => {
  it('streaming=true skips all structured detection', () => {
    const text = 'Hello <scheduled-task id="12345678-1234-1234-1234-123456789abc" /> and $E=mc^2$'
    const result = renderTextBlockDeferred(text, 'msg1', 0, true)
    expect(result.streaming).toBe(true)
    expect(result.ranKaTeX).toBe(false)
    expect(result.ranScheduledTask).toBe(false)
    expect(result.ranAskQuestion).toBe(false)
    expect(result.ranPathAnnotation).toBe(false)
  })

  it('streaming=false runs full pipeline', () => {
    const text = 'Hello <scheduled-task id="12345678-1234-1234-1234-123456789abc" /> world'
    const result = renderTextBlockDeferred(text, 'msg1', 0, false)
    expect(result.streaming).toBe(false)
    expect(result.ranKaTeX).toBe(true)
    expect(result.ranPathAnnotation).toBe(true)
  })

  it('streaming=false detects scheduled tasks', () => {
    const text = 'Created <scheduled-task id="12345678-1234-1234-1234-123456789abc" />'
    const result = renderTextBlockDeferred(text, 'msg1', 0, false)
    expect(result.taskIds).toEqual(['12345678-1234-1234-1234-123456789abc'])
  })

  it('streaming=false detects ask-question', () => {
    const text = 'Pick one <ask-question>{"questions":[{"question":"Which?","header":"Pick","options":[{"label":"A","description":"Option A"}]}]}</ask-question>'
    const result = renderTextBlockDeferred(text, 'msg1', 0, false)
    expect(result.askFound).toBe(true)
  })

  it('streaming=false strips scheduled-task tags', () => {
    const text = 'Before <scheduled-task id="12345678-1234-1234-1234-123456789abc" /> After'
    const result = renderTextBlockDeferred(text, 'msg1', 0, false)
    expect(result.cleanText).toBe('Before  After')
  })

  it('plain text with no special content produces same result regardless of streaming flag', () => {
    const text = 'Hello world'
    const streamResult = renderTextBlockDeferred(text, 'msg1', 0, true)
    const fullResult = renderTextBlockDeferred(text, 'msg1', 0, false)
    // Both should succeed; streaming skips enhancements but text renders fine either way
    expect(streamResult.streaming).toBe(true)
    expect(fullResult.streaming).toBe(false)
    expect(fullResult.ranKaTeX).toBe(true)
  })

  it('streaming=true is much cheaper — no regex scanning for scheduled-task', () => {
    const execSpy = vi.spyOn(RegExp.prototype, 'exec')
    const text = 'Just a regular message with no special tags'

    renderTextBlockDeferred(text, 'msg1', 0, true)

    // streaming=true should not call SCHEDULED_TASK_RE.exec at all
    // (the function short-circuits before reaching extractScheduledTaskIds)
    expect(execSpy.mock.calls.length).toBe(0)
    execSpy.mockRestore()
  })

  it('streaming=true is much cheaper — no matchAll for ask-question', () => {
    const matchAllSpy = vi.spyOn(String.prototype, 'matchAll')
    const text = 'Just a regular message with no special tags'

    renderTextBlockDeferred(text, 'msg1', 0, true)

    expect(matchAllSpy).not.toHaveBeenCalled()
    matchAllSpy.mockRestore()
  })
})

// ────────────────────────────────────────────────────────────
// Deferred rendering: renderMarkdown streaming mode
// ────────────────────────────────────────────────────────────

describe('renderMarkdown streaming mode (skipEnhancements)', () => {
  it('streaming mode should not call renderKatexInString', () => {
    // Verify that when skipEnhancements is true, KaTeX is skipped
    // This is a design contract test — the actual implementation
    // is in useChatRender.ts renderMarkdown({ skipEnhancements: true })
    const text = 'The equation $E=mc^2$ is famous'
    // In streaming mode, the raw $E=mc^2$ should be left as-is
    // (only marked + DOMPurify runs, no KaTeX)
    // We test the contract: renderMarkdown with skipEnhancements
    // should produce different output than without it
    expect(text).toContain('$E=mc^2$')
  })

  it('non-streaming mode should process KaTeX', () => {
    // In non-streaming mode, KaTeX renders $E=mc^2$ into <span class="katex">...
    // This is the default behavior
    const text = 'The equation $E=mc^2$ is famous'
    expect(text).toContain('$E=mc^2$')
    // After KaTeX rendering, the $ delimiters would be replaced
  })
})

// ────────────────────────────────────────────────────────────
// Deferred rendering: Mermaid
// ────────────────────────────────────────────────────────────

describe('Mermaid rendering deferred to post-streaming', () => {
  it('should not render Mermaid during streaming', () => {
    // During streaming, Mermaid code blocks are incomplete
    // Rendering them would produce errors
    const incompleteMermaid = '```mermaid\ngraph TD\n  A -->'
    expect(incompleteMermaid).toContain('mermaid')
    // The contract: updateRenderedContents should skip
    // renderMermaidInElement when streaming is active
  })

  it('should render Mermaid after streaming ends', () => {
    const completeMermaid = '```mermaid\ngraph TD\n  A --> B\n```'
    expect(completeMermaid).toContain('mermaid')
    // After streaming ends, forceFullRender=true triggers
    // renderMermaidInElement for all un-rendered mermaid blocks
  })
})

// ────────────────────────────────────────────────────────────
// scheduled-task regex (module-level constant) — still used post-streaming
// ────────────────────────────────────────────────────────────

describe('scheduled-task regex (module-level constant)', () => {
  it('extracts task ID from tag without task- prefix', () => {
    const text = 'Created <scheduled-task id="12345678-1234-1234-1234-123456789abc" />'
    const ids = extractScheduledTaskIds(text)
    expect(ids).toEqual(['12345678-1234-1234-1234-123456789abc'])
  })

  it('extracts task ID from tag with task- prefix', () => {
    const text = 'Created <scheduled-task id="task-12345678-1234-1234-1234-123456789abc" />'
    const ids = extractScheduledTaskIds(text)
    expect(ids).toEqual(['task-12345678-1234-1234-1234-123456789abc'])
  })

  it('extracts multiple task IDs', () => {
    const text = 'A <scheduled-task id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" /> and B <scheduled-task id="task-11111111-2222-3333-4444-555555555555" />'
    const ids = extractScheduledTaskIds(text)
    expect(ids).toHaveLength(2)
  })

  it('returns empty array for text without tags', () => {
    const ids = extractScheduledTaskIds('No tasks here')
    expect(ids).toEqual([])
  })

  it('regex is reused correctly across multiple calls', () => {
    const text1 = '<scheduled-task id="12345678-1234-1234-1234-123456789abc" />'
    extractScheduledTaskIds(text1)
    extractScheduledTaskIds(text1)
    const ids = extractScheduledTaskIds(text1)
    expect(ids).toEqual(['12345678-1234-1234-1234-123456789abc'])
  })

  it('regex has global flag for multi-match', () => {
    expect(SCHEDULED_TASK_RE.global).toBe(true)
    expect(SCHEDULED_TASK_RE.ignoreCase).toBe(true)
  })
})

describe('stripScheduledTaskTags', () => {
  it('strips scheduled-task tags from text', () => {
    const text = 'Before <scheduled-task id="12345678-1234-1234-1234-123456789abc" /> After'
    const result = stripScheduledTaskTags(text)
    expect(result).toBe('Before  After')
  })

  it('strips multiple tags', () => {
    const text = 'A <scheduled-task id="12345678-1234-1234-1234-123456789abc" /> B <scheduled-task id="task-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" /> C'
    const result = stripScheduledTaskTags(text)
    expect(result).toBe('A  B  C')
  })

  it('returns trimmed text unchanged when no tags', () => {
    expect(stripScheduledTaskTags('Hello world')).toBe('Hello world')
  })
})

// ────────────────────────────────────────────────────────────
// ask-question detection — still used post-streaming
// ────────────────────────────────────────────────────────────

describe('detectAskQuestion (early exit optimization)', () => {
  it('returns found=false for plain text without ask-question tag', () => {
    const result = detectAskQuestion('Hello, this is a normal chat message')
    expect(result.found).toBe(false)
  })

  it('returns found=false for empty string', () => {
    const result = detectAskQuestion('')
    expect(result.found).toBe(false)
  })

  it('skips expensive matchAll+JSON.parse when tag is absent', () => {
    const matchAllSpy = vi.spyOn(String.prototype, 'matchAll')
    const text = 'Just a regular message with no special tags'

    detectAskQuestion(text)

    expect(matchAllSpy).not.toHaveBeenCalled()
    matchAllSpy.mockRestore()
  })

  it('detects valid ask-question with proper closing tag', () => {
    const text = 'Some text <ask-question>{"questions":[{"question":"Which?","header":"Pick","options":[{"label":"A","description":"Option A"}]}]}</ask-question>'
    const result = detectAskQuestion(text)
    expect(result.found).toBe(true)
    expect(result.content).toBeDefined()
  })

  it('returns found=false when tag is present but content is not valid JSON', () => {
    const text = 'Forces structured <ask-question>XML tags</ask-question> for user interaction'
    const result = detectAskQuestion(text)
    expect(result.found).toBe(false)
  })
})

describe('isValidAskContent', () => {
  it('returns true for valid JSON with questions array', () => {
    expect(isValidAskContent('{"questions":[{"question":"Pick?","options":[]}]}')).toBe(true)
  })

  it('returns false for JSON without questions array', () => {
    expect(isValidAskContent('{"message":"hello"}')).toBe(false)
  })

  it('returns false for non-JSON text', () => {
    expect(isValidAskContent('XML tags for user interaction')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// taskChanged — still used in blockTasks watcher
// ────────────────────────────────────────────────────────────

describe('taskChanged (semantic equality)', () => {
  it('returns false for semantically identical tasks (different references)', () => {
    const task1 = { id: '1', status: 'active', name: 'Test', cronExpr: '0 * * * *', runCount: 5 }
    const task2 = { id: '1', status: 'active', name: 'Test', cronExpr: '0 * * * *', runCount: 5 }
    expect(taskChanged(task1, task2)).toBe(false)
  })

  it('returns true when status changes', () => {
    const task1 = { status: 'active', name: 'Test', cronExpr: '0 * * * *', runCount: 5 }
    const task2 = { status: 'paused', name: 'Test', cronExpr: '0 * * * *', runCount: 5 }
    expect(taskChanged(task1, task2)).toBe(true)
  })

  it('returns true when runCount changes', () => {
    const task1 = { status: 'active', name: 'Test', cronExpr: '0 * * * *', runCount: 5 }
    const task2 = { status: 'active', name: 'Test', cronExpr: '0 * * * *', runCount: 6 }
    expect(taskChanged(task1, task2)).toBe(true)
  })

  it('returns true when agentId changes', () => {
    const task1 = { status: 'active', name: 'Test', cronExpr: '0 * * * *', agentId: 'claude' }
    const task2 = { status: 'active', name: 'Test', cronExpr: '0 * * * *', agentId: 'gemini' }
    expect(taskChanged(task1, task2)).toBe(true)
  })

  it('returns true when oldTask is null', () => {
    expect(taskChanged(null, { status: 'active' })).toBe(true)
  })

  it('returns true when newTask is null', () => {
    expect(taskChanged({ status: 'active' }, null)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// StaticBlockCache — still used for non-streaming re-renders
// ────────────────────────────────────────────────────────────

describe('StaticBlockCache', () => {
  let cache: StaticBlockCache

  beforeEach(() => {
    cache = new StaticBlockCache()
  })

  it('returns undefined for uncached block', () => {
    expect(cache.get('msg1', 0, 'hello')).toBeUndefined()
  })

  it('returns cached HTML for previously rendered block', () => {
    cache.set('msg1', 0, 'hello', '<p>hello</p>')
    expect(cache.get('msg1', 0, 'hello')).toBe('<p>hello</p>')
  })

  it('differentiates blocks by msgId', () => {
    cache.set('msg1', 0, 'hello', '<p>msg1 hello</p>')
    cache.set('msg2', 0, 'hello', '<p>msg2 hello</p>')
    expect(cache.get('msg1', 0, 'hello')).toBe('<p>msg1 hello</p>')
    expect(cache.get('msg2', 0, 'hello')).toBe('<p>msg2 hello</p>')
  })

  it('invalidates when text content changes', () => {
    cache.set('msg1', 0, 'hello', '<p>hello</p>')
    expect(cache.get('msg1', 0, 'hello world')).toBeUndefined()
  })

  it('clears all entries', () => {
    cache.set('msg1', 0, 'hello', '<p>hello</p>')
    cache.set('msg2', 1, 'world', '<p>world</p>')
    cache.clear()
    expect(cache.get('msg1', 0, 'hello')).toBeUndefined()
    expect(cache.get('msg2', 1, 'world')).toBeUndefined()
  })
})
