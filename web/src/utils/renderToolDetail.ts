// Custom rendering for tool_use block details in chat messages.
// All backends normalize tool names and input field names in their parsers,
// so we can assume canonical field names here: file_path, command, old_string, etc.

import { hljs } from './globals.ts'
import { escapeHtml } from './html.ts'
import { detectLang, highlightLine } from './diff.ts'
import { resolveFilePath, fileOpenButtonHtml } from '@/composables/useFilePathAnnotation.ts'
import { store } from '@/stores/app.ts'

/**
 * Render Edit tool input as a diff view.
 * Shows old_string lines in red, new_string lines in green.
 * No line numbers, no +/- prefix — color-only distinction.
 * File path is clickable to open the file.
 */
function renderEditDiff(input: Record<string, any>): string {
  const filePath = input.file_path || ''
  const oldStr = input.old_string || ''
  const newStr = input.new_string || ''
  const replaceAll = input.replace_all

  // Resolve file path for click-to-open
  const projectRoot = store.state.projectRoot || ''
  const resolvedPath = resolveFilePath(filePath, projectRoot)
  const displayPath = resolvedPath || filePath.replace(/^\.\//, '')

  // Detect language for syntax highlighting
  const lang = detectLang(filePath)

  // Build header
  let header = '<div class="tool-file-header">'
  header += `<span class="tool-file-path">${escapeHtml(displayPath)}</span>`
  if (resolvedPath) {
    header += fileOpenButtonHtml(resolvedPath)
  }
  if (replaceAll) {
    header += '<span class="edit-diff-replace-all" title="Replace all occurrences">replaceAll</span>'
  }
  header += '</div>'

  // Build diff body (scroll wrapper + inner content)
  let body = '<div class="edit-diff-scroll"><div class="edit-diff-body">'

  // Old lines (red)
  if (oldStr) {
    const oldLines = oldStr.split('\n')
    for (const line of oldLines) {
      body += `<div class="edit-diff-del">${highlightLine(line, lang)}</div>`
    }
  }

  // New lines (green)
  if (newStr) {
    const newLines = newStr.split('\n')
    for (const line of newLines) {
      body += `<div class="edit-diff-add">${highlightLine(line, lang)}</div>`
    }
  }

  body += '</div></div>'

  return `<div class="edit-diff-view">${header}${body}</div>`
}

/**
 * Render Bash tool input as a terminal-style view.
 * Shows description (if any) and command with $ prefix.
 */
function renderBashTerminal(input: Record<string, any>): string {
  const command = input.command || ''
  const description = input.description || ''

  let html = '<div class="bash-terminal-view">'

  if (description) {
    html += `<div class="bash-terminal-desc">${escapeHtml(description)}</div>`
  }

  html += '<div class="bash-terminal-body">'
  html += '<span class="bash-prompt">$</span>'

  // Highlight command as bash
  if (command) {
    try {
      html += hljs.highlight(command, { language: 'bash', ignoreIllegals: true }).value
    } catch {
      html += escapeHtml(command)
    }
  }

  html += '</div></div>'

  return html
}

/**
 * Build a clickable file path header used by Read/Write/Edit views.
 */
function filePathHeader(input: Record<string, any>, extraBadge = ''): string {
  const filePath = input.file_path || ''
  const projectRoot = store.state.projectRoot || ''
  const resolvedPath = resolveFilePath(filePath, projectRoot)
  const displayPath = resolvedPath || filePath.replace(/^\.\//, '')

  let html = '<div class="tool-file-header">'
  html += `<span class="tool-file-path">${escapeHtml(displayPath)}</span>`
  if (resolvedPath) {
    html += fileOpenButtonHtml(resolvedPath)
  }
  if (extraBadge) html += extraBadge
  html += '</div>'
  return html
}

/**
 * Render Read tool input as a file preview view.
 * Shows clickable file path + syntax-highlighted content preview.
 */
function renderReadPreview(input: Record<string, any>): string {
  const filePath = input.file_path || ''
  const lang = detectLang(filePath)

  let html = '<div class="file-preview-view">'
  html += filePathHeader(input)

  // Content preview body
  html += '<div class="file-preview-body">'
  const content = input.content || ''
  if (content) {
    const lines = content.split('\n')
    for (const line of lines) {
      html += `<div class="file-preview-line">${highlightLine(line, lang)}</div>`
    }
  } else {
    // No content field — show offset/limit info if present
    const parts: string[] = []
    if (input.offset) parts.push(`从第 ${input.offset} 行`)
    if (input.limit) parts.push(`读取 ${input.limit} 行`)
    if (parts.length > 0) {
      html += `<div class="file-preview-meta">${parts.join('，')}</div>`
    }
  }
  html += '</div></div>'

  return html
}

/**
 * Render Write tool input as a file write view.
 * Shows clickable file path + syntax-highlighted content to write.
 */
function renderWritePreview(input: Record<string, any>): string {
  const filePath = input.file_path || ''
  const lang = detectLang(filePath)

  let html = '<div class="file-write-view">'
  html += filePathHeader(input, '<span class="file-write-badge">写入</span>')

  html += '<div class="file-write-body">'
  const content = input.content || ''
  if (content) {
    const lines = content.split('\n')
    for (const line of lines) {
      html += `<div class="file-write-line">${highlightLine(line, lang)}</div>`
    }
  }
  html += '</div></div>'

  return html
}

/**
 * Format tool_use input for display in the expanded tool detail area.
 * Dispatches to specialized renderers for Edit, Bash, Read, Write tools,
 * falls back to JSON rendering for all other tool types.
 */
export function formatToolInput(input: any, toolName?: string): string {
  if (toolName && input && typeof input === 'object') {
    const lower = toolName.toLowerCase()
    if (lower === 'edit') return renderEditDiff(input)
    if (lower === 'bash') return renderBashTerminal(input)
    if (lower === 'read') return renderReadPreview(input)
    if (lower === 'write') return renderWritePreview(input)
  }

  // Default: JSON rendering
  if (!input || (typeof input === 'object' && Object.keys(input).length === 0)) {
    try {
      const highlighted = hljs.highlight('{}', { language: 'json' }).value
      return `<div class="tool-json-body"><code>${highlighted}</code></div>`
    } catch {
      return '<div class="tool-json-body"><code>{}</code></div>'
    }
  }
  try {
    const json = JSON.stringify(input, null, 2)
    const highlighted = hljs.highlight(json, { language: 'json' }).value
    return `<div class="tool-json-body"><code>${highlighted}</code></div>`
  } catch {
    return `<div class="tool-json-body"><code>${escapeHtml(JSON.stringify(input, null, 2))}</code></div>`
  }
}
