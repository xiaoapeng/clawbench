import { ref, reactive, nextTick, watch } from 'vue'
import { baseName } from '@/utils/path.ts'
import { marked, DOMPurify, mermaid } from '@/utils/globals.ts'
import { formatToolInput } from '@/utils/renderToolDetail.ts'
import { renderKatexInString, renderMermaidInElement } from '@/composables/useMarkdownRenderer.ts'
import { useFilePathAnnotation } from '@/composables/useFilePathAnnotation.ts'
import { gt } from '@/composables/useLocale'
import { store } from '@/stores/app.ts'
import {
  extractScheduledTaskIds,
  stripScheduledTaskTags,
  detectAskQuestion,
  taskChanged,
  StaticBlockCache,
} from '@/utils/streamPerf.ts'

export function useChatRender(options) {
  const { messages, theme, currentSessionId } = options
  const { annotateFilePaths, verifyFilePaths } = useFilePathAnnotation()

  const blockTasks = reactive({})
  const blockAskQuestions = reactive({})
  const expandedTools = ref({})
  let lastRenderedCount = 0

  // ── StaticBlockCache for non-streaming re-renders ──
  const staticBlockCache = new StaticBlockCache()

  // Re-render when theme changes — clear caches since rendering may differ
  watch(theme, () => {
    staticBlockCache.clear()
    updateRenderedContents(true)
  })

  // Clear caches when session changes
  watch(currentSessionId, () => {
    staticBlockCache.clear()
  })

  // Sync blockTasks with latest task data from store (global polling updates store.state.tasks).
  // Use a tasks Map for O(1) lookup, and taskChanged() for semantic comparison.
  watch(() => store.state.tasks, (tasks) => {
    if (!tasks || tasks.length === 0) return
    const keys = Object.keys(blockTasks)
    if (keys.length === 0) return
    const taskMap = new Map(tasks.map(t => [t.id, t]))
    for (const key of keys) {
      const entry = blockTasks[key]
      if (entry.deleted || !entry.task) continue
      const updated = taskMap.get(entry.taskId)
      if (!updated) {
        entry.deleted = true
      } else if (taskChanged(entry.task, updated)) {
        entry.task = updated
      }
    }
  })

  async function fetchTaskData(key, taskId) {
    if (blockTasks[key]?.task || blockTasks[key]?.loading) return
    blockTasks[key] = { taskId, task: null, loading: true, deleted: false }
    try {
      const resp = await fetch(`/api/tasks/${taskId}`)
      if (resp.status === 404) {
        blockTasks[key].deleted = true
        blockTasks[key].loading = false
        return
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      blockTasks[key].task = await resp.json()
    } catch {
      blockTasks[key].deleted = true
    } finally {
      blockTasks[key].loading = false
    }
  }

  async function refreshTaskData(taskId) {
    for (const key of Object.keys(blockTasks)) {
      if (blockTasks[key].taskId === taskId && !blockTasks[key].deleted) {
        try {
          const resp = await fetch(`/api/tasks/${taskId}`)
          if (resp.status === 404) {
            blockTasks[key].deleted = true
            blockTasks[key].task = null
          } else if (resp.ok) {
            blockTasks[key].task = await resp.json()
          }
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Render markdown to HTML.
   * When skipEnhancements=true (streaming mode), only marked + DOMPurify + table-wrap runs.
   * When skipEnhancements=false (post-streaming), the full pipeline runs:
   * marked → KaTeX → DOMPurify → table-wrap → img → audio → annotateFilePaths → verifyFilePaths.
   */
  function renderMarkdown(text, { skipEnhancements = false } = {}) {
    let html = marked.parse((text || '').trim())

    if (!skipEnhancements) {
      // KaTeX: deferred to post-streaming — formula may be incomplete during streaming
      html = renderKatexInString(html)
    }

    html = DOMPurify.sanitize(html, { ADD_TAGS: ['math', 'button'], ADD_ATTR: ['data-file-path', 'title'] })
    html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')

    if (!skipEnhancements) {
      // Image styling, audio links, file path annotation: deferred to post-streaming
      html = html.replace(/<img([^>]*)>/g, (match, attrs) => {
        let cleanAttrs = attrs.replace(/\s*style="[^"]*"/i, '').replace(/\s*class="[^"]*"/i, '')
        return `<img${cleanAttrs} style="max-width: 200px; max-height: 200px; object-fit: cover; border-radius: 6px; margin: 4px 0; cursor: pointer;" class="chat-img-thumbnail">`
      })
      const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma', '.opus']
      html = html.replace(/<a href="([^"]+)">([^<]*)<\/a>/g, (match, href, text) => {
        const lower = href.toLowerCase()
        if (audioExts.some(ext => lower.endsWith(ext))) {
          return `<div class="chat-audio-wrapper"><audio src="${href}" controls class="chat-audio-player"></audio></div>`
        }
        return match
      })
      const { html: annotatedHtml, detectedPaths } = annotateFilePaths(html, { projectRoot: store.state.projectRoot })
      html = annotatedHtml
      if (detectedPaths.length > 0) {
        const uniquePaths = [...new Set(detectedPaths)]
        nextTick(() => {
          const el = document.getElementById('aiChatMessages')
          if (el) verifyFilePaths(uniquePaths, el)
        })
      }
    }

    return html
  }

  /**
   * Render a text block to HTML.
   *
   * When streaming=true (during streaming):
   *   Only pure markdown rendering — no structured detection.
   *   Tags like <scheduled-task> and <ask-question> remain as visible text.
   *   No KaTeX, no file path annotation, no path verification.
   *
   * When streaming=false (post-streaming / history load):
   *   Full pipeline: scheduled-task extraction, ask-question detection,
   *   tag stripping, and enhanced markdown rendering.
   */
  function renderTextBlock(text, msgId, blockIdx, streaming = false) {
    // ── Streaming: pure markdown only ──
    if (streaming) {
      return renderMarkdown(text, { skipEnhancements: true })
    }

    // ── Post-streaming: full pipeline ──

    // Extract scheduled-task IDs and fetch their data
    const taskIds = extractScheduledTaskIds(text)
    for (let tagIdx = 0; tagIdx < taskIds.length; tagIdx++) {
      const key = `${msgId}-${blockIdx}-${tagIdx}`
      fetchTaskData(key, taskIds[tagIdx])
    }

    // Detect ask-question tags
    const askResult = detectAskQuestion(text)

    if (askResult.found) {
      const askKey = `${msgId}-${blockIdx}`
      if (!blockAskQuestions[askKey]) {
        try {
          let askContent = askResult.content.trim()
          if (askContent.startsWith('```')) {
            const nlIdx = askContent.indexOf('\n')
            if (nlIdx !== -1) askContent = askContent.slice(nlIdx + 1).trim()
            const lastFence = askContent.lastIndexOf('```')
            if (lastFence !== -1) askContent = askContent.slice(0, lastFence).trim()
          }
          const questions = JSON.parse(askContent)
          if (questions.questions && Array.isArray(questions.questions)) {
            blockAskQuestions[askKey] = questions
          }
        } catch (e) {
          console.error('Failed to parse ask-question:', e)
        }
      }
      // Remove the matched tag from the rendered text
      let cleanText
      if (askResult.endIdx !== undefined) {
        cleanText = (text.slice(0, askResult.startIdx) + text.slice(askResult.endIdx)).trim()
      } else {
        cleanText = text.slice(0, askResult.startIdx).trim()
      }
      cleanText = stripScheduledTaskTags(cleanText)
      return cleanText ? renderMarkdown(cleanText) : ''
    }

    // No ask-question: strip scheduled-task tags and render
    const cleanText = stripScheduledTaskTags(text)
    return cleanText ? renderMarkdown(cleanText) : ''
  }

  function parseAssistantContent(content) {
    if (!content) return { blocks: [], metadata: null }
    try {
      const parsed = JSON.parse(content)
      if (parsed.blocks && Array.isArray(parsed.blocks)) {
        const mapped = parsed.blocks.map(b => {
          if (b.type === 'tool_use') {
            if (b.done === undefined || b.done === false) b.done = true
            if (!b.output && b.input && b.input.output) {
              b.output = b.input.output
              delete b.input.output
            }
          }
          return b
        })
        const result = []
        const toolIndex = new Map()
        for (const b of mapped) {
          if (b.type === 'tool_use' && b.id) {
            const prevIdx = toolIndex.get(b.id)
            if (prevIdx !== undefined) {
              const prev = result[prevIdx]
              const prevEmpty = !prev.input || Object.keys(prev.input).length === 0
              const currEmpty = !b.input || Object.keys(b.input).length === 0
              if (currEmpty && !prevEmpty) continue
              if (!currEmpty && prevEmpty) {
                prev.input = b.input
                prev.done = b.done
                prev.name = b.name || prev.name
                if (b.output) prev.output = b.output
                if (b.status) prev.status = b.status
                continue
              }
              if (b.done) prev.done = true
              if (!currEmpty) prev.input = b.input
              if (b.output) prev.output = b.output
              if (b.status) prev.status = b.status
              continue
            }
            toolIndex.set(b.id, result.length)
          }
          result.push(b)
        }
        return {
          blocks: result,
          metadata: parsed.metadata || null,
          cancelled: parsed.cancelled || false
        }
      }
    } catch {}
    return { blocks: [{ type: 'text', text: content }], metadata: null }
  }

  function extractScheduledTasks(msgs) {
    for (const msg of msgs) {
      if (msg.role === 'assistant' && msg.blocks && !msg.streaming) {
        for (let bi = 0; bi < msg.blocks.length; bi++) {
          const block = msg.blocks[bi]
          if (block.type === 'text') {
            const taskIds = extractScheduledTaskIds(block.text || '')
            for (let tagIdx = 0; tagIdx < taskIds.length; tagIdx++) {
              const key = `${msg.id}-${bi}-${tagIdx}`
              fetchTaskData(key, taskIds[tagIdx])
            }
          }
        }
      }
    }
  }

  function updateRenderedContents(forceFullRender = false) {
    // Defensive: if count diverged (e.g. loadHistory replaced messages),
    // force a full rebuild.
    if (!forceFullRender && lastRenderedCount > messages.value.length) {
      forceFullRender = true
    }

    // ── Deferred rendering: only render Mermaid when not streaming ──
    // During streaming, Mermaid code blocks are incomplete — rendering them
    // would produce errors. Defer to post-streaming forceFullRender.
    if (forceFullRender) {
      lastRenderedCount = messages.value.length
      nextTick(() => {
        const el = document.getElementById('aiChatMessages')
        if (el) renderMermaidInElement(el, 'chat-mermaid')
      })
    } else {
      const startIdx = lastRenderedCount
      const newMsgCount = messages.value.length - startIdx

      if (newMsgCount <= 0) return

      lastRenderedCount = messages.value.length

      // Skip Mermaid rendering during streaming — it will be rendered
      // when forceFullRender triggers after streaming ends.
    }
  }

  function toggleToolDetail(key) {
    expandedTools.value[key] = !expandedTools.value[key]
  }

  function toolCallSummary(block) {
    if (!block.input) return ''
    const name = (block.name || '').toLowerCase()
    if (name === 'askuserquestion' && Array.isArray(block.input.questions) && block.input.questions.length > 0) {
      const q = block.input.questions[0]
      const header = q.header || ''
      const question = q.question || ''
      if (header) return header
      if (question) return question.length > 60 ? question.slice(0, 57) + '...' : question
    }
    if (block.input.description) return block.input.description
    const obj = block.input
    if (obj.file_path) return baseName(obj.file_path)
    if (obj.command) return obj.command.length > 60 ? obj.command.slice(0, 57) + '...' : obj.command
    if (obj.pattern) return obj.pattern.length > 60 ? obj.pattern.slice(0, 57) + '...' : obj.pattern
    if (obj.query) return obj.query.length > 60 ? obj.query.slice(0, 57) + '...' : obj.query
    if (obj.url) return obj.url.length > 60 ? obj.url.slice(0, 57) + '...' : obj.url
    if (obj.skill) return obj.skill
    if (obj.prompt && name === 'agent') return obj.prompt.length > 60 ? obj.prompt.slice(0, 57) + '...' : obj.prompt
    if (obj.path) return baseName(obj.path)
    if (obj.src_path && obj.dst_path) return `${baseName(obj.src_path)} → ${baseName(obj.dst_path)}`
    const firstVal = Object.values(obj)[0]
    if (typeof firstVal === 'string' && firstVal.length < 80) return firstVal
    return ''
  }

  function hasImagesInContent(content) {
    return content && content.includes('![')
  }

  function formatMessageTime(createdAt) {
    const date = new Date(createdAt)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return gt('time.justNow')
    if (diffMins < 60) return gt('time.minutesAgo', { count: diffMins })

    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return gt('time.hoursAgo', { count: diffHours })

    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return gt('time.daysAgo', { count: diffDays })

    const month = date.getMonth() + 1
    const day = date.getDate()
    const hour = date.getHours().toString().padStart(2, '0')
    const minute = date.getMinutes().toString().padStart(2, '0')
    return `${month}/${day} ${hour}:${minute}`
  }

  function formatDetailTime(createdAt) {
    const date = new Date(createdAt)
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    const hour = date.getHours().toString().padStart(2, '0')
    const minute = date.getMinutes().toString().padStart(2, '0')
    const second = date.getSeconds().toString().padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  }

  function humanizeCron(expr) {
    const parts = expr.split(' ')
    if (parts.length !== 5) return expr
    const [min, hour, day, month, weekday] = parts
    if (min.startsWith('*/') && hour === '*') return gt('cron.everyMinutes', { count: min.slice(2) })
    if (hour.startsWith('*/') && min === '0') return gt('cron.everyHours', { count: hour.slice(2) })
    if (min === '0' && !hour.includes('/') && day === '*' && month === '*' && weekday === '*') return gt('cron.daily', { time: `${hour}:00` })
    if (min === '0' && weekday === '1-5') return gt('cron.weekdays', { time: `${hour}:00` })
    return expr
  }

  function repeatLabel(mode, maxRuns) {
    if (mode === 'once') return gt('task.repeat.onceExecute')
    if (mode === 'limited') return gt('task.repeat.timesThenStop', { count: maxRuns })
    return gt('task.repeat.unlimitedTimes')
  }

  function truncate(str, len) {
    if (!str) return ''
    const runes = [...str]
    return runes.length > len ? runes.slice(0, len).join('') + '...' : str
  }

  return {
    blockTasks,
    blockAskQuestions,
    expandedTools,
    renderMarkdown,
    renderTextBlock,
    parseAssistantContent,
    extractScheduledTasks,
    refreshTaskData,
    updateRenderedContents,
    toggleToolDetail,
    formatToolInput,
    toolCallSummary,
    hasImagesInContent,
    formatMessageTime,
    formatDetailTime,
    humanizeCron,
    repeatLabel,
    truncate,
    // Expose cache for ContentBlocks.vue integration
    staticBlockCache,
  }
}
