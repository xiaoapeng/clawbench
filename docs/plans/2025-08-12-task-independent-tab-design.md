# 定时任务独立 Tab 重构设计

> 日期: 2025-08-12
> 状态: 已验证，待实施

## 背景

定时任务模块当前深度嵌入在聊天模块中：
- 入口仅通过 Chat 输入栏按钮或聊天消息中的 `<scheduled-task>` 卡片
- TaskDrawer 作为 BottomSheet 嵌套在 ChatPanel 内部
- 未读标记合并到 Chat 底部导航按钮
- 底部导航 6 个 Tab，没有独立的 Tasks Tab

重构目标：
1. **提升可发现性** — 定时任务是独立功能，不该藏在聊天里
2. **降低聊天模块复杂度** — 聊天模块承载了过多任务逻辑
3. **提升任务模块地位** — 定时任务需要和聊天同级的完整视图

## 核心决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Tab 与聊天关系 | 完全独立 + 聊天卡片跳转 | TaskDrawer 入口去掉，聊天中 `<scheduled-task>` 卡片保留但点击跳转到 Tasks Tab |
| 底部导航布局 | 7 个一行，缩小间距 | gap 从 10px → 8px，总宽 286px 适配手机 |
| Tab 页面结构 | 列表→详情导航模式 | 类似邮件 App 的列表→详情 |
| 详情视图内容 | 子Tab分栏（概览 \| 执行历史） | 清晰分区，不过度滚动 |
| 执行详情查看 | 滑入详情面板（三级导航） | 与列表→详情的导航模式一致 |
| 卡片跳转目标 | 跳转到详情概览 | 直接看到任务完整信息 |
| 未读标记 | 脉冲移到 Tasks Tab 按钮 | Chat 按钮不再显示 taskUnread |
| 创建入口 | 仅 Tasks Tab 内创建按钮 | 任务创建集中在独立 Tab |

## 整体架构

### 导航结构

```
底部导航（7个一行，gap: 8px）
├── Chat        💬
├── Files       📁
├── Viewer      📄
├── History     🔀
├── Tasks       ⏰  ← 新增独立Tab，带未读脉冲
├── PortForward 🌐  （仅App模式）
└── Terminal    ⌨️
```

### 三级导航模型

```
Tasks Tab
├── Level 1: 任务列表页 (TaskListPage)
│   ├── 顶部：创建按钮（+）
│   ├── 任务卡片列表（名称、agent、cron、状态徽章、下次运行时间、未读数）
│   └── 点击任务行 → 进入 Level 2
│
├── Level 2: 任务详情页 (TaskDetailPage，子Tab分栏)
│   ├── 「概览」Tab (TaskOverviewTab)
│   │   ├── 任务配置信息卡片（名称、cron、agent、prompt预览）
│   │   ├── 状态操作按钮（暂停/恢复/触发/删除/编辑）
│   │   └── 统计信息（运行次数等）
│   │
│   └── 「执行历史」Tab (TaskHistoryTab)
│       ├── 运行中执行（动画脉冲点、取消按钮、触发类型徽章）
│       ├── 已完成执行（时间、摘要、时长/模型/token标签、未读点）
│       └── 点击执行行 → 滑入 Level 3
│
└── Level 3: 执行详情面板 (TaskExecDetail，右侧滑入)
    ├── 返回按钮
    ├── AI输出完整渲染（复用ContentBlocks）
    ├── 元信息栏（时长、时间、模型信息按钮）
    └── ChatMetadataModal（Token用量详情）
```

### 返回导航

- Level 3 → Level 2：滑出面板 / 点击返回
- Level 2 → Level 1：顶栏返回箭头
- Level 2 内子Tab切换：概览 ↔ 执行历史

## 组件拆分

### 新增文件

| 文件 | 职责 |
|------|------|
| `web/src/composables/useTaskTab.ts` | 任务Tab状态管理（导航栈、轮询、数据加载） |
| `web/src/components/task/TaskTab.vue` | Tab主容器，管理三级导航 + TaskFormDialog |
| `web/src/components/task/TaskListPage.vue` | Level 1 任务列表页 |
| `web/src/components/task/TaskDetailPage.vue` | Level 2 任务详情页（子Tab容器） |
| `web/src/components/task/TaskOverviewTab.vue` | 概览子Tab内容 |
| `web/src/components/task/TaskHistoryTab.vue` | 执行历史子Tab内容 |
| `web/src/components/task/TaskExecDetail.vue` | Level 3 执行详情滑入面板 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `web/src/components/task/TaskDrawer.vue` | 被 TaskListPage 替代 |
| `web/src/components/task/TaskExecDialog.vue` | 逻辑迁入 TaskHistoryTab + TaskExecDetail |

### 改动文件

**App.vue：**
- 底部导航 dock 新增 Tasks 按钮（Clock 图标，排在 History 之后）
- dock-center `gap` 从 10px → 8px
- `switchTab('tasks')` 逻辑：清除 `taskUnread`
- Chat 按钮 `has-unread` 条件移除 `taskUnread`
- 新增 `activeTab === 'tasks'` 时渲染 `<TaskTab>`
- `onMounted` 调用 `startTaskPolling()`，`onUnmounted` 调用 `stopTaskPolling()`
- 聊天卡片跳转：接收事件 → `useTaskTab.navigateToTask(id)` + `switchTab('tasks')`

**stores/app.ts：**
- 保留 `taskUnread` 和 `tasks` 字段（useChatRender 仍需读取）
- 无结构性改动

**ChatPanel.vue：**
- 移除 TaskDrawer、TaskFormDialog、TaskExecDialog 的 import 和模板引用
- 移除 `taskEditOpen/taskEditData/taskHistoryOpen/taskHistoryData` 等状态
- 移除 `handleTaskAction()`、`openTaskEdit()`、`openTaskHistory()` 方法
- 新增：监听 `task-card-click` 事件，emit 给 App.vue 触发跳转

**ChatInputBar.vue：**
- 移除任务按钮（`open-session-tab: 'tasks'`）
- 移除 `taskUnread` prop 和相关高亮逻辑

**useChatSession.ts：**
- 移除 `taskDrawerOpen` ref
- 移除 `openSessionTab()` 中的 tasks 分支
- 移除全局轮询中的 `GET /api/tasks` 逻辑（只保留 sessions 轮询）

**useChatRender.ts：**
- `blockTasks` 数据获取逻辑保留不变
- `<scheduled-task>` 卡片点击行为：从当前行内操作改为 emit `task-card-click` 事件

**ContentBlocks.vue：**
- `<scheduled-task>` 卡片的按钮（暂停/恢复/触发/删除/编辑/查看历史）改为单一"查看详情"按钮
- 点击按钮 emit `task-card-click` 事件，携带 taskId
- 卡片样式可简化：不再需要操作按钮组，只显示任务名 + 状态 + "查看详情"

**useChatStream.ts：**
- `onExtractScheduledTasks` 回调保留不变

## 数据流与交互链路

### 全局轮询迁移

```
现在：
  useChatSession.startGlobalPolling()
    ├── 每2s: GET /api/sessions → 更新 store.state.sessions
    ├── 每2s: GET /api/tasks    → 更新 store.state.taskUnread + store.state.tasks
    └── 两者耦合在一起

重构后：
  useChatSession.startGlobalPolling()
    └── 每2s: GET /api/sessions → 更新 store.state.sessions

  useTaskTab.startTaskPolling()
    └── 每2s: GET /api/tasks → 更新 store.state.taskUnread + store.state.tasks
```

- `store.state.tasks` 和 `store.state.taskUnread` 保留在全局 store（因为 useChatRender 的 blockTasks 也读它）
- 轮询生命周期由 App.vue 管理：`onMounted` → `startTaskPolling()`，`onUnmounted` → `stopTaskPolling()`

### 聊天卡片跳转链路

```
用户点击 <scheduled-task> 卡片
    │
    ▼
ContentBlocks.vue 检测到卡片点击
    │
    ▼
emit('task-card-click', taskId)
    │
    ▼
ChatMessageItem → ChatMessageList → ChatPanel
    │
    ▼
ChatPanel 调用：
  1. useTaskTab.navigateToTask(taskId)  → 设置导航状态
  2. App.vue switchTab('tasks')          → 切到Tasks Tab
    │
    ▼
TaskTab 渲染 TaskDetailPage（selectedTaskId 已设好）
    │
    ▼
TaskDetailPage 加载任务详情 → 展示概览
```

### TaskFormDialog 管理权迁移

```
现在：
  ChatPanel.vue
    ├── TaskDrawer 内触发 create → TaskFormDialog(create)
    ├── 聊天卡片触发 edit-task → TaskFormDialog(edit)
    └── 保存后手动刷新各自数据

重构后：
  TaskTab.vue（唯一管理者）
    ├── TaskListPage 点击 + → emit → TaskTab 打开 TaskFormDialog(create)
    ├── TaskDetailPage 点击 ✏️ → emit → TaskTab 打开 TaskFormDialog(edit)
    └── 保存后：
        ├── create 模式 → navigateToTask(newTaskId) 自动进入详情
        └── edit 模式 → 刷新当前详情数据
```

### 未读标记流转

```
现在：
  store.state.taskUnread
    ├── → Chat 底部按钮 has-unread 脉冲
    ├── → Chat 输入栏任务按钮 has-unread 高亮
    └── → switchTab('chat') 时清除

重构后：
  store.state.taskUnread
    ├── → Tasks 底部按钮 has-unread 脉冲
    └── → switchTab('tasks') 时清除
```

### 执行详情中的文件路径点击

```
重构后（TaskExecDetail 内）：
  点击文件路径 → 关闭滑入面板 → 打开文件查看器
  （delegated click handler 模式，比现在更简单，不需要关 chat）
```

## 各组件详细设计

### TaskTab.vue — Tab 主容器

- 管理导航栈：`views: ['list', 'detail']`
- `navigateToTask(taskId)`：推入 detail，设置 selectedTaskId
- `goBack()`：弹出栈顶，回到列表
- 监听 `props.active`：Tab 切走时保留状态（不重置），下次切回还在原位
- 保留 TaskFormDialog 的挂载（创建/编辑弹窗由 TaskTab 统一管理）

### TaskListPage.vue — Level 1 任务列表

- 全屏列表（不再用 BottomSheet）
- 每个任务卡片包含：agent图标、名称、cron人文化、agent名、状态徽章（active绿/paused黄/completed灰）、未读数、下次运行时间
- 点击卡片 → `navigateToTask(taskId)`
- 点击 + 号 → 打开 TaskFormDialog（create 模式）
- 空状态：提示"暂无定时任务，点击右上角创建"
- `onMounted` 调用 `loadTasks()` + `loadAgents()` + `markAllTasksRead()`

### TaskDetailPage.vue — Level 2 任务详情

- 顶栏返回按钮 → `goBack()` 回列表
- 编辑按钮 → 打开 TaskFormDialog（edit 模式）
- 子Tab默认展示「概览」
- 3秒轮询 `GET /api/tasks/{id}` 获取最新运行状态

### TaskOverviewTab.vue — 概览子Tab

- 信息卡片：只读展示任务配置（状态、cron、agent、重复模式、已运行次数、下次执行时间）
- Prompt 预览：折叠显示前3行，点击展开全文（markdown渲染）
- 操作按钮根据状态动态显示：
  - active → 「立即触发」「暂停」「删除」
  - paused → 「立即触发」「恢复」「删除」
  - completed → 「删除」
- 删除操作需确认弹窗
- 操作后自动刷新任务数据

### TaskHistoryTab.vue — 执行历史子Tab

- 运行中执行置顶，3秒轮询更新状态
- 已完成执行按时间倒序
- 元信息标签：时长、模型、token数
- 未读点：点击行时标记已读 + 滑入详情
- 点击执行行 → 滑入 TaskExecDetail

### TaskExecDetail.vue — Level 3 执行详情面板

- 右侧滑入面板（`transform: translateX` 动画）
- 背景半透明遮罩，点击遮罩关闭
- 复用现有 `ContentBlocks` + `useChatRender.parseAssistantContent()` + `ChatMetadataModal`
- 复用现有折叠/展开逻辑（`detailOverflows`、`detailUserExpanded` 等）
- 文件路径点击 → 关闭面板 → 打开文件查看器

## 迁移步骤

```
Step 1: 创建 useTaskTab.ts
  - 迁出 taskDrawerOpen、轮询逻辑、tasks 数据加载
  - 导出 navigateToTask()、goBack() 等导航方法

Step 2: 创建 TaskTab.vue + TaskListPage.vue
  - 从 TaskDrawer 迁移列表渲染逻辑
  - 从 BottomSheet 改为全屏布局

Step 3: 创建 TaskDetailPage.vue + TaskOverviewTab.vue + TaskHistoryTab.vue
  - 概览Tab：从 TaskDrawer 的任务行信息 + 现有操作逻辑组合
  - 执行历史Tab：从 TaskExecDialog 迁移列表渲染逻辑

Step 4: 创建 TaskExecDetail.vue
  - 从 TaskExecDialog 的 detail view 迁移
  - 改为滑入面板 + 遮罩
  - 复用 ContentBlocks + ChatMetadataModal

Step 5: App.vue 集成
  - 新增 Tasks dock 按钮
  - 渲染 TaskTab
  - 聊天卡片跳转链路

Step 6: 清理 Chat 模块
  - 移除 TaskDrawer/TaskExecDialog 引用
  - 移除 ChatInputBar 任务按钮
  - 移除 useChatSession 中任务相关代码

Step 7: 删除旧文件
  - TaskDrawer.vue
  - TaskExecDialog.vue

Step 8: 调整 ContentBlocks 卡片
  - 简化为"查看详情"跳转按钮
```

## 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 聊天卡片引用的任务已被删除 | TaskDetailPage 显示"任务已删除"空状态，提供返回列表按钮 |
| 任务正在运行时进入详情 | 执行历史Tab顶部显示运行中状态，3秒轮询更新 |
| 正在查看执行详情时任务被删除 | 显示提示"任务已被删除"，自动返回列表 |
| 聊天流进行中点击卡片跳转 | 不中断聊天流，仅切换Tab。流继续在后台运行 |
| Tasks Tab 切走再切回 | 保留导航栈和子Tab状态，不重置。列表页 onActivated 时刷新数据 |
| 多个聊天卡片引用同一任务 | 跳转到同一个详情页，不会重复打开 |
| PortForward 按钮条件显示 | Tasks 按钮始终显示，PortForward 仍仅 App 模式 |

## 动画规格

| 过渡 | 类型 | 时长 |
|------|------|------|
| 列表 → 详情 | 右滑入 | 250ms ease-out |
| 详情 → 列表 | 右滑出 | 200ms ease-in |
| 执行详情面板滑入 | 右侧滑入 + 遮罩淡入 | 250ms ease-out |
| 执行详情面板滑出 | 右侧滑出 + 遮罩淡出 | 200ms ease-in |
| 子Tab切换（概览↔历史） | 无动画，即时切换 | — |
| 创建/编辑弹窗 | 沿用现有 ModalDialog 动画 | — |
