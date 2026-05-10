import { describe, expect, it } from 'vitest'
import { escapeHtml } from '@/utils/html.ts'

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b')
  })

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe("it&#039;s")
  })

  it('escapes all special characters in one string', () => {
    expect(escapeHtml('<div class="test">&\'</div>')).toBe('&lt;div class=&quot;test&quot;&gt;&amp;&#039;&lt;/div&gt;')
  })

  it('returns safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('handles numbers by converting to string', () => {
    expect(escapeHtml(String(42))).toBe('42')
  })

  it('handles multiple ampersands', () => {
    expect(escapeHtml('a & b & c')).toBe('a &amp; b &amp; c')
  })

  it('handles consecutive special characters', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;')
  })

  it('handles string with only special characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#039;')
  })

  it('handles unicode text without modification', () => {
    expect(escapeHtml('你好世界')).toBe('你好世界')
  })

  it('handles mixed unicode and special chars', () => {
    expect(escapeHtml('你好<世界>')).toBe('你好&lt;世界&gt;')
  })

  it('handles already-escaped entities (double-escapes)', () => {
    // ampersand in &amp; gets re-escaped
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})
