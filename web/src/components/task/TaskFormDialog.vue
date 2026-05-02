<template>
  <ModalDialog :open="open" :title="mode === 'create' ? '新建定时任务' : '编辑定时任务'" @close="$emit('close')">
    <template #header>
      <svg class="modal-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="modal-title">{{ mode === 'create' ? '新建定时任务' : '编辑定时任务' }}</span>
    </template>
    <!-- Tabs (edit mode only) -->
    <div v-if="mode === 'edit'" class="dialog-tabs-row">
      <div class="dialog-tabs">
        <button class="dialog-tab" :class="{ active: tab === 'details' }" @click="tab = 'details'">详情</button>
        <button class="dialog-tab" :class="{ active: tab === 'executions' }" @click="tab = 'executions'">执行记录</button>
      </div>
    </div>

    <!-- Details / Create form -->
    <div v-if="tab === 'details'" class="details-content">
      <div v-if="saving" class="saving-indicator">保存中...</div>

      <!-- Task name -->
      <div class="form-group">
        <label class="form-label">任务名称 <span class="required">*</span></label>
        <input type="text" class="form-input" v-model="form.name" placeholder="任务名称" />
        <div v-if="errors.name" class="form-error">{{ errors.name }}</div>
      </div>

      <!-- Frequency preset -->
      <div class="form-group">
        <label class="form-label">执行频率</label>
        <div class="preset-buttons">
          <button v-for="p in presets" :key="p.value" class="preset-btn" :class="{ active: preset === p.value }" @click="setPreset(p.value)">
            {{ p.label }}
          </button>
          <button class="preset-btn" :class="{ active: preset === 'custom' }" @click="setPreset('custom')">
            自定义
          </button>
        </div>
      </div>

      <!-- Time selectors based on preset -->
      <div v-if="preset !== 'custom'" class="form-group time-selectors">
        <!-- Hourly: minute only -->
        <div v-if="preset === 'hourly'" class="time-row">
          <span class="time-label">分钟</span>
          <select class="form-select time-select" v-model.number="minute">
            <option v-for="m in 60" :key="m - 1" :value="m - 1">{{ String(m - 1).padStart(2, '0') }}</option>
          </select>
        </div>

        <!-- Daily: hour + minute -->
        <div v-if="preset === 'daily'" class="time-row">
          <select class="form-select time-select" v-model.number="hour">
            <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}</option>
          </select>
          <span class="time-sep">:</span>
          <select class="form-select time-select" v-model.number="minute">
            <option v-for="m in 12" :key="(m - 1) * 5" :value="(m - 1) * 5">{{ String((m - 1) * 5).padStart(2, '0') }}</option>
          </select>
        </div>

        <!-- Weekly: weekday + hour + minute -->
        <div v-if="preset === 'weekly'" class="time-column">
          <div class="weekday-buttons">
            <button v-for="(label, idx) in weekdayLabels" :key="idx" class="weekday-btn" :class="{ active: weekday === idx }" @click="weekday = idx">
              {{ label }}
            </button>
          </div>
          <div class="time-row">
            <select class="form-select time-select" v-model.number="hour">
              <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}</option>
            </select>
            <span class="time-sep">:</span>
            <select class="form-select time-select" v-model.number="minute">
              <option v-for="m in 12" :key="(m - 1) * 5" :value="(m - 1) * 5">{{ String((m - 1) * 5).padStart(2, '0') }}</option>
            </select>
          </div>
        </div>

        <!-- Monthly: month day + hour + minute -->
        <div v-if="preset === 'monthly'" class="time-column">
          <div class="time-row">
            <span class="time-label">日期</span>
            <select class="form-select time-select" v-model.number="monthDay">
              <option v-for="d in 31" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div v-if="monthDay >= 29" class="form-hint warning">该月无此日期时将跳过本次执行</div>
          <div class="time-row">
            <select class="form-select time-select" v-model.number="hour">
              <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}</option>
            </select>
            <span class="time-sep">:</span>
            <select class="form-select time-select" v-model.number="minute">
              <option v-for="m in 12" :key="(m - 1) * 5" :value="(m - 1) * 5">{{ String((m - 1) * 5).padStart(2, '0') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Generated cron expression -->
      <div class="form-group">
        <label class="form-label">Cron 表达式</label>
        <input
          v-if="preset === 'custom'"
          type="text"
          class="form-input"
          v-model="customCron"
          placeholder="0 9 * * *"
        />
        <div v-else class="cron-display">
          <code>{{ generatedCron }}</code>
          <span class="cron-humanize">{{ humanizeCron(generatedCron) }}</span>
        </div>
        <div v-if="preset === 'custom'" class="form-hint">标准 5 字段: 分 时 日 月 周</div>
        <div v-if="errors.cronExpr" class="form-error">{{ errors.cronExpr }}</div>
      </div>

      <!-- Agent -->
      <div class="form-group">
        <label class="form-label">执行 Agent <span class="required">*</span></label>
        <select class="form-select" v-model="form.agentId">
          <option value="" disabled>选择 Agent</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">
            {{ agent.icon }} {{ agent.name }}
          </option>
        </select>
        <div v-if="errors.agentId" class="form-error">{{ errors.agentId }}</div>
      </div>

      <!-- Repeat mode -->
      <div class="form-group">
        <label class="form-label">执行模式</label>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" v-model="form.repeatMode" value="once" />
            <span>单次执行</span>
          </label>
          <label class="radio-label">
            <input type="radio" v-model="form.repeatMode" value="limited" />
            <span>限制次数</span>
          </label>
          <label class="radio-label">
            <input type="radio" v-model="form.repeatMode" value="unlimited" />
            <span>不限次数</span>
          </label>
        </div>
      </div>

      <!-- Max runs (limited mode) -->
      <div v-if="form.repeatMode === 'limited'" class="form-group">
        <label class="form-label">最大执行次数</label>
        <input type="number" class="form-input" v-model.number="form.maxRuns" min="1" />
      </div>

      <!-- Prompt -->
      <div class="form-group">
        <label class="form-label">提示词 (Prompt) <span class="required">*</span></label>
        <textarea class="form-textarea" v-model="form.prompt" rows="10" placeholder="输入要发送给AI的提示词..."></textarea>
        <div v-if="errors.prompt" class="form-error">{{ errors.prompt }}</div>
      </div>
    </div>

    <!-- Executions tab (edit mode only) -->
    <div v-if="mode === 'edit' && tab === 'executions'" class="executions-content">
      <div v-if="executionsLoading" class="dialog-loading">加载中...</div>
      <div v-else-if="executions.length === 0" class="dialog-empty">暂无执行记录</div>
      <div v-for="(exec, idx) in executions" :key="idx" class="execution-item" :class="{ expanded: execExpanded[idx] }">
        <div class="execution-header" @click="execExpanded[idx] = !execExpanded[idx]">
          <svg class="execution-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <span class="execution-time">{{ chatRender.formatMessageTime(exec.createdAt) }}</span>
          <span v-if="!execExpanded[idx]" class="execution-preview">{{ execPreview(exec) }}</span>
        </div>
        <div v-if="execExpanded[idx]" class="chat-message assistant execution-body">
          <ContentBlocks
            :blocks="exec.blocks"
            :msgId="'exec-' + idx"
            :msgIndex="idx"
            :expandedTools="execExpandedTools"
            :blockProposals="{}"
            :renderTextBlock="chatRender.renderTextBlock"
            :formatToolInput="chatRender.formatToolInput"
            :toolCallSummary="chatRender.toolCallSummary"
            @toggle-tool="toggleExecTool"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-primary" :disabled="saving" @click="submit">
        {{ mode === 'create' ? '创建' : '保存' }}
      </button>
      <button class="btn btn-secondary" @click="$emit('close')">取消</button>
    </template>
  </ModalDialog>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue'
import ModalDialog from '@/components/common/ModalDialog.vue'
import ContentBlocks from '@/components/chat/ContentBlocks.vue'
import { useAgents } from '@/composables/useAgents.ts'
import { useChatRender } from '@/composables/useChatRender.ts'
import { humanizeCron } from '@/utils/helpers.ts'

const props = defineProps({
  open: Boolean,
  mode: { type: String, default: 'create' },  // 'create' | 'edit'
  task: Object,  // required for edit mode
})

const emit = defineEmits(['close', 'saved'])

const tab = ref('details')
const saving = ref(false)
const { agents, loadAgents } = useAgents()
const executions = ref([])
const executionsLoading = ref(false)
const execExpandedTools = ref({})
const execExpanded = ref({})

// Create chatRender instance for rendering execution blocks
const renderTheme = inject('theme', ref('light'))
const chatRender = useChatRender({ messages: ref([]), theme: renderTheme, currentSessionId: ref('') })

function toggleExecTool(key) {
  execExpandedTools.value = { ...execExpandedTools.value, [key]: !execExpandedTools.value[key] }
}

function execPreview(exec) {
  const textBlock = (exec.blocks || []).find(b => b.type === 'text' && b.text?.trim())
  if (textBlock) {
    const text = textBlock.text.trim()
    return text.length > 60 ? text.slice(0, 57) + '...' : text
  }
  const toolBlock = (exec.blocks || []).find(b => b.type === 'tool_use')
  if (toolBlock) return `工具调用: ${toolBlock.name}`
  const thinkBlock = (exec.blocks || []).find(b => b.type === 'thinking')
  if (thinkBlock) return '思考中...'
  return ''
}

// Frequency preset
const presets = [
  { value: 'hourly', label: '每小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六']

const preset = ref('daily')
const minute = ref(0)
const hour = ref(9)
const weekday = ref(1)     // 0=Sun, 1=Mon, ..., 6=Sat
const monthDay = ref(1)
const customCron = ref('')

// Form data
const form = ref({
  id: '',
  name: '',
  cronExpr: '',
  agentId: '',
  prompt: '',
  repeatMode: 'unlimited',
  maxRuns: 0,
})

// Validation errors
const errors = ref({})

// Generate cron from preset
const generatedCron = computed(() => {
  const m = String(minute.value).padStart(2, '0')
  const h = String(hour.value).padStart(2, '0')
  switch (preset.value) {
    case 'hourly':  return `${m} * * * *`
    case 'daily':   return `${m} ${h} * * *`
    case 'weekly':  return `${m} ${h} * * ${weekday.value}`
    case 'monthly': return `${m} ${h} ${monthDay.value} * *`
    default:        return customCron.value
  }
})

// Effective cron expression (for submission)
const effectiveCron = computed(() => {
  return preset.value === 'custom' ? customCron.value.trim() : generatedCron.value
})

// Set preset with smart defaults
function setPreset(p) {
  if (preset.value !== 'custom' && p === 'custom') {
    // Switching to custom: pre-fill with current generated cron
    customCron.value = generatedCron.value
  }
  preset.value = p
}

// Detect preset from existing cron expression (for edit mode)
function detectPreset(cron) {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return 'custom'

  const [m, h, dom, mon, dow] = parts
  const isNumeric = (s) => /^\d+$/.test(s)

  // Hourly: M * * * * (M must be numeric, not step like */5)
  if (isNumeric(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    minute.value = parseInt(m)
    return 'hourly'
  }
  // Daily: M H * * *
  if (isNumeric(m) && isNumeric(h) && dom === '*' && mon === '*' && dow === '*') {
    minute.value = parseInt(m)
    hour.value = parseInt(h)
    return 'daily'
  }
  // Weekly: M H * * DOW
  if (isNumeric(m) && isNumeric(h) && dom === '*' && mon === '*' && isNumeric(dow)) {
    minute.value = parseInt(m)
    hour.value = parseInt(h)
    weekday.value = parseInt(dow)
    return 'weekly'
  }
  // Monthly: M H DOM * *
  if (isNumeric(m) && isNumeric(h) && isNumeric(dom) && mon === '*' && dow === '*') {
    minute.value = parseInt(m)
    hour.value = parseInt(h)
    monthDay.value = parseInt(dom)
    return 'monthly'
  }

  customCron.value = cron
  return 'custom'
}

// Validate form
function validate() {
  const e = {}
  if (!form.value.name.trim()) e.name = '请输入任务名称'
  if (!form.value.agentId) e.agentId = '请选择执行 Agent'
  if (!form.value.prompt.trim()) e.prompt = '请输入提示词'
  if (preset.value === 'custom' && !customCron.value.trim()) {
    e.cronExpr = '请输入 Cron 表达式'
  }
  errors.value = e
  return Object.keys(e).length === 0
}

// Submit
async function submit() {
  if (!validate()) return
  if (saving.value) return
  saving.value = true

  const payload = {
    name: form.value.name,
    cron_expr: effectiveCron.value,
    agent_id: form.value.agentId,
    prompt: form.value.prompt,
    repeat_mode: form.value.repeatMode,
    max_runs: form.value.maxRuns,
  }

  try {
    let resp
    if (props.mode === 'create') {
      resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      resp = await fetch(`/api/tasks/${form.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    if (!resp.ok) {
      const err = await resp.json()
      errors.value = { cronExpr: err.error || '操作失败' }
      return
    }

    emit('saved')
  } catch (err) {
    errors.value = { cronExpr: err.message || '网络错误' }
  } finally {
    saving.value = false
  }
}

// Load executions (edit mode)
async function loadExecutions() {
  if (!props.task?.id) return
  executionsLoading.value = true
  try {
    const resp = await fetch(`/api/tasks/${props.task.id}/executions`)
    const data = await resp.json()
    const rawExecutions = data.executions || []
    executions.value = rawExecutions.map(exec => {
      const { blocks } = chatRender.parseAssistantContent(exec.content)
      return { ...exec, blocks }
    })
  } catch (err) {
    console.error('Failed to load executions:', err)
  } finally {
    executionsLoading.value = false
  }
}

// Initialize form when dialog opens
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  errors.value = {}
  tab.value = 'details'

  if (props.mode === 'edit' && props.task) {
    form.value = {
      id: props.task.id,
      name: props.task.name,
      cronExpr: props.task.cronExpr,
      agentId: props.task.agentId,
      prompt: props.task.prompt,
      repeatMode: props.task.repeatMode || 'unlimited',
      maxRuns: props.task.maxRuns || 0,
    }
    preset.value = detectPreset(props.task.cronExpr)
    loadExecutions()
  } else {
    // Create mode: reset form
    form.value = {
      id: '',
      name: '',
      cronExpr: '',
      agentId: '',
      prompt: '',
      repeatMode: 'unlimited',
      maxRuns: 0,
    }
    preset.value = 'daily'
    const now = new Date()
    hour.value = now.getHours()
    minute.value = 0
    weekday.value = 1
    monthDay.value = 1
    customCron.value = ''
  }

  if (agents.value.length === 0) {
    loadAgents()
  }
})
</script>

<style scoped>
/* Tabs */
.dialog-tabs-row {
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  background: var(--bg-tertiary, #f5f5f5);
  flex-shrink: 0;
}

.dialog-tabs {
  display: flex;
  gap: 0;
}

.dialog-tab {
  padding: 5px 12px;
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text-muted, #999);
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}

.dialog-tab:hover { color: var(--text-secondary, #666); }
.dialog-tab.active { color: var(--accent-color, #0066cc); border-bottom-color: var(--accent-color, #0066cc); }

/* Details content */
.details-content {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.saving-indicator {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  text-align: center;
  margin-bottom: 8px;
}

.form-group {
  margin-bottom: 10px;
}

.form-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 3px;
}

.required {
  color: #dc3545;
}

.form-input,
.form-select,
.form-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 4px;
  font-size: 13px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1a1a1a);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  border-color: var(--accent-color, #0066cc);
}

.form-textarea {
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

.form-hint {
  font-size: 11px;
  color: var(--text-muted, #999);
  margin-top: 2px;
}

.form-hint.warning {
  color: #eab308;
}

.form-error {
  font-size: 11px;
  color: #dc3545;
  margin-top: 2px;
}

/* Preset buttons */
.preset-buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.preset-btn {
  padding: 4px 10px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 4px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1a1a1a);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.preset-btn:hover {
  border-color: var(--accent-color, #0066cc);
  color: var(--accent-color, #0066cc);
}

.preset-btn.active {
  background: var(--accent-color, #0066cc);
  color: #fff;
  border-color: var(--accent-color, #0066cc);
}

/* Time selectors */
.time-selectors {
  background: var(--bg-tertiary, #f9f9f9);
  border-radius: 6px;
  padding: 8px 10px;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.time-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.time-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
  flex-shrink: 0;
}

.time-select {
  width: auto;
  min-width: 52px;
}

.time-sep {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #666);
}

/* Weekday buttons */
.weekday-buttons {
  display: flex;
  gap: 4px;
}

.weekday-btn {
  width: 32px;
  height: 28px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 4px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1a1a1a);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.weekday-btn:hover {
  border-color: var(--accent-color, #0066cc);
  color: var(--accent-color, #0066cc);
}

.weekday-btn.active {
  background: var(--accent-color, #0066cc);
  color: #fff;
  border-color: var(--accent-color, #0066cc);
}

/* Cron display */
.cron-display {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-tertiary, #f5f5f5);
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 4px;
}

.cron-display code {
  font-size: 13px;
  color: var(--accent-color, #0066cc);
  font-family: 'SF Mono', 'Menlo', monospace;
}

.cron-humanize {
  font-size: 11px;
  color: var(--text-muted, #999);
}

/* Radio group */
.radio-group {
  display: flex;
  flex-direction: row;
  gap: 12px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--text-primary, #1a1a1a);
  cursor: pointer;
}

/* Executions content */
.executions-content {
  flex: 1;
  overflow-y: auto;
  padding: 2px 0;
}

.execution-item {
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

.execution-item:last-child {
  border-bottom: none;
}

.execution-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.execution-header:hover {
  background: var(--bg-secondary);
}

.execution-chevron {
  flex-shrink: 0;
  transition: transform 0.2s;
  color: var(--text-muted, #999);
}

.execution-item.expanded .execution-chevron {
  transform: rotate(180deg);
}

.execution-time {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

.execution-preview {
  font-size: 12px;
  color: var(--text-muted, #999);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.execution-body {
  margin: 4px 4px 8px;
}

.dialog-loading,
.dialog-empty {
  text-align: center;
  padding: 20px 12px;
  color: var(--text-muted, #999);
  font-size: 13px;
}

/* Buttons */
.btn {
  padding: 5px 14px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn-primary {
  background: var(--accent-color, #0066cc);
  color: #fff;
}

.btn-primary:hover { background: #0055aa; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-primary, #1a1a1a);
}

.btn-secondary:hover { background: #e0e0e0; }
</style>
