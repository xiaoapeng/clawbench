import { describe, expect, it } from 'vitest'
import { parseHunkHeader, parseDiffLines, detectLang, highlightLine, renderDiff } from '@/utils/diff.ts'

// ────────────────────────────────────────────────────────────
// parseHunkHeader — imported from source, no copy-paste
// ────────────────────────────────────────────────────────────

describe('parseHunkHeader', () => {
  it('parses basic hunk header', () => {
    const result = parseHunkHeader('@@ -1,3 +1,4 @@')
    expect(result).toEqual({
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4,
      text: '',
    })
  })

  it('parses hunk header with context text', () => {
    const result = parseHunkHeader('@@ -10,5 +10,7 @@ function hello()')
    expect(result).not.toBeNull()
    expect(result!.oldStart).toBe(10)
    expect(result!.newStart).toBe(10)
    expect(result!.text).toBe('function hello()')
  })

  it('defaults count to 1 when omitted', () => {
    const result = parseHunkHeader('@@ -5 +5 @@')
    expect(result).not.toBeNull()
    expect(result!.oldCount).toBe(1)
    expect(result!.newCount).toBe(1)
  })

  it('returns null for non-hunk line', () => {
    expect(parseHunkHeader('not a hunk')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseHunkHeader('')).toBeNull()
  })

  it('parses hunk header with zero count', () => {
    const result = parseHunkHeader('@@ -0,0 +1,5 @@')
    expect(result).not.toBeNull()
    expect(result!.oldStart).toBe(0)
    expect(result!.oldCount).toBe(0)
    expect(result!.newStart).toBe(1)
    expect(result!.newCount).toBe(5)
  })

  it('parses hunk header starting at line 0', () => {
    const result = parseHunkHeader('@@ -0,0 +0,0 @@')
    expect(result!.oldStart).toBe(0)
    expect(result!.newStart).toBe(0)
  })

  it('parses hunk header with trailing whitespace in text', () => {
    const result = parseHunkHeader('@@ -1,1 +1,1 @@  ')
    expect(result).not.toBeNull()
    expect(result!.text).toBe('') // trimmed
  })
})

// ────────────────────────────────────────────────────────────
// parseDiffLines — imported from source, no copy-paste
// ────────────────────────────────────────────────────────────

describe('parseDiffLines', () => {
  it('parses context lines', () => {
    const diff = '@@ -1,3 +1,3 @@\n line1\n line2\n line3'
    const lines = parseDiffLines(diff)
    expect(lines).toHaveLength(3)
    expect(lines.every(l => l.type === 'ctx')).toBe(true)
  })

  it('parses added lines', () => {
    const diff = '@@ -1,1 +1,2 @@\n existing\n+added line'
    const lines = parseDiffLines(diff)
    expect(lines).toHaveLength(2)
    expect(lines[1].type).toBe('add')
    expect(lines[1].content).toBe('added line')
    expect(lines[1].newLine).toBe(2)
    expect(lines[1].oldLine).toBeNull()
  })

  it('parses deleted lines', () => {
    const diff = '@@ -1,2 +1,1 @@\n kept\n-removed'
    const lines = parseDiffLines(diff)
    expect(lines).toHaveLength(2)
    expect(lines[1].type).toBe('del')
    expect(lines[1].content).toBe('removed')
    expect(lines[1].oldLine).toBe(2)
    expect(lines[1].newLine).toBeNull()
  })

  it('ignores meta lines (+++, ---)', () => {
    const diff = '--- a/file.go\n+++ b/file.go\n@@ -1,1 +1,1 @@\n old\n+new'
    const lines = parseDiffLines(diff)
    expect(lines).toHaveLength(2)
  })

  it('handles empty diff', () => {
    expect(parseDiffLines('')).toEqual([])
  })

  it('handles diff with no hunks', () => {
    const diff = 'some text\nno hunk headers'
    expect(parseDiffLines(diff)).toEqual([])
  })

  it('tracks line numbers correctly', () => {
    const diff = '@@ -1,3 +1,4 @@\n ctx1\n-del\n+add1\n+add2\n ctx2'
    const lines = parseDiffLines(diff)
    expect(lines).toHaveLength(5)
    // ctx1: old=1, new=1
    expect(lines[0].oldLine).toBe(1)
    expect(lines[0].newLine).toBe(1)
    // del: old=2
    expect(lines[1].oldLine).toBe(2)
    // add1: new=2
    expect(lines[2].newLine).toBe(2)
    // add2: new=3
    expect(lines[3].newLine).toBe(3)
    // ctx2: old=3, new=4
    expect(lines[4].oldLine).toBe(3)
    expect(lines[4].newLine).toBe(4)
  })

  it('handles multiple hunks', () => {
    const diff = '@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -10,2 +10,2 @@\n x\n-y\n+z'
    const lines = parseDiffLines(diff)
    expect(lines).toHaveLength(6)
    // Second hunk starts at line 10
    expect(lines[3].oldLine).toBe(10)
    expect(lines[3].newLine).toBe(10)
  })
})

// ────────────────────────────────────────────────────────────
// detectLang
// ────────────────────────────────────────────────────────────

describe('detectLang', () => {
  it('returns plaintext for empty string', () => {
    expect(detectLang('')).toBe('plaintext')
  })

  it('detects go from .go extension', () => {
    expect(detectLang('main.go')).toBe('go')
  })

  it('detects typescript from .ts extension', () => {
    expect(detectLang('app.ts')).toBe('typescript')
  })

  it('detects markdown from .md extension', () => {
    expect(detectLang('README.md')).toBe('markdown')
  })

  it('returns plaintext for unknown extensions', () => {
    expect(detectLang('data.xyz')).toBe('plaintext')
  })

  it('handles files with multiple dots', () => {
    expect(detectLang('test.spec.ts')).toBe('typescript')
  })

  it('is case-insensitive for extension', () => {
    expect(detectLang('main.GO')).toBe('go')
  })
})

// ────────────────────────────────────────────────────────────
// highlightLine — needs hljs (browser env)
// ────────────────────────────────────────────────────────────

describe('highlightLine', () => {
  it('returns empty string for empty input', () => {
    expect(highlightLine('', 'go')).toBe('')
  })

  it('returns highlighted HTML for valid input', () => {
    const result = highlightLine('func main()', 'go')
    // hljs wraps keywords in <span> tags
    expect(result).toContain('func')
    expect(result).toContain('main')
  })

  it('falls back to escaped HTML on invalid language', () => {
    const result = highlightLine('hello <world>', 'nonexistent_lang_xyz')
    // Should still return something (either highlighted or escaped)
    expect(result).toContain('hello')
  })
})

// ────────────────────────────────────────────────────────────
// renderDiff
// ────────────────────────────────────────────────────────────

describe('renderDiff', () => {
  it('returns empty string for empty input', () => {
    expect(renderDiff('', 'test.go')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(renderDiff('   \n  ', 'test.go')).toBe('')
  })

  it('renders a simple diff with one hunk', () => {
    const raw = '@@ -1,1 +1,1 @@\n-old\n+new'
    const html = renderDiff(raw, 'test.go')
    expect(html).toContain('diff-view')
    expect(html).toContain('diff-hunk')
    expect(html).toContain('diff-line-del')
    expect(html).toContain('diff-line-add')
  })

  it('renders raw view for diff without hunks', () => {
    const raw = 'some text\nmore text'
    const html = renderDiff(raw, 'test.go')
    expect(html).toContain('diff-raw')
  })

  it('renders hunk header when present', () => {
    const raw = '@@ -1,3 +1,4 @@ function hello()\n context\n-old\n+new1\n+new2\n context'
    const html = renderDiff(raw, 'test.go')
    expect(html).toContain('diff-hunk-header')
    expect(html).toContain('function hello()')
  })
})
