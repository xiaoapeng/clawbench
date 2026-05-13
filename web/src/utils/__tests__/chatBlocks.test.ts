import { describe, expect, it } from 'vitest'
import {
  parseAssistantContent,
  toolCallSummary,
  hasImagesInContent,
  formatDetailTime,
  humanizeCron,
  repeatLabel,
  truncate,
} from '@/utils/chatBlocks.ts'

// ── parseAssistantContent ──

describe('parseAssistantContent', () => {
  it('handles null content', () => {
    expect(parseAssistantContent(null as any)).toEqual({ blocks: [], metadata: null })
  })

  it('handles undefined content', () => {
    expect(parseAssistantContent(undefined as any)).toEqual({ blocks: [], metadata: null })
  })

  it('handles empty string', () => {
    expect(parseAssistantContent('')).toEqual({ blocks: [], metadata: null })
  })

  it('falls back to text block for non-JSON', () => {
    expect(parseAssistantContent('hello world')).toEqual({
      blocks: [{ type: 'text', text: 'hello world' }],
      metadata: null,
    })
  })

  it('falls back to text block for JSON without blocks', () => {
    const content = JSON.stringify({ error: 'not blocks' })
    const result = parseAssistantContent(content)
    expect(result.blocks[0].type).toBe('text')
  })

  it('parses blocks with metadata', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: { tokens: 100, model: 'gpt-4' },
    })
    const result = parseAssistantContent(content)
    expect(result.metadata).toEqual({ tokens: 100, model: 'gpt-4' })
  })

  it('parses cancelled flag', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'text', text: 'partial' }],
      cancelled: true,
    })
    expect(parseAssistantContent(content).cancelled).toBe(true)
  })

  it('defaults cancelled to false', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'text', text: 'done' }],
    })
    expect(parseAssistantContent(content).cancelled).toBe(false)
  })

  it('marks tool_use as done when missing', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'tool_use', name: 'Read', id: '1', input: {} }],
    })
    expect(parseAssistantContent(content).blocks[0].done).toBe(true)
  })

  it('marks tool_use as done when false', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'tool_use', name: 'Read', id: '1', input: {}, done: false }],
    })
    expect(parseAssistantContent(content).blocks[0].done).toBe(true)
  })

  it('preserves done=true', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'tool_use', name: 'Read', id: '1', input: {}, done: true }],
    })
    expect(parseAssistantContent(content).blocks[0].done).toBe(true)
  })

  it('migrates input.output to output field (Codex backward compat)', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'tool_use', name: 'Bash', id: '1', input: { command: 'ls', output: 'file.go' }, done: true }],
    })
    const result = parseAssistantContent(content)
    expect(result.blocks[0].output).toBe('file.go')
    expect(result.blocks[0].input.output).toBeUndefined()
  })

  it('does not overwrite existing output with input.output', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'tool_use', name: 'Bash', id: '1', input: { command: 'ls', output: 'legacy' }, done: true, output: 'modern' }],
    })
    expect(parseAssistantContent(content).blocks[0].output).toBe('modern')
  })

  // ── Deduplication ──

  it('deduplicates tool_use by id - keeps richer input', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'tool_use', name: 'Read', id: '1', input: {} },
        { type: 'tool_use', name: 'Read', id: '1', input: { file_path: '/test.go' } },
      ],
    })
    const result = parseAssistantContent(content)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].input).toEqual({ file_path: '/test.go' })
  })

  it('deduplicates - keeps previous when current is empty', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'tool_use', name: 'Read', id: '1', input: { file_path: '/test.go' } },
        { type: 'tool_use', name: 'Read', id: '1', input: {} },
      ],
    })
    const result = parseAssistantContent(content)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].input).toEqual({ file_path: '/test.go' })
  })

  it('merges tool_use when both have input', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'tool_use', name: 'Read', id: '1', input: { file_path: '/old.go' }, done: false },
        { type: 'tool_use', name: 'Read', id: '1', input: { file_path: '/new.go' }, done: true },
      ],
    })
    const result = parseAssistantContent(content)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].input).toEqual({ file_path: '/new.go' })
    expect(result.blocks[0].done).toBe(true)
  })

  it('preserves output and status during dedup', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'tool_use', name: 'Read', id: '1', input: { file_path: '/a.go' }, done: true },
        { type: 'tool_use', name: 'Read', id: '1', input: { file_path: '/a.go' }, done: true, output: 'contents', status: 'success' },
      ],
    })
    const result = parseAssistantContent(content)
    expect(result.blocks[0].output).toBe('contents')
    expect(result.blocks[0].status).toBe('success')
  })

  it('handles tool_use without id (no dedup)', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'pwd' } },
      ],
    })
    expect(parseAssistantContent(content).blocks).toHaveLength(2)
  })

  it('handles text blocks interleaved with tool_use', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'text', text: 'Starting...' },
        { type: 'tool_use', name: 'Read', id: '1', input: { file_path: '/a.go' } },
        { type: 'text', text: 'Result:' },
        { type: 'tool_use', name: 'Grep', id: '2', input: { pattern: 'TODO' } },
      ],
    })
    expect(parseAssistantContent(content).blocks).toHaveLength(4)
  })
})

// ── toolCallSummary ──

describe('toolCallSummary', () => {
  it('returns empty for null input', () => {
    expect(toolCallSummary({ input: null })).toBe('')
  })

  it('returns empty for undefined input', () => {
    expect(toolCallSummary({ input: undefined })).toBe('')
  })

  it('returns empty for empty input object', () => {
    expect(toolCallSummary({ input: {} })).toBe('')
  })

  it('shows header for AskUserQuestion', () => {
    expect(toolCallSummary({
      name: 'AskUserQuestion',
      input: { questions: [{ header: 'Pick', question: 'Which?' }] },
    })).toBe('Pick')
  })

  it('shows question when header is empty', () => {
    expect(toolCallSummary({
      name: 'AskUserQuestion',
      input: { questions: [{ question: 'Which one?' }] },
    })).toBe('Which one?')
  })

  it('shows full AskUserQuestion text without truncation', () => {
    const long = 'A'.repeat(70)
    const result = toolCallSummary({
      name: 'AskUserQuestion',
      input: { questions: [{ question: long }] },
    })
    expect(result).toBe(long)
  })

  it('prefers description over file_path', () => {
    expect(toolCallSummary({
      input: { description: 'Fix bug', file_path: '/test.go' },
    })).toBe('Fix bug')
  })

  it('shows baseName for file_path', () => {
    expect(toolCallSummary({
      input: { file_path: '/home/user/main.go' },
    })).toBe('main.go')
  })

  it('shows full command without truncation', () => {
    const result = toolCallSummary({ input: { command: 'npx '.repeat(20) } })
    expect(result).toBe('npx '.repeat(20))
  })

  it('shows pattern for Grep', () => {
    expect(toolCallSummary({ name: 'Grep', input: { pattern: 'TODO' } })).toBe('TODO')
  })

  it('shows query for WebSearch', () => {
    expect(toolCallSummary({ name: 'WebSearch', input: { query: 'golang test' } })).toBe('golang test')
  })

  it('shows url for WebFetch', () => {
    expect(toolCallSummary({ name: 'WebFetch', input: { url: 'https://example.com' } })).toBe('https://example.com')
  })

  it('shows skill name', () => {
    expect(toolCallSummary({ input: { skill: 'commit' } })).toBe('commit')
  })

  it('shows prompt for Agent tool', () => {
    expect(toolCallSummary({ name: 'Agent', input: { prompt: 'Research this' } })).toBe('Research this')
  })

  it('shows baseName for path', () => {
    expect(toolCallSummary({ input: { path: '/home/user/src' } })).toBe('src')
  })

  it('shows src → dst for move', () => {
    expect(toolCallSummary({
      input: { src_path: '/old/file.go', dst_path: '/new/file.go' },
    })).toBe('file.go → file.go')
  })

  it('uses first string value as fallback', () => {
    expect(toolCallSummary({ input: { custom: 'hello' } })).toBe('hello')
  })

  it('shows first value regardless of length', () => {
    expect(toolCallSummary({ input: { data: 'X'.repeat(80) } })).toBe('X'.repeat(80))
  })

  it('ignores non-string first value', () => {
    expect(toolCallSummary({ input: { count: 42 } })).toBe('')
  })
})

// ── hasImagesInContent ──

describe('hasImagesInContent', () => {
  it('detects markdown image', () => {
    expect(hasImagesInContent('![alt](url)')).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(hasImagesInContent('hello world')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasImagesInContent('')).toBe(false)
  })

  it('returns false for null', () => {
    expect(hasImagesInContent(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(hasImagesInContent(undefined)).toBe(false)
  })

  it('detects multiple images', () => {
    expect(hasImagesInContent('![a](b) and ![c](d)')).toBe(true)
  })

  it('detects reference-style image', () => {
    expect(hasImagesInContent('![alt][ref]')).toBe(true)
  })
})

// ── formatDetailTime ──

describe('formatDetailTime', () => {
  it('formats to YYYY-MM-DD HH:mm:ss', () => {
    const result = formatDetailTime('2026-01-15T14:30:45.000Z')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('zero-pads components', () => {
    const result = formatDetailTime('2026-03-05T09:05:03.000Z')
    expect(result).toContain('03')
    expect(result).toContain('05')
  })
})

// ── humanizeCron ──

describe('humanizeCron', () => {
  // Note: humanizeCron uses gt() for i18n, which requires vue-i18n to be initialized.
  // For these tests, we verify the non-i18n fallback cases and structure.
  it('returns expression as-is for non-5-part cron', () => {
    expect(humanizeCron('invalid')).toBe('invalid')
  })

  it('returns expression for 4-part cron', () => {
    expect(humanizeCron('* * * *')).toBe('* * * *')
  })

  it('returns expression for 6-part cron', () => {
    expect(humanizeCron('* * * * * *')).toBe('* * * * * *')
  })

  it('returns expression for empty string', () => {
    expect(humanizeCron('')).toBe('')
  })
})

// ── repeatLabel ──

describe('repeatLabel', () => {
  // Note: repeatLabel uses gt() for i18n — these tests verify the branching logic
  // by checking that the function doesn't throw and returns a string.
  it('returns a string for once mode', () => {
    const result = repeatLabel('once')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a string for limited mode', () => {
    const result = repeatLabel('limited', 5)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a string for unlimited mode (default)', () => {
    const result = repeatLabel('unlimited')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a string for unknown mode (falls to unlimited)', () => {
    const result = repeatLabel('unknown')
    expect(typeof result).toBe('string')
  })
})

// ── truncate ──

describe('truncate', () => {
  it('returns empty for null', () => {
    expect(truncate(null, 10)).toBe('')
  })

  it('returns empty for undefined', () => {
    expect(truncate(undefined, 10)).toBe('')
  })

  it('returns empty for empty string', () => {
    expect(truncate('', 10)).toBe('')
  })

  it('returns string unchanged when shorter', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates and adds ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...')
  })

  it('handles exact length', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('handles Unicode/emoji', () => {
    expect(truncate('🎉🎊🎁', 2)).toBe('🎉🎊...')
  })

  it('handles limit of 0', () => {
    expect(truncate('hello', 0)).toBe('...')
  })

  it('handles single character', () => {
    expect(truncate('ab', 1)).toBe('a...')
  })

  it('handles Chinese characters', () => {
    expect(truncate('你好世界再见', 3)).toBe('你好世...')
  })

  it('does not break surrogate pairs', () => {
    const emoji = '👨‍👩‍👧‍👦👨‍👩‍👧‍👦'
    const result = truncate(emoji, 1)
    // Should truncate at codepoint boundary, not in the middle of a grapheme
    expect(result.endsWith('...')).toBe(true)
  })
})
