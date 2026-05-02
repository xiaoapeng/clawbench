<template>
  <div class="content-blocks">
    <template v-for="(block, bi) in blocks" :key="bi">
      <!-- Thinking block -->
      <div v-if="block.type === 'thinking'" class="chat-thinking" :class="{ expanded: thinkingExpanded[key(bi)] }" @click.stop="toggleThinking(key(bi))">
        <div class="thinking-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          </svg>
          <span class="thinking-label">Thinking</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" class="thinking-chevron">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <pre v-if="thinkingExpanded[key(bi)]" class="thinking-text">{{ block.text }}</pre>
      </div>
      <!-- Tool use block -->
      <template v-else-if="block.type === 'tool_use'">
        <div class="chat-tool-call" :class="{ done: block.done, incomplete: block.done && !hasToolResult(block) }" :data-category="getToolDisplay(block).category" @click.stop="$emit('toggle-tool', key(bi))">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" class="tool-icon">
            <path :d="getToolDisplay(block).icon"/>
          </svg>
          <span class="tool-name">{{ block.name }}</span>
          <span v-if="toolCallSummary(block)" class="tool-summary">{{ toolCallSummary(block) }}</span>
          <!-- Loading: spinner -->
          <span v-if="!block.done" class="tool-spinner"></span>
          <!-- Done with result: green check -->
          <svg v-else-if="hasToolResult(block)" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" width="14" height="14" class="tool-check">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="8 12 11 15 16 9"/>
          </svg>
          <!-- Done without result: yellow warning -->
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" width="14" height="14" class="tool-warn">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div v-if="expandedTools[key(bi)] || shouldAutoExpand(block)" class="tool-detail" :data-tool-name="block.name" @click="handleToolDetailClick" v-html="formatToolInput(block.input, block.name)"></div>
      </template>
      <!-- Error block -->
      <div v-else-if="block.type === 'error'" class="chat-error-card">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" class="error-icon">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span class="error-text">{{ block.text }}</span>
      </div>
      <!-- Warning block -->
      <div v-else-if="block.type === 'warning'" class="chat-warning-card">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" class="warning-icon">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span class="warning-text">{{ block.text }}</span>
      </div>
      <!-- Schedule proposal card (inline in message) — must come before generic text block -->
      <template v-else-if="block.type === 'text' && blockProposals[blockProposalsKey(bi)]">
        <!-- Surrounding text (with proposal tag stripped) -->
        <div v-if="getBlockHtml(bi, block)" v-html="getBlockHtml(bi, block)"></div>
        <div class="schedule-proposal-card">
          <div class="proposal-header">
            <span class="proposal-icon">⏰</span> 定时任务已创建
            <button v-if="blockProposals[blockProposalsKey(bi)].proposal.task_id" class="proposal-edit-btn" @click.stop="$emit('edit-task', blockProposals[blockProposalsKey(bi)].proposal.task_id)" title="查看详情">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              </svg>
            </button>
          </div>
          <div class="proposal-body">
            <div class="proposal-row"><strong>任务：</strong>{{ blockProposals[blockProposalsKey(bi)].proposal.name }}</div>
            <div class="proposal-row"><strong>频率：</strong>{{ humanizeCron(blockProposals[blockProposalsKey(bi)].proposal.cron_expr) }}</div>
            <div class="proposal-row"><strong>执行者：</strong>{{ getAgentIcon(blockProposals[blockProposalsKey(bi)].proposal.agent_id) }} {{ getAgentName(blockProposals[blockProposalsKey(bi)].proposal.agent_id) }}</div>
            <div class="proposal-row"><strong>重复：</strong>{{ repeatLabel(blockProposals[blockProposalsKey(bi)].proposal.repeat_mode, blockProposals[blockProposalsKey(bi)].proposal.max_runs) }}</div>
            <div class="proposal-row"><strong>提示词：</strong>{{ truncate(blockProposals[blockProposalsKey(bi)].proposal.prompt, 80) }}</div>
          </div>
        </div>
      </template>
      <!-- Text block: streaming uses throttled render to avoid UI freeze -->
      <div v-else-if="block.type === 'text'" v-html="getBlockHtml(bi, block)"></div>
    </template>
    <!-- Loading dots while AI is still streaming (not when cancelled) -->
    <div v-if="streaming && !cancelled" class="placeholder-dots"><span></span><span></span><span></span></div>
    <!-- Cancelled marker -->
    <div v-if="cancelled" class="chat-cancelled-mark">已中断</div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { handleToolAction, shouldAutoExpandTool } from '@/utils/renderToolDetail.ts'

// Tool display configuration: icon SVG paths + category for color
const TOOL_DISPLAY = {
  'Read':            { icon: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', category: 'file' },
  'Write':           { icon: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', category: 'file' },
  'Edit':            { icon: 'M12 3v18M3 12h18', category: 'file' },
  'Bash':            { icon: 'M4 17l6-6-6-6M12 19h8', category: 'bash' },
  'Grep':            { icon: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35', category: 'search' },
  'Glob':            { icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', category: 'search' },
  'WebSearch':       { icon: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35', category: 'search' },
  'WebFetch':        { icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z', category: 'search' },
  'Agent':           { icon: 'M12 8V4H8 M12 8V4h4 M8 4a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 4 4v2 M9 16h6 M10 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', category: 'agent' },
  'Skill':           { icon: 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z', category: 'skill' },
  'AskUserQuestion': { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8 10h.01 M12 10h.01 M16 10h.01', category: 'ask' },
  'TaskCreate':      { icon: 'M12 5v14M5 12h14', category: 'task' },
  'TaskUpdate':      { icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z', category: 'task' },
  'TaskList':        { icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', category: 'task' },
  'TaskGet':         { icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', category: 'task' },
  'TaskStop':        { icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', category: 'task' },
  'TaskOutput':      { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8', category: 'task' },
  'EnterPlanMode':   { icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z', category: 'plan' },
  'ExitPlanMode':    { icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3', category: 'plan' },
  'LS':              { icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', category: 'file' },
  'PowerShell':      { icon: 'M4 17l6-6-6-6M12 19h8', category: 'bash' },
  'SendMessage':     { icon: 'M22 2l-7 20-4-9-9-4 20-7z', category: 'agent' },
  'NotebookEdit':    { icon: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', category: 'file' },
  'TodoWrite':       { icon: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', category: 'task' },
  'LSP':             { icon: 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z', category: 'skill' },
  'ImageGen':        { icon: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', category: 'skill' },
  'EnterWorktree':   { icon: 'M6 3v18M18 3v18M3 6h18M3 18h18', category: 'plan' },
  'LeaveWorktree':   { icon: 'M6 3v18M18 3v18M3 6h18M3 18h18', category: 'plan' },
  'ComputerUse':     { icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z', category: 'agent' },
  'TeamCreate':      { icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', category: 'agent' },
  'TeamDelete':      { icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', category: 'agent' },
  'WeChatReply':     { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', category: 'agent' },
  'WeComReply':      { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', category: 'agent' },
  'save_memory':     { icon: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-5.5a2.5 2.5 0 0 0-2.5-2.5h-5a2.5 2.5 0 0 0-2.5 2.5V21', category: 'skill' },
  'StructuredOutput': { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8', category: 'file' },
  'SkillManage':     { icon: 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z', category: 'skill' },
  'Monitor':         { icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z', category: 'bash' },
}
const FALLBACK_TOOL_DISPLAY = { icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z', category: 'fallback' }

function getToolDisplay(block) {
  const name = (block.name || '').toLowerCase()
  const entry = Object.entries(TOOL_DISPLAY).find(([k]) => k.toLowerCase() === name)
  return entry ? entry[1] : FALLBACK_TOOL_DISPLAY
}

function hasToolResult(block) {
  if (!block.done) return false
  if (!block.name) return false
  if (block.input === null || block.input === undefined) return false
  return true
}

function shouldAutoExpand(block) {
  return shouldAutoExpandTool(block.name || '')
}

const props = defineProps({
  blocks: { type: Array, default: () => [] },
  msgId: { type: [String, Number], default: '' },
  msgIndex: { type: Number, default: 0 },
  expandedTools: { type: Object, default: () => ({}) },
  blockProposals: { type: Object, default: () => ({}) },
  streaming: { type: Boolean, default: false },
  cancelled: { type: Boolean, default: false },
  // Render functions
  renderTextBlock: { type: Function, required: true },
  formatToolInput: { type: Function, required: true },
  toolCallSummary: { type: Function, required: true },
  humanizeCron: { type: Function, default: () => '' },
  repeatLabel: { type: Function, default: () => '' },
  truncate: { type: Function, default: (s) => s },
  getAgentIcon: { type: Function, default: () => '' },
  getAgentName: { type: Function, default: () => '' },
})

const emit = defineEmits(['toggle-tool', 'edit-task', 'send-message'])

// Key helper: use msgId if available, otherwise msgIndex
function key(bi) {
  return props.msgId ? `db-${props.msgId}-${bi}` : `local-${props.msgIndex}-${bi}`
}

// Key for blockProposals lookup — matches the format used in useChatRender.ts
function blockProposalsKey(bi) {
  return `${props.msgId}-${bi}`
}

const thinkingExpanded = ref({})

function toggleThinking(k) {
  thinkingExpanded.value = { ...thinkingExpanded.value, [k]: !thinkingExpanded.value[k] }
}

/** Click inside expanded tool-detail: dispatch to tool action handlers first, then fall through to generic behavior. */
function handleToolDetailClick(event) {
  // Try tool-specific action handler first (via data-tool-name on the .tool-detail container)
  const toolName = event.currentTarget.dataset?.toolName
  if (toolName && handleToolAction(toolName, event, emit)) return
  // Allow file-open buttons to bubble
  if (event.target.closest('.chat-file-open-btn')) {
    return
  }
  event.stopPropagation()
}

// ── Throttled streaming render ──
const blockHtmlCache = ref({})
let _throttleTimer = null
let _throttlePending = false
const THROTTLE_MS = 300

function flushBlockHtml() {
  _throttleTimer = null
  if (!_throttlePending) return
  _throttlePending = false
  const newCache = {}
  for (let i = 0; i < (props.blocks?.length || 0); i++) {
    const block = props.blocks[i]
    if (block.type === 'text') {
      newCache[i] = props.renderTextBlock(block.text, props.msgId, i)
    }
  }
  blockHtmlCache.value = newCache
}

function getBlockHtml(bi, block) {
  if (!props.streaming) {
    return props.renderTextBlock(block.text, props.msgId, bi)
  }
  if (blockHtmlCache.value[bi] !== undefined) {
    if (!_throttleTimer) {
      const newCache = { ...blockHtmlCache.value }
      newCache[bi] = props.renderTextBlock(block.text, props.msgId, bi)
      blockHtmlCache.value = newCache
      _throttleTimer = setTimeout(flushBlockHtml, THROTTLE_MS)
    } else {
      _throttlePending = true
    }
    return blockHtmlCache.value[bi]
  }
  const html = props.renderTextBlock(block.text, props.msgId, bi)
  blockHtmlCache.value = { ...blockHtmlCache.value, [bi]: html }
  return html
}

watch(() => props.streaming, (streaming, wasStreaming) => {
  if (wasStreaming && !streaming) {
    if (_throttleTimer) { clearTimeout(_throttleTimer); _throttleTimer = null }
    _throttlePending = false
    blockHtmlCache.value = {}
  }
})

onUnmounted(() => {
  if (_throttleTimer) { clearTimeout(_throttleTimer); _throttleTimer = null }
})
</script>

<style scoped>
.placeholder-dots {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 8px 0 4px;
}
.placeholder-dots span {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--text-muted, #999);
  animation: dot-bounce 1.2s infinite ease-in-out;
}
.placeholder-dots span:nth-child(1) { animation-delay: 0s; }
.placeholder-dots span:nth-child(2) { animation-delay: 0.2s; }
.placeholder-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.chat-cancelled-mark {
  display: inline-block;
  font-size: 11px;
  color: var(--text-muted, #999);
  background: var(--bg-tertiary, #f0f0f0);
  padding: 2px 8px;
  border-radius: 4px;
  margin-top: 4px;
}

.chat-error-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin: 2px 0;
  border-left: 3px solid #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

.chat-error-card .error-icon {
  flex-shrink: 0;
  color: #ef4444;
}

.chat-error-card .error-text {
  font-size: 12px;
  font-weight: 500;
  color: #dc2626;
}

:root[data-theme="dark"] .chat-error-card {
  border-left-color: #f87171;
  background: rgba(248, 113, 113, 0.1);
}

:root[data-theme="dark"] .chat-error-card .error-icon {
  color: #f87171;
}

:root[data-theme="dark"] .chat-error-card .error-text {
  color: #fca5a5;
}

.chat-warning-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin: 2px 0;
  border-left: 3px solid #f59e0b;
  background: rgba(245, 158, 11, 0.08);
}

.chat-warning-card .warning-icon {
  flex-shrink: 0;
  color: #f59e0b;
}

.chat-warning-card .warning-text {
  font-size: 12px;
  font-weight: 500;
  color: #d97706;
  white-space: pre-wrap;
  word-break: break-word;
}

:root[data-theme="dark"] .chat-warning-card {
  border-left-color: #fbbf24;
  background: rgba(251, 191, 36, 0.1);
}

:root[data-theme="dark"] .chat-warning-card .warning-icon {
  color: #fbbf24;
}

:root[data-theme="dark"] .chat-warning-card .warning-text {
  color: #fcd34d;
}

/* Thinking block */
.chat-thinking {
  background: color-mix(in srgb, var(--accent-color, #0066cc) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-color, #0066cc) 15%, transparent);
  border-radius: 6px;
  margin: 4px 0;
  cursor: pointer;
  overflow: hidden;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.thinking-label {
  font-weight: 500;
}

.thinking-chevron {
  margin-left: auto;
  transition: transform 0.2s;
}

.chat-thinking.expanded .thinking-chevron {
  transform: rotate(180deg);
}

.chat-thinking .thinking-text {
  margin: 0;
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  border-top: 1px solid color-mix(in srgb, var(--accent-color, #0066cc) 10%, transparent);
  max-height: 200px;
  overflow-y: auto;
  font-family: inherit;
}

/* Tool calls display */
.chat-tool-call {
  --tool-accent: var(--text-muted);
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--tool-accent) 6%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--tool-accent) 15%, var(--border-color));
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  width: 100%;
  margin-top: 4px;
  overflow: hidden;
}

.chat-tool-call[data-category="file"]     { --tool-accent: var(--accent-color); }
.chat-tool-call[data-category="bash"]     { --tool-accent: #10b981; }
.chat-tool-call[data-category="search"]   { --tool-accent: #8b5cf6; }
.chat-tool-call[data-category="task"]     { --tool-accent: #f59e0b; }
.chat-tool-call[data-category="plan"]     { --tool-accent: var(--accent-color); }
.chat-tool-call[data-category="agent"]    { --tool-accent: #ec4899; }
.chat-tool-call[data-category="skill"]    { --tool-accent: #06b6d4; }
.chat-tool-call[data-category="ask"]      { --tool-accent: #f97316; }
.chat-tool-call[data-category="fallback"] { --tool-accent: var(--text-muted); }

.chat-tool-call:hover {
  background: color-mix(in srgb, var(--tool-accent) 12%, var(--bg-secondary));
}

.chat-tool-call .tool-icon {
  color: var(--tool-accent);
  opacity: 0.8;
  flex-shrink: 0;
}

.chat-tool-call .tool-name {
  font-weight: 600;
  color: var(--tool-accent);
  font-size: 11px;
}

.chat-tool-call .tool-summary {
  color: var(--text-tertiary, #888);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-tool-call .tool-check {
  flex-shrink: 0;
  margin-left: auto;
}

.chat-tool-call .tool-warn {
  flex-shrink: 0;
  margin-left: auto;
}

.chat-tool-call.incomplete {
  --tool-accent: #f59e0b;
}

.tool-detail {
  margin: 2px 0 4px 0;
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.4;
  background: var(--bg-primary);
  border-radius: 4px;
  border: 1px solid var(--border-color);
  white-space: normal;
  overflow-x: hidden;
  overflow-y: auto;
  max-height: 150px;
  cursor: default;
}

.tool-detail[data-tool-name="AskUserQuestion"] {
  max-height: 500px;
}

.tool-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--border-color);
  border-top-color: var(--tool-accent);
  border-radius: 50%;
  animation: tool-spin 0.6s linear infinite;
  flex-shrink: 0;
  margin-left: auto;
}

@keyframes tool-spin {
  to { transform: rotate(360deg); }
}

.schedule-proposal-card {
  margin: 8px 0;
  border: 1px solid color-mix(in srgb, var(--accent-color, #4a90d9) 30%, var(--border-color, #dee2e6));
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent-color, #4a90d9) 6%, var(--bg-primary, #fff));
}

.proposal-header {
  display: flex;
  align-items: center;
  background: color-mix(in srgb, var(--accent-color, #4a90d9) 12%, transparent);
  color: var(--accent-color, #4a90d9);
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid color-mix(in srgb, var(--accent-color, #4a90d9) 15%, var(--border-color, #dee2e6));
}

.proposal-icon {
  margin-right: 4px;
}

.proposal-edit-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--accent-color, #4a90d9);
  cursor: pointer;
  transition: background 0.15s;
}

.proposal-edit-btn:hover {
  background: color-mix(in srgb, var(--accent-color, #4a90d9) 20%, transparent);
}

.proposal-edit-btn svg {
  flex-shrink: 0;
  opacity: 0.8;
}

.proposal-body {
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
}

.proposal-row {
  margin-bottom: 4px;
}

.proposal-row strong {
  color: var(--text-secondary, #495057);
}
</style>

<style>
/* Non-scoped styles for v-html penetration — tool detail rendering */
:root[data-theme="dark"] .content-blocks .chat-tool-call[data-category="bash"]   { --tool-accent: #34d399; }
:root[data-theme="dark"] .content-blocks .chat-tool-call[data-category="search"] { --tool-accent: #a78bfa; }
:root[data-theme="dark"] .content-blocks .chat-tool-call[data-category="task"]   { --tool-accent: #fbbf24; }
:root[data-theme="dark"] .content-blocks .chat-tool-call[data-category="agent"]  { --tool-accent: #f472b6; }
:root[data-theme="dark"] .content-blocks .chat-tool-call[data-category="skill"]  { --tool-accent: #22d3ee; }

.content-blocks .tool-detail .tool-file-header {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
  padding-bottom: 4px;
  padding-right: 22px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.content-blocks .tool-detail .tool-file-header .chat-file-open-btn {
  position: absolute;
  top: 0;
  right: 0;
  flex-shrink: 0;
}

.content-blocks .tool-detail .tool-file-path {
  font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-color);
  word-break: break-all;
  flex: 1;
  min-width: 0;
}

.content-blocks .tool-detail .edit-diff-view {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .edit-diff-replace-all {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
  font-weight: 600;
  white-space: nowrap;
}

.content-blocks .tool-detail .edit-diff-scroll {
  overflow-x: auto;
}

.content-blocks .tool-detail .edit-diff-body {
  white-space: pre;
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  line-height: 1.5;
  min-width: max-content;
}

.content-blocks .tool-detail .edit-diff-del {
  background: rgba(239, 68, 68, 0.08);
  color: #dc2626;
  white-space: pre;
}

.content-blocks .tool-detail .edit-diff-add {
  background: rgba(34, 197, 94, 0.08);
  color: #16a34a;
  white-space: pre;
}

:root[data-theme="dark"] .content-blocks .tool-detail .edit-diff-del {
  background: rgba(248, 113, 113, 0.1);
  color: #fca5a5;
}

:root[data-theme="dark"] .content-blocks .tool-detail .edit-diff-add {
  background: rgba(74, 222, 128, 0.1);
  color: #86efac;
}

:root[data-theme="dark"] .content-blocks .tool-detail .edit-diff-replace-all {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.content-blocks .tool-detail .file-preview-view {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .file-preview-body {
  white-space: pre;
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
}

.content-blocks .tool-detail .file-preview-line {
  white-space: pre;
  color: var(--text-primary);
}

.content-blocks .tool-detail .file-preview-meta {
  white-space: normal;
  color: var(--text-muted, #999);
  font-style: italic;
  padding: 4px 0;
}

.content-blocks .tool-detail .file-write-view {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .file-write-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  font-weight: 600;
  white-space: nowrap;
}

:root[data-theme="dark"] .content-blocks .tool-detail .file-write-badge {
  background: rgba(96, 165, 250, 0.15);
  color: #93c5fd;
}

.content-blocks .tool-detail .file-write-body {
  white-space: pre;
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
}

.content-blocks .tool-detail .file-write-line {
  white-space: pre;
  color: var(--text-primary);
}

.content-blocks .tool-detail .tool-json-body {
  white-space: pre;
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
}

.content-blocks .tool-detail .tool-json-body code {
  font-family: inherit;
}

.content-blocks .tool-detail .bash-terminal-view {
  white-space: normal;
}

.content-blocks .tool-detail .bash-terminal-desc {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.content-blocks .tool-detail .bash-terminal-body {
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  line-height: 1.5;
  background: var(--bg-tertiary);
  border-radius: 4px;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-word;
}

.content-blocks .tool-detail .bash-prompt {
  color: #16a34a;
  font-weight: 700;
  margin-right: 4px;
}

:root[data-theme="dark"] .content-blocks .tool-detail .bash-prompt {
  color: #4ade80;
}

.content-blocks .tool-detail .bash-command {
  color: var(--text-primary);
}

/* ── AskUserQuestion card ── */
:root[data-theme="dark"] .content-blocks .chat-tool-call[data-category="ask"] { --tool-accent: #fb923c; }

.content-blocks .tool-detail .ask-question-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.content-blocks .tool-detail .ask-question-empty {
  color: var(--text-muted, #999);
  font-style: italic;
  font-size: 11px;
}

.content-blocks .tool-detail .ask-question-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.content-blocks .tool-detail .ask-question-header {
  font-size: 12px;
  font-weight: 600;
  color: #f97316;
}

:root[data-theme="dark"] .content-blocks .tool-detail .ask-question-header {
  color: #fb923c;
}

.content-blocks .tool-detail .ask-question-text {
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.content-blocks .tool-detail .ask-question-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.content-blocks .tool-detail .ask-question-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  user-select: none;
  -webkit-user-select: none;
}

.content-blocks .tool-detail .ask-question-option:hover {
  background: color-mix(in srgb, #f97316 6%, var(--bg-secondary));
  border-color: color-mix(in srgb, #f97316 30%, var(--border-color));
}

.content-blocks .tool-detail .ask-question-option.selected {
  background: color-mix(in srgb, #f97316 10%, var(--bg-secondary));
  border-color: #f97316;
}

:root[data-theme="dark"] .content-blocks .tool-detail .ask-question-option.selected {
  background: color-mix(in srgb, #fb923c 12%, var(--bg-secondary));
  border-color: #fb923c;
}

.content-blocks .tool-detail .ask-option-indicator {
  flex-shrink: 0;
  font-size: 14px;
  line-height: 1.3;
  color: var(--text-muted, #999);
}

.content-blocks .tool-detail .ask-question-option.selected .ask-option-indicator {
  color: #f97316;
}

:root[data-theme="dark"] .content-blocks .tool-detail .ask-question-option.selected .ask-option-indicator {
  color: #fb923c;
}

.content-blocks .tool-detail .ask-option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.content-blocks .tool-detail .ask-option-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.content-blocks .tool-detail .ask-option-desc {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.content-blocks .tool-detail .ask-question-submit {
  align-self: flex-end;
  padding: 5px 16px;
  border: none;
  border-radius: 6px;
  background: #f97316;
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}

.content-blocks .tool-detail .ask-question-submit:hover:not(:disabled) {
  background: #ea580c;
}

.content-blocks .tool-detail .ask-question-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.content-blocks .tool-detail .ask-question-view.ask-submitted .ask-question-submit {
  background: #16a34a;
  cursor: default;
  opacity: 1;
}

:root[data-theme="dark"] .content-blocks .tool-detail .ask-question-submit {
  background: #fb923c;
}

:root[data-theme="dark"] .content-blocks .tool-detail .ask-question-submit:hover:not(:disabled) {
  background: #f97316;
}

:root[data-theme="dark"] .content-blocks .tool-detail .ask-question-view.ask-submitted .ask-question-submit {
  background: #22c55e;
}

/* ── Grep search view ── */
.content-blocks .tool-detail .grep-search-view {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .grep-pattern-row,
.content-blocks .tool-detail .grep-path-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.content-blocks .tool-detail .grep-label {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.5;
}

:root[data-theme="dark"] .content-blocks .tool-detail .grep-label {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.content-blocks .tool-detail .grep-pattern-text,
.content-blocks .tool-detail .grep-path-text {
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}

.content-blocks .tool-detail .grep-mode-tag {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(139, 92, 246, 0.08);
  color: #8b5cf6;
  font-weight: 500;
  align-self: flex-start;
}

:root[data-theme="dark"] .content-blocks .tool-detail .grep-mode-tag {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
}

/* ── Glob pattern view ── */
.content-blocks .tool-detail .glob-pattern-view {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .glob-pattern-row,
.content-blocks .tool-detail .glob-path-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.content-blocks .tool-detail .glob-label {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.5;
}

:root[data-theme="dark"] .content-blocks .tool-detail .glob-label {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.content-blocks .tool-detail .glob-pattern-text,
.content-blocks .tool-detail .glob-path-text {
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}

/* ── WebSearch view ── */
.content-blocks .tool-detail .web-search-view {
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .web-search-query {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--text-primary);
}

.content-blocks .tool-detail .web-search-icon {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1.4;
}

.content-blocks .tool-detail .web-search-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── WebFetch view ── */
.content-blocks .tool-detail .web-fetch-view {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .web-fetch-url-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.content-blocks .tool-detail .web-fetch-label {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.5;
}

:root[data-theme="dark"] .content-blocks .tool-detail .web-fetch-label {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.content-blocks .tool-detail .web-fetch-link {
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  color: var(--accent-color);
  text-decoration: none;
  word-break: break-all;
}

.content-blocks .tool-detail .web-fetch-link:hover {
  text-decoration: underline;
}

.content-blocks .tool-detail .web-fetch-text {
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}

.content-blocks .tool-detail .web-fetch-prompt {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Agent call view ── */
.content-blocks .tool-detail .agent-call-view {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .agent-call-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.content-blocks .tool-detail .agent-type-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(236, 72, 153, 0.12);
  color: #db2777;
  font-weight: 600;
  white-space: nowrap;
}

:root[data-theme="dark"] .content-blocks .tool-detail .agent-type-badge {
  background: rgba(244, 114, 182, 0.15);
  color: #f472b6;
}

.content-blocks .tool-detail .agent-call-desc {
  color: var(--text-primary);
  font-weight: 500;
}

.content-blocks .tool-detail .agent-call-prompt {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  font-family: inherit;
  line-height: 1.5;
  max-height: 80px;
  overflow-y: auto;
}

/* ── Skill call view ── */
.content-blocks .tool-detail .skill-call-view {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  line-height: 1.5;
}

.content-blocks .tool-detail .skill-call-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.content-blocks .tool-detail .skill-call-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.content-blocks .tool-detail .skill-call-name {
  font-weight: 600;
  color: #0891b2;
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  font-size: 11px;
}

:root[data-theme="dark"] .content-blocks .tool-detail .skill-call-name {
  color: #22d3ee;
}

.content-blocks .tool-detail .skill-call-args {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', Menlo, Monaco, monospace;
  line-height: 1.5;
  max-height: 80px;
  overflow-y: auto;
}
</style>
