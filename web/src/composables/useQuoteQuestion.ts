import { ref, onMounted, onUnmounted, inject, type Ref } from 'vue'

export interface QuoteData {
  text: string           // selected text
  filePath: string       // file path
  language: string       // language identifier (empty for markdown preview)
  startLine: number      // start line number (1-based, 0 if unknown)
  endLine: number        // end line number (1-based, 0 if unknown)
}

// Module-level singleton: selection state shared across all consumers
const quoteData = ref<QuoteData | null>(null)
const barVisible = ref(false)
const sheetOpen = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Get line numbers from a selection range inside a code preview.
 * Walks up from anchor/focus nodes to find .code-line[data-line] elements.
 */
function getLineInfo(selection: Selection): { startLine: number; endLine: number } {
  const anchor = (selection.anchorNode as HTMLElement)?.closest?.('.code-line')
  const focus = (selection.focusNode as HTMLElement)?.closest?.('.code-line')
  if (!anchor || !focus) return { startLine: 0, endLine: 0 }

  const anchorLine = parseInt(anchor.getAttribute('data-line') || '0')
  const focusLine = parseInt(focus.getAttribute('data-line') || '0')
  return {
    startLine: Math.min(anchorLine, focusLine),
    endLine: Math.max(anchorLine, focusLine),
  }
}

/**
 * Get the file path and language from the container element.
 */
function getFileInfo(container: HTMLElement): { filePath: string; language: string } {
  const codePreview = container.closest('.raw-content-pre')
  if (codePreview) {
    const filePath = codePreview.getAttribute('data-file-path') || ''
    const language = codePreview.getAttribute('data-language') || ''
    return { filePath, language }
  }
  const markdownBody = container.closest('.markdown-body')
  if (markdownBody) {
    const filePath = markdownBody.getAttribute('data-file-path') || ''
    return { filePath, language: '' }
  }
  return { filePath: '', language: '' }
}

function onSelectionChange() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      barVisible.value = false
      quoteData.value = null
      return
    }

    // Check if selection is within a code or markdown preview area
    const anchorNode = sel.anchorNode as HTMLElement
    const container = anchorNode?.closest?.('.raw-content-pre, .markdown-body')
    if (!container) {
      barVisible.value = false
      return
    }

    const text = sel.toString().trim()
    if (!text) {
      barVisible.value = false
      return
    }

    const { filePath, language } = getFileInfo(container)
    const { startLine, endLine } = getLineInfo(sel)

    quoteData.value = { text, filePath, language, startLine, endLine }
    barVisible.value = true
  }, 150)
}

// Global listener management
let listenerCount = 0

export function useQuoteQuestion() {
  const sendQuoteMessage = inject<(message: string, sessionId?: string) => Promise<void>>('sendQuoteMessage', null)
  const toast = inject<any>('toast', null)

  onMounted(() => {
    listenerCount++
    if (listenerCount === 1) {
      document.addEventListener('selectionchange', onSelectionChange)
    }
  })

  onUnmounted(() => {
    listenerCount--
    if (listenerCount === 0) {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  })

  function openSheet() {
    sheetOpen.value = true
  }

  function closeSheet() {
    sheetOpen.value = false
    // Clear selection when closing
    const sel = window.getSelection()
    if (sel) sel.removeAllRanges()
    barVisible.value = false
    quoteData.value = null
  }

  async function sendMessage(userMessage: string, sessionId?: string) {
    if (!quoteData.value || !userMessage.trim()) return

    const q = quoteData.value
    let langPrefix = q.language ? `${q.language}:` : ':'
    let lineSuffix = ''
    if (q.startLine && q.endLine && q.startLine !== q.endLine) {
      lineSuffix = `:${q.startLine}-${q.endLine}`
    } else if (q.startLine) {
      lineSuffix = `:${q.startLine}`
    }

    const message = `\`\`\`${langPrefix}${q.filePath}${lineSuffix}\n${q.text}\n\`\`\`\n\n${userMessage.trim()}`

    if (sendQuoteMessage) {
      await sendQuoteMessage(message, sessionId)
    } else {
      // Fallback: direct API call
      try {
        const url = sessionId
          ? `/api/ai/chat?session_id=${encodeURIComponent(sessionId)}`
          : '/api/ai/chat'
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
        if (!resp.ok) throw new Error('发送失败')
        if (toast) toast.show('已发送到会话', { icon: '✅', type: 'success', duration: 2000 })
      } catch (err) {
        if (toast) toast.show('发送失败', { icon: '⚠️', type: 'error' })
      }
    }

    closeSheet()
  }

  return {
    visible: barVisible,
    quoteData,
    sheetOpen,
    openSheet,
    closeSheet,
    sendMessage,
  }
}
