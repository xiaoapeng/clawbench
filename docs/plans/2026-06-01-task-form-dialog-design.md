# 定时任务手动创建面板设计

## 概述

为定时任务系统增加手动创建 UI，提供每日/每周/每月等快捷频率设置，自动生成 cron 表达式。同时移除 assistant agent 不能执行定时任务的限制，通过在定时任务执行时剥离 schedule-proposal 指令来防止递归创建。

## 1. 新建任务入口

在 `TaskDrawer.vue` 列表顶部添加"+"按钮，点击打开 `TaskFormDialog`。

`TaskFormDialog` 统一处理新建和编辑：
- 新建模式：POST `/api/tasks`，标题为"新建定时任务"
- 编辑模式：PUT `/api/tasks/{id}`，标题为"编辑定时任务"，表单预填现有值
- 替代现有 `TaskDetailDialog`（其编辑功能合并进来）

## 2. 表单布局

```
┌─────────────────────────────┐
│  新建定时任务 / 编辑定时任务   │
├─────────────────────────────┤
│  任务名称  [______________]  │
│                             │
│  执行频率                    │
│  ┌──────┬──────┬──────┬───┐ │
│  │每小时 │ 每天  │ 每周  │每月│ │
│  └──────┴──────┴──────┴───┘ │
│  ┌────────────────────────┐ │
│  │ 自定义                  │ │
│  └────────────────────────┘ │
│                             │
│  ┌─ 根据预设动态显示 ──────┐ │
│  │ 每小时: 分钟 [▼30]     │ │
│  │ 每天:   [▼09] : [▼00]  │ │
│  │ 每周:   星期 ○一…○日    │ │
│  │         [▼09] : [▼00]  │ │
│  │ 每月:   日期 [▼1]      │ │
│  │         [▼09] : [▼00]  │ │
│  └────────────────────────┘ │
│                             │
│  生成表达式: 0 9 * * *      │
│                             │
│  执行 Agent  [▼ 选择Agent ]  │
│  执行模式    ○单次 ○N次 ○不限 │
│  最大次数    [3] (N次时显示)  │
│  提示词     [____________]  │
│  描述       [____________]  │
│                             │
│         [取消]  [创建/保存]  │
└─────────────────────────────┘
```

## 3. 频率预设与 Cron 映射

| 预设 | 用户选择 | 生成 cron 示例 |
|------|---------|---------------|
| 每小时 | 分钟 (0-59) | `30 * * * *` |
| 每天 | 时 (0-23) + 分 (0-59, 步长5) | `0 9 * * *` |
| 每周 | 星期几 (单选按钮) + 时 + 分 | `0 9 * * 1` |
| 每月 | 日期 (1-31, 下拉) + 时 + 分 | `0 9 1 * *` |
| 自定义 | 直接输入 5 字段 cron | 用户手动填写 |

### 时间选择细节

- 小时：下拉 0-23
- 分钟：下拉 0-55，步长 5
- 星期：7 个圆形单选按钮 `一 二 三 四 五 六 日`
- 日期：下拉 1-31
- 默认值：切换预设时，时间默认为当前时刻的整点小时 + 0分

### 29-31号特殊处理

选择 29、30、31 号时，字段下方灰色提示："该月无此日期时将跳过本次执行"

### 表达式展示

- 快捷模式：表达式只读展示，不可编辑
- 自定义模式：表达式变为可编辑输入框
- 切换到自定义时，如果之前快捷模式已生成表达式，自动填入作为初始值

## 4. 表单校验

### 实时校验（输入时反馈）

| 字段 | 规则 |
|------|------|
| 任务名称 | 必填 |
| Agent | 必填 |
| 提示词 | 必填 |
| Cron 表达式（自定义模式） | 5 字段格式校验 |

### 提交时校验

- 自定义 cron 表达式交后端 `robfig/cron` 解析，失败返回 400，前端展示后端错误信息
- 快捷模式生成的 cron 不做前端校验（自动生成，必定合法）

### 错误展示

- 字段下方红色文字提示
- 提交失败时 toast 提示

## 5. 移除 Assistant Agent 限制

### 问题

当前 assistant agent 被禁止执行定时任务，原因是递归风险：
assistant 执行定时任务 → prompt 包含 schedule-proposal 指令 → 输出 `<schedule-proposal>` → 后端自动创建新任务 → 循环

### 解决方案：定时任务执行时剥离 schedule-proposal 指令

在 `executeTask()` 中，构建 `chatReq.SystemPrompt` 时，移除 system prompt 中的 schedule-proposal 相关段落。这样 assistant 执行定时任务时不会输出 `<schedule-proposal>` 标签，从根本上阻断递归。

### 需要改动的位置

1. **`internal/service/scheduler.go` — `executeTask()`**
   - 在 `chatReq.SystemPrompt = systemPrompt` 之后，添加清理逻辑
   - 用正则匹配并移除 schedule-proposal 指令段落（从"禁止行为/定时任务"标记到 `</schedule-proposal>` 格式说明结束）
   - 清理后的 prompt 赋值给 `chatReq.SystemPrompt`

2. **`internal/handler/scheduler.go` — `ServeTasks()` POST**
   - 删除 `req.AgentID == "assistant"` 的校验（第 48-51 行）

3. **`internal/handler/chat.go` — `detectAndCreateScheduleProposal()`**
   - 删除 `effectiveAgentID == "assistant"` 的校验（第 737-742 行）

4. **Agent YAML 文件** — 移除 agent_id 限制指令
   - `agents/assistant.yaml`：删除"禁止使用 assistant"行
   - `agents/codebuddy2.yaml`：删除"禁止使用 codebuddy2"行
   - `agents/designer.yaml`：删除 forbidden list 中的 agent 限制
   - `agents/gemini.yaml`：删除"禁止使用 gemini"行
   - `agents/gpt54.yaml`：删除 forbidden list 中的 agent 限制

## 6. 组件重构

### 新组件：`TaskFormDialog.vue`

- 路径：`web/src/components/task/TaskFormDialog.vue`
- 基于 `ModalDialog`，复用现有样式
- Props：
  - `mode: 'create' | 'edit'`
  - `task?: ScheduledTask`（编辑模式传入现有任务）
- Emits：
  - `@saved(task)` — 创建/更新成功后触发
  - `@cancel` — 取消

### 修改组件

- **`TaskDrawer.vue`**：添加"+"按钮，引入 `TaskFormDialog`，处理新建流程
- **`TaskDetailDialog.vue`**：删除此组件，功能合并到 `TaskFormDialog`
- 更新所有引用 `TaskDetailDialog` 的地方改为 `TaskFormDialog`

### 频率选择器实现

`TaskFormDialog` 内部实现频率逻辑，无需独立组件：

```typescript
type FrequencyPreset = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

const preset = ref<FrequencyPreset>('daily')
const minute = ref(0)
const hour = ref(9)
const weekday = ref(1)    // 0=日, 1=一, ..., 6=六
const monthDay = ref(1)
const customCron = ref('')

// 计算属性：根据预设生成 cron
const generatedCron = computed(() => {
  switch (preset.value) {
    case 'hourly':  return `${minute.value} * * * *`
    case 'daily':   return `${minute.value} ${hour.value} * * *`
    case 'weekly':  return `${minute.value} ${hour.value} * * ${weekday.value}`
    case 'monthly': return `${minute.value} ${hour.value} ${monthDay.value} * *`
    case 'custom':  return customCron.value
  }
})
```

## 7. 数据流

### 新建流程

1. 用户点击 TaskDrawer 顶部"+"按钮
2. 打开 TaskFormDialog (mode='create')
3. 用户填写表单，选择频率预设，设置时间
4. 点击"创建" → POST `/api/tasks` with `{name, cron_expr, agent_id, prompt, repeat_mode, max_runs}`
5. 成功 → emit `saved` → TaskDrawer 刷新列表 → 关闭对话框
6. 失败 → 显示错误提示

### 编辑流程

1. 用户点击任务列表中某条任务
2. 打开 TaskFormDialog (mode='edit', task=现有任务)
3. 表单预填：从 `task.cronExpr` 反推预设类型（匹配 hourly/daily/weekly/monthly 模式，不匹配则 custom）
4. 用户修改后点击"保存" → PUT `/api/tasks/{id}`
5. 成功/失败处理同上

### Cron 反推逻辑（编辑时从 cron 表达式回填预设）

```typescript
function detectPreset(cron: string): { preset: FrequencyPreset, minute: number, hour: number, weekday: number, monthDay: number } {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { preset: 'custom', ... }

  const [m, h, dom, mon, dow] = parts

  if (dom === '*' && mon === '*' && dow === '*' && h === '*') {
    // 每小时: M * * * *
    return { preset: 'hourly', minute: +m, hour: 0, weekday: 1, monthDay: 1 }
  }
  if (dom === '*' && mon === '*' && dow === '*') {
    // 每天: M H * * *
    return { preset: 'daily', minute: +m, hour: +h, weekday: 1, monthDay: 1 }
  }
  if (dom === '*' && mon === '*' && h !== '*' && m !== '*') {
    // 每周: M H * * DOW
    return { preset: 'weekly', minute: +m, hour: +h, weekday: +dow, monthDay: 1 }
  }
  if (mon === '*' && dow === '*' && h !== '*' && m !== '*') {
    // 每月: M H DOM * *
    return { preset: 'monthly', minute: +m, hour: +h, weekday: 1, monthDay: +dom }
  }

  return { preset: 'custom', minute: 0, hour: 9, weekday: 1, monthDay: 1 }
}
```
