import { describe, expect, it, vi } from 'vitest'
import { baseName } from '@/utils/path.ts'

// ────────────────────────────────────────────────────────────
// toolCallSummary logic (extracted from useChatRender for testing)
// The actual function lives inside useChatRender composable.
// We replicate the logic here to test the field priority chain.
// ────────────────────────────────────────────────────────────

function toolCallSummary(block: { input?: any; name?: string }): string {
  if (!block.input) return ''
  const name = (block.name || '').toLowerCase()
  // AskUserQuestion: show first question header
  if (name === 'askuserquestion' && Array.isArray(block.input.questions) && block.input.questions.length > 0) {
    const q = block.input.questions[0]
    const header = q.header || ''
    const question = q.question || ''
    if (header) return header
    if (question) return question.length > 60 ? question.slice(0, 57) + '...' : question
  }
  // Prefer description (human-readable intent) over raw input values
  if (block.input.description) return block.input.description
  const obj = block.input
  if (obj.file_path) return baseName(obj.file_path)
  if (obj.command) return obj.command.length > 60 ? obj.command.slice(0, 57) + '...' : obj.command
  // Grep/Glob: show pattern
  if (obj.pattern) return obj.pattern.length > 60 ? obj.pattern.slice(0, 57) + '...' : obj.pattern
  // WebSearch: show query
  if (obj.query) return obj.query.length > 60 ? obj.query.slice(0, 57) + '...' : obj.query
  // WebFetch: show url
  if (obj.url) return obj.url.length > 60 ? obj.url.slice(0, 57) + '...' : obj.url
  // Skill: show skill name
  if (obj.skill) return obj.skill
  // Agent: show description or prompt summary (description already handled above)
  if (obj.prompt && name === 'agent') return obj.prompt.length > 60 ? obj.prompt.slice(0, 57) + '...' : obj.prompt
  if (obj.path) return baseName(obj.path)
  if (obj.src_path && obj.dst_path) return `${baseName(obj.src_path)} → ${baseName(obj.dst_path)}`
  const firstVal = Object.values(obj)[0]
  if (typeof firstVal === 'string' && firstVal.length < 80) return firstVal
  return ''
}

describe('toolCallSummary', () => {
  // ── Edge cases ──
  it('returns empty string for null input', () => {
    expect(toolCallSummary({ input: null })).toBe('')
  })

  it('returns empty string for undefined input', () => {
    expect(toolCallSummary({ input: undefined })).toBe('')
  })

  it('returns empty string for empty input object', () => {
    expect(toolCallSummary({ input: {} })).toBe('')
  })

  // ── AskUserQuestion ──
  it('shows question header for AskUserQuestion', () => {
    expect(toolCallSummary({
      name: 'AskUserQuestion',
      input: { questions: [{ header: 'Choose approach', question: 'Which one?' }] },
    })).toBe('Choose approach')
  })

  it('shows question text when header is missing', () => {
    expect(toolCallSummary({
      name: 'AskUserQuestion',
      input: { questions: [{ question: 'Which approach to use?' }] },
    })).toBe('Which approach to use?')
  })

  it('truncates long question text', () => {
    const longQuestion = 'A'.repeat(70)
    const result = toolCallSummary({
      name: 'AskUserQuestion',
      input: { questions: [{ question: longQuestion }] },
    })
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result).toContain('...')
  })

  // ── Description priority ──
  it('prefers description over file_path', () => {
    expect(toolCallSummary({
      input: { description: 'Fix the bug', file_path: '/tmp/test.go' },
    })).toBe('Fix the bug')
  })

  it('prefers description over command', () => {
    expect(toolCallSummary({
      input: { description: 'Run tests', command: 'npm test' },
    })).toBe('Run tests')
  })

  it('prefers description over pattern', () => {
    expect(toolCallSummary({
      input: { description: 'Search for TODOs', pattern: 'TODO' },
    })).toBe('Search for TODOs')
  })

  // ── file_path ──
  it('shows baseName for file_path', () => {
    expect(toolCallSummary({
      input: { file_path: '/home/user/project/main.go' },
    })).toBe('main.go')
  })

  // ── command ──
  it('shows command', () => {
    expect(toolCallSummary({
      input: { command: 'npm test' },
    })).toBe('npm test')
  })

  it('truncates long command', () => {
    const longCmd = 'npx '.repeat(20)
    const result = toolCallSummary({ input: { command: longCmd } })
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result).toContain('...')
  })

  // ── pattern (Grep/Glob) ──
  it('shows pattern for Grep', () => {
    expect(toolCallSummary({
      name: 'Grep',
      input: { pattern: 'TODO', path: './src' },
    })).toBe('TODO')
  })

  it('shows pattern for Glob', () => {
    expect(toolCallSummary({
      name: 'Glob',
      input: { pattern: '**/*.go', path: '.' },
    })).toBe('**/*.go')
  })

  it('truncates long pattern', () => {
    const longPattern = '['.repeat(70) + 'test' + ']'.repeat(70)
    const result = toolCallSummary({ input: { pattern: longPattern } })
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result).toContain('...')
  })

  it('pattern has lower priority than file_path', () => {
    // file_path is checked before pattern
    expect(toolCallSummary({
      input: { file_path: 'main.go', pattern: 'TODO' },
    })).toBe('main.go')
  })

  // ── query (WebSearch) ──
  it('shows query for WebSearch', () => {
    expect(toolCallSummary({
      name: 'WebSearch',
      input: { query: 'golang testing best practices' },
    })).toBe('golang testing best practices')
  })

  it('truncates long query', () => {
    const longQuery = 'how to '.repeat(15)
    const result = toolCallSummary({ input: { query: longQuery } })
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result).toContain('...')
  })

  it('query has lower priority than pattern', () => {
    // pattern is checked before query
    expect(toolCallSummary({
      input: { pattern: 'TODO', query: 'search query' },
    })).toBe('TODO')
  })

  // ── url (WebFetch) ──
  it('shows url for WebFetch', () => {
    expect(toolCallSummary({
      name: 'WebFetch',
      input: { url: 'https://example.com' },
    })).toBe('https://example.com')
  })

  it('truncates long url', () => {
    const longUrl = 'https://' + 'a'.repeat(100) + '.com'
    const result = toolCallSummary({ input: { url: longUrl } })
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result).toContain('...')
  })

  it('url has lower priority than query', () => {
    expect(toolCallSummary({
      input: { query: 'search query', url: 'https://example.com' },
    })).toBe('search query')
  })

  // ── skill (Skill) ──
  it('shows skill name for Skill tool', () => {
    expect(toolCallSummary({
      name: 'Skill',
      input: { skill: 'commit' },
    })).toBe('commit')
  })

  it('skill has lower priority than url', () => {
    expect(toolCallSummary({
      input: { url: 'https://example.com', skill: 'commit' },
    })).toBe('https://example.com')
  })

  // ── prompt (Agent) ──
  it('shows prompt for Agent tool when no description', () => {
    expect(toolCallSummary({
      name: 'Agent',
      input: { prompt: 'Research the codebase' },
    })).toBe('Research the codebase')
  })

  it('shows description instead of prompt for Agent', () => {
    // description is higher priority (checked before prompt)
    expect(toolCallSummary({
      name: 'Agent',
      input: { description: 'Fix the bug', prompt: 'Long detailed prompt...' },
    })).toBe('Fix the bug')
  })

  it('truncates long prompt for Agent', () => {
    const longPrompt = 'P'.repeat(70)
    const result = toolCallSummary({
      name: 'Agent',
      input: { prompt: longPrompt },
    })
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result).toContain('...')
  })

  it('prompt fallback for non-Agent tools goes to firstVal', () => {
    // For non-Agent tools, the agent-specific prompt check is skipped,
    // but prompt is still a valid first value for the generic fallback
    expect(toolCallSummary({
      name: 'Bash',
      input: { prompt: 'Some prompt' },
    })).toBe('Some prompt')
  })

  // ── path ──
  it('shows baseName for path', () => {
    expect(toolCallSummary({
      input: { path: '/home/user/project/src' },
    })).toBe('src')
  })

  // ── src_path + dst_path ──
  it('shows src → dst for move operations', () => {
    expect(toolCallSummary({
      input: { src_path: '/old/path/file.go', dst_path: '/new/path/file.go' },
    })).toBe('file.go → file.go')
  })

  // ── Fallback: first value ──
  it('shows first string value as fallback', () => {
    expect(toolCallSummary({
      input: { custom_field: 'hello world' },
    })).toBe('hello world')
  })

  it('ignores first value if too long (>= 80 chars)', () => {
    const longVal = 'X'.repeat(80)
    expect(toolCallSummary({
      input: { custom_field: longVal },
    })).toBe('')
  })

  it('ignores first value if not a string', () => {
    expect(toolCallSummary({
      input: { count: 42 },
    })).toBe('')
  })
})
