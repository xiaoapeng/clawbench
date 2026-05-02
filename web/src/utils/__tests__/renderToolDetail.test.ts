import { describe, expect, it, vi } from 'vitest'
import {
  formatToolInput,
  shouldAutoExpandTool,
  registerToolRenderer,
  handleToolAction,
} from '@/utils/renderToolDetail.ts'

// ── Helpers ──

/** Extract text content from HTML, stripping all tags */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

/** Check if HTML contains a specific CSS class */
function hasClass(html: string, className: string): boolean {
  return html.includes(`class="${className}"`) || html.includes(`class='${className}'`)
}

/** Check if HTML contains a specific substring */
function contains(html: string, substring: string): boolean {
  return html.includes(substring)
}

// ────────────────────────────────────────────────────────────
// formatToolInput — registry dispatch + individual renderers
// ────────────────────────────────────────────────────────────

describe('formatToolInput', () => {
  // ── Grep ──
  describe('Grep renderer', () => {
    it('renders pattern with label', () => {
      const html = formatToolInput({ pattern: 'TODO', path: './src' }, 'Grep')
      expect(contains(html, 'grep-search-view')).toBe(true)
      expect(contains(html, 'grep-label')).toBe(true)
      expect(contains(html, 'TODO')).toBe(true)
      expect(contains(html, 'grep-pattern-text')).toBe(true)
    })

    it('renders path row when path is provided', () => {
      const html = formatToolInput({ pattern: 'FIXME', path: './lib' }, 'Grep')
      expect(contains(html, 'grep-path-row')).toBe(true)
      expect(contains(html, 'lib')).toBe(true)
    })

    it('omits path row when path is empty', () => {
      const html = formatToolInput({ pattern: 'TODO' }, 'Grep')
      expect(contains(html, 'grep-path-row')).toBe(false)
    })

    it('renders output_mode tag when present', () => {
      const html = formatToolInput({ pattern: 'test', output_mode: 'files_with_matches' }, 'Grep')
      expect(contains(html, 'grep-mode-tag')).toBe(true)
      expect(contains(html, 'files_with_matches')).toBe(true)
    })

    it('omits output_mode tag when not present', () => {
      const html = formatToolInput({ pattern: 'test' }, 'Grep')
      expect(contains(html, 'grep-mode-tag')).toBe(false)
    })

    it('case-insensitive lookup', () => {
      const htmlUpper = formatToolInput({ pattern: 'TODO' }, 'GREP')
      const htmlLower = formatToolInput({ pattern: 'TODO' }, 'grep')
      // Both should produce grep-search-view
      expect(contains(htmlUpper, 'grep-search-view')).toBe(true)
      expect(contains(htmlLower, 'grep-search-view')).toBe(true)
    })
  })

  // ── Glob ──
  describe('Glob renderer', () => {
    it('renders pattern with label', () => {
      const html = formatToolInput({ pattern: '**/*.go' }, 'Glob')
      expect(contains(html, 'glob-pattern-view')).toBe(true)
      expect(contains(html, '**/*.go')).toBe(true)
      expect(contains(html, 'glob-pattern-text')).toBe(true)
    })

    it('renders path row when path is provided', () => {
      const html = formatToolInput({ pattern: '*.ts', path: './src' }, 'Glob')
      expect(contains(html, 'glob-path-row')).toBe(true)
      expect(contains(html, 'src')).toBe(true)
    })

    it('omits path row when path is empty', () => {
      const html = formatToolInput({ pattern: '*.go' }, 'Glob')
      expect(contains(html, 'glob-path-row')).toBe(false)
    })
  })

  // ── WebSearch ──
  describe('WebSearch renderer', () => {
    it('renders search query with icon', () => {
      const html = formatToolInput({ query: 'golang testing best practices' }, 'WebSearch')
      expect(contains(html, 'web-search-view')).toBe(true)
      expect(contains(html, 'web-search-icon')).toBe(true)
      expect(contains(html, 'golang testing best practices')).toBe(true)
    })

    it('escapes HTML in query', () => {
      const html = formatToolInput({ query: '<script>alert(1)</script>' }, 'WebSearch')
      expect(contains(html, '<script>')).toBe(false)
      expect(contains(html, '&lt;script&gt;')).toBe(true)
    })

    it('renders empty query gracefully', () => {
      const html = formatToolInput({ query: '' }, 'WebSearch')
      expect(contains(html, 'web-search-view')).toBe(true)
    })
  })

  // ── WebFetch ──
  describe('WebFetch renderer', () => {
    it('renders URL as clickable link for http URLs', () => {
      const html = formatToolInput({ url: 'https://example.com' }, 'WebFetch')
      expect(contains(html, 'web-fetch-link')).toBe(true)
      expect(contains(html, 'href="https://example.com"')).toBe(true)
      expect(contains(html, 'target="_blank"')).toBe(true)
    })

    it('renders non-URL as plain text', () => {
      const html = formatToolInput({ url: 'not-a-url' }, 'WebFetch')
      expect(contains(html, 'web-fetch-text')).toBe(true)
      expect(contains(html, 'web-fetch-link')).toBe(false)
    })

    it('renders prompt when both url and prompt are present', () => {
      const html = formatToolInput({ url: 'https://example.com', prompt: 'Extract title' }, 'WebFetch')
      expect(contains(html, 'web-fetch-prompt')).toBe(true)
      expect(contains(html, 'Extract title')).toBe(true)
    })

    it('does not render prompt when only prompt exists (no url)', () => {
      // When url is empty and only prompt exists, prompt is used as url display text
      const html = formatToolInput({ prompt: 'Some text' }, 'WebFetch')
      // prompt is used as the fallback url display but not shown as separate prompt section
      expect(contains(html, 'Some text')).toBe(true)
    })

    it('renders URL label', () => {
      const html = formatToolInput({ url: 'https://example.com' }, 'WebFetch')
      expect(contains(html, 'web-fetch-label')).toBe(true)
      expect(contains(html, 'URL')).toBe(true)
    })
  })

  // ── Agent ──
  describe('Agent renderer', () => {
    it('renders subagent type badge', () => {
      const html = formatToolInput({ subagent_type: 'general-purpose', description: 'Research task' }, 'Agent')
      expect(contains(html, 'agent-type-badge')).toBe(true)
      expect(contains(html, 'general-purpose')).toBe(true)
    })

    it('renders mode as type badge fallback', () => {
      const html = formatToolInput({ mode: 'fork', description: 'Fork task' }, 'Agent')
      expect(contains(html, 'agent-type-badge')).toBe(true)
      expect(contains(html, 'fork')).toBe(true)
    })

    it('renders description', () => {
      const html = formatToolInput({ description: 'Search codebase' }, 'Agent')
      expect(contains(html, 'agent-call-desc')).toBe(true)
      expect(contains(html, 'Search codebase')).toBe(true)
    })

    it('renders truncated prompt when over 200 chars', () => {
      const longPrompt = 'A'.repeat(250)
      const html = formatToolInput({ prompt: longPrompt }, 'Agent')
      expect(contains(html, 'agent-call-prompt')).toBe(true)
      // Should be truncated with ellipsis character
      expect(contains(html, '\u2026')).toBe(true)
      // Should contain first 200 chars
      expect(contains(html, 'A'.repeat(200))).toBe(true)
    })

    it('renders full prompt when under 200 chars', () => {
      const html = formatToolInput({ prompt: 'Short prompt' }, 'Agent')
      expect(contains(html, 'Short prompt')).toBe(true)
      expect(contains(html, '\u2026')).toBe(false)
    })

    it('omits type badge when neither subagent_type nor mode', () => {
      const html = formatToolInput({ description: 'Just a desc' }, 'Agent')
      expect(contains(html, 'agent-type-badge')).toBe(false)
    })
  })

  // ── Skill ──
  describe('Skill renderer', () => {
    it('renders skill name with icon', () => {
      const html = formatToolInput({ skill: 'commit' }, 'Skill')
      expect(contains(html, 'skill-call-view')).toBe(true)
      expect(contains(html, 'skill-call-icon')).toBe(true)
      expect(contains(html, 'skill-call-name')).toBe(true)
      expect(contains(html, 'commit')).toBe(true)
    })

    it('uses command as fallback for skill name', () => {
      const html = formatToolInput({ command: 'pdf' }, 'Skill')
      expect(contains(html, 'pdf')).toBe(true)
    })

    it('renders string args', () => {
      const html = formatToolInput({ skill: 'commit', args: '-m "fix bug"' }, 'Skill')
      expect(contains(html, 'skill-call-args')).toBe(true)
      // Double quotes are HTML-escaped by escapeHtml
      expect(contains(html, '-m &quot;fix bug&quot;')).toBe(true)
    })

    it('renders object args as JSON', () => {
      const html = formatToolInput({ skill: 'commit', arguments: { m: 'fix' } }, 'Skill')
      expect(contains(html, 'skill-call-args')).toBe(true)
    })

    it('uses arguments as fallback for args', () => {
      const html = formatToolInput({ skill: 'test', arguments: 'some args' }, 'Skill')
      expect(contains(html, 'some args')).toBe(true)
    })

    it('truncates long args', () => {
      const longArgs = 'X'.repeat(200)
      const html = formatToolInput({ skill: 'test', args: longArgs }, 'Skill')
      expect(contains(html, '\u2026')).toBe(true)
    })

    it('omits args section when no args', () => {
      const html = formatToolInput({ skill: 'commit' }, 'Skill')
      expect(contains(html, 'skill-call-args')).toBe(false)
    })
  })

  // ── Existing renderers (smoke tests) ──
  describe('existing renderers', () => {
    it('Edit renders diff view', () => {
      const html = formatToolInput({ file_path: 'main.go', old_string: 'old', new_string: 'new' }, 'Edit')
      expect(contains(html, 'edit-diff-view')).toBe(true)
      expect(contains(html, 'edit-diff-del')).toBe(true)
      expect(contains(html, 'edit-diff-add')).toBe(true)
    })

    it('Bash renders terminal view', () => {
      const html = formatToolInput({ command: 'ls -la', description: 'List files' }, 'Bash')
      expect(contains(html, 'bash-terminal-view')).toBe(true)
      expect(contains(html, 'bash-terminal-desc')).toBe(true)
      expect(contains(html, 'bash-prompt')).toBe(true)
    })

    it('Read renders preview view', () => {
      const html = formatToolInput({ file_path: 'test.go', content: 'package main' }, 'Read')
      expect(contains(html, 'file-preview-view')).toBe(true)
    })

    it('Write renders write view', () => {
      const html = formatToolInput({ file_path: 'test.go', content: 'package main' }, 'Write')
      expect(contains(html, 'file-write-view')).toBe(true)
      expect(contains(html, 'file-write-badge')).toBe(true)
    })

    it('AskUserQuestion renders question view', () => {
      const html = formatToolInput({
        questions: [{ header: 'Choose', question: 'Which option?', options: [{ label: 'A' }] }],
      }, 'AskUserQuestion')
      expect(contains(html, 'ask-question-view')).toBe(true)
      expect(contains(html, 'Choose')).toBe(true)
    })
  })

  // ── JSON fallback ──
  describe('JSON fallback', () => {
    it('renders unknown tool as JSON', () => {
      const html = formatToolInput({ foo: 'bar' }, 'UnknownTool')
      expect(contains(html, 'tool-json-body')).toBe(true)
    })

    it('renders without tool name as JSON', () => {
      const html = formatToolInput({ foo: 'bar' })
      expect(contains(html, 'tool-json-body')).toBe(true)
    })

    it('renders empty object', () => {
      const html = formatToolInput({})
      expect(contains(html, 'tool-json-body')).toBe(true)
    })

    it('renders null as empty JSON', () => {
      const html = formatToolInput(null)
      expect(contains(html, 'tool-json-body')).toBe(true)
    })
  })

  // ── Registry: case-insensitive lookup ──
  describe('case-insensitive registry', () => {
    it('finds Grep regardless of case', () => {
      expect(contains(formatToolInput({ pattern: 'x' }, 'GREP'), 'grep-search-view')).toBe(true)
      expect(contains(formatToolInput({ pattern: 'x' }, 'grep'), 'grep-search-view')).toBe(true)
      expect(contains(formatToolInput({ pattern: 'x' }, 'Grep'), 'grep-search-view')).toBe(true)
    })

    it('finds Agent regardless of case', () => {
      expect(contains(formatToolInput({ description: 'test' }, 'AGENT'), 'agent-call-view')).toBe(true)
      expect(contains(formatToolInput({ description: 'test' }, 'agent'), 'agent-call-view')).toBe(true)
    })

    it('finds Skill regardless of case', () => {
      expect(contains(formatToolInput({ skill: 'test' }, 'SKILL'), 'skill-call-view')).toBe(true)
    })
  })

  // ── Custom renderer registration ──
  describe('registerToolRenderer', () => {
    it('allows registering custom renderers', () => {
      registerToolRenderer('CustomTool', (input) => `<div class="custom">${input.text}</div>`)
      const html = formatToolInput({ text: 'hello' }, 'CustomTool')
      expect(contains(html, 'custom')).toBe(true)
      expect(contains(html, 'hello')).toBe(true)
    })

    it('custom renderer is case-insensitive', () => {
      registerToolRenderer('MyTool', (input) => `<div class="my-tool">${input.val}</div>`)
      const html = formatToolInput({ val: 'test' }, 'MYTOOL')
      expect(contains(html, 'my-tool')).toBe(true)
    })
  })
})

// ────────────────────────────────────────────────────────────
// shouldAutoExpandTool
// ────────────────────────────────────────────────────────────

describe('shouldAutoExpandTool', () => {
  it('returns true for AskUserQuestion', () => {
    expect(shouldAutoExpandTool('AskUserQuestion')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(shouldAutoExpandTool('askuserquestion')).toBe(true)
    expect(shouldAutoExpandTool('ASKUSERQUESTION')).toBe(true)
  })

  it('returns false for other tools', () => {
    expect(shouldAutoExpandTool('Grep')).toBe(false)
    expect(shouldAutoExpandTool('Bash')).toBe(false)
    expect(shouldAutoExpandTool('Edit')).toBe(false)
    expect(shouldAutoExpandTool('Agent')).toBe(false)
    expect(shouldAutoExpandTool('Skill')).toBe(false)
  })

  it('returns false for unknown tools', () => {
    expect(shouldAutoExpandTool('UnknownTool')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// handleToolAction
// ────────────────────────────────────────────────────────────

describe('handleToolAction', () => {
  it('returns false for tools without action handlers', () => {
    const event = new MouseEvent('click')
    const emit = vi.fn()
    expect(handleToolAction('Grep', event, emit)).toBe(false)
    expect(handleToolAction('Bash', event, emit)).toBe(false)
    expect(handleToolAction('Agent', event, emit)).toBe(false)
    expect(handleToolAction('Skill', event, emit)).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('returns false for unknown tools', () => {
    const event = new MouseEvent('click')
    const emit = vi.fn()
    expect(handleToolAction('UnknownTool', event, emit)).toBe(false)
  })
})
