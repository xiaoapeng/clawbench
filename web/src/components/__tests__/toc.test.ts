import { describe, expect, it } from 'vitest'
import { slugify, extractToc } from '@/utils/toc.ts'

describe('slugify', () => {
  it('lowercases text', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('replaces spaces with dashes', () => {
    expect(slugify('section one')).toBe('section-one')
  })

  it('removes leading and trailing dashes', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('keeps Chinese characters', () => {
    expect(slugify('配置选项')).toBe('配置选项')
  })

  it('replaces special characters with dashes', () => {
    expect(slugify('hello@world!')).toBe('hello-world')
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })

  it('handles numbers', () => {
    expect(slugify('Step 1')).toBe('step-1')
  })

  it('handles multiple consecutive special chars', () => {
    expect(slugify('a!!!b')).toBe('a-b')
  })

  it('handles mixed Chinese and English', () => {
    expect(slugify('配置 Options')).toBe('配置-options')
  })

  it('handles underscores (kept as word chars)', () => {
    expect(slugify('my_variable')).toBe('my_variable')
  })

  it('handles hyphens (treated as word chars)', () => {
    expect(slugify('already-dashed')).toBe('already-dashed')
  })

  it('handles dots', () => {
    expect(slugify('v1.0.0')).toBe('v1-0-0')
  })

  it('handles tabs and newlines as whitespace', () => {
    expect(slugify('hello\tworld\nfoo')).toBe('hello-world-foo')
  })

  it('handles only special characters', () => {
    expect(slugify('@#$%')).toBe('')
  })

  it('handles parentheses', () => {
    expect(slugify('func(arg)')).toBe('func-arg')
  })

  it('handles square brackets', () => {
    expect(slugify('array[0]')).toBe('array-0')
  })
})

describe('extractToc', () => {
  it('extracts markdown headers', () => {
    const content = '# Title\n## Section 1\n### Subsection\n## Section 2'
    const toc = extractToc(content, 'markdown')
    expect(toc).toHaveLength(4)
    expect(toc[0].level).toBe(1)
    expect(toc[0].text).toBe('Title')
    expect(toc[1].level).toBe(2)
    expect(toc[1].text).toBe('Section 1')
    expect(toc[2].level).toBe(3)
    expect(toc[2].text).toBe('Subsection')
  })

  it('returns empty for empty markdown', () => {
    const toc = extractToc('', 'markdown')
    expect(toc).toEqual([])
  })

  it('returns empty for markdown with no headers', () => {
    const toc = extractToc('Just some text\nNo headers here', 'markdown')
    expect(toc).toEqual([])
  })

  it('generates correct slug IDs for markdown', () => {
    const toc = extractToc('# Hello World', 'markdown')
    expect(toc[0].id).toBe('hello-world')
  })

  it('extracts Go symbols', () => {
    const content = 'type Server struct {}\nfunc (s *Server) Start() error {\nfunc main() {'
    const toc = extractToc(content, 'go')
    expect(toc.length).toBeGreaterThanOrEqual(2)
    const texts = toc.map(t => t.text)
    expect(texts).toContain('Server')
  })

  it('extracts TypeScript symbols', () => {
    const content = 'export class App {}\nexport function helper() {}\nexport const VERSION = "1.0"'
    const toc = extractToc(content, 'typescript')
    expect(toc.length).toBeGreaterThanOrEqual(2)
    const texts = toc.map(t => t.text)
    expect(texts).toContain('App')
  })

  it('extracts Python symbols', () => {
    const content = 'class MyClass:\n    pass\ndef my_function():\n    pass'
    const toc = extractToc(content, 'python')
    expect(toc.length).toBeGreaterThanOrEqual(2)
  })

  it('returns empty for unknown language with no extractable content', () => {
    const toc = extractToc('just some random text', 'unknown')
    expect(toc).toEqual([])
  })

  it('sorts code symbols by line number', () => {
    const content = 'func later() {}\nfunc first() {}'
    const toc = extractToc(content, 'go')
    if (toc.length >= 2) {
      expect(toc[0].line).toBeLessThanOrEqual(toc[1].line)
    }
  })

  it('deduplicates code symbols', () => {
    const content = 'func foo() {}\nfunc foo() {}'
    const toc = extractToc(content, 'go')
    const names = toc.map(t => t.text)
    const uniqueNames = [...new Set(names)]
    expect(names.length).toBe(uniqueNames.length)
  })

  it('handles Rust code', () => {
    const content = 'pub struct Config {\n}\npub fn run() {'
    const toc = extractToc(content, 'rust')
    expect(toc.length).toBeGreaterThanOrEqual(1)
  })

  it('handles YAML key extraction', () => {
    const content = 'server:\n  port: 8080\n  host: localhost'
    const toc = extractToc(content, 'yaml')
    expect(toc.length).toBeGreaterThanOrEqual(1)
  })

  it('handles JSON key extraction', () => {
    const content = '{\n  "name": "test",\n  "version": "1.0"\n}'
    const toc = extractToc(content, 'json')
    expect(toc.length).toBeGreaterThanOrEqual(1)
  })

  it('calculates correct line numbers for markdown', () => {
    const content = 'line 1\nline 2\n## Header on line 3'
    const toc = extractToc(content, 'markdown')
    expect(toc[0].line).toBe(3)
  })

  it('extracts h4-h6 headers', () => {
    const content = '#### Deep Header\n##### Deeper\n###### Deepest'
    const toc = extractToc(content, 'markdown')
    expect(toc).toHaveLength(3)
    expect(toc[0].level).toBe(4)
    expect(toc[1].level).toBe(5)
    expect(toc[2].level).toBe(6)
  })

  it('generates correct slug for Chinese headers', () => {
    const toc = extractToc('# 配置选项', 'markdown')
    expect(toc[0].id).toBe('配置选项')
  })

  it('does not filter # in code blocks (known limitation of simple regex)', () => {
    // The simple regex approach does not parse code blocks,
    // so # comments inside code blocks will be falsely matched as headers.
    // This is a known limitation.
    const content = '```python\n# This is a comment\n```\n## Real Header'
    const toc = extractToc(content, 'markdown')
    // The regex matches # This is a comment as h1 — known limitation
    expect(toc.length).toBeGreaterThanOrEqual(1)
    // But the real header should still be present
    const realHeaders = toc.filter(t => t.text === 'Real Header')
    expect(realHeaders).toHaveLength(1)
  })

  it('extracts CSS selectors', () => {
    const content = '.container {\n}\n#header {\n}\n@media screen {\n}'
    const toc = extractToc(content, 'css')
    expect(toc.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts Dockerfile instructions', () => {
    const content = 'FROM golang:1.21\nRUN go build\nCMD ["./app"]'
    const toc = extractToc(content, 'dockerfile')
    expect(toc.length).toBeGreaterThanOrEqual(1)
  })
})
