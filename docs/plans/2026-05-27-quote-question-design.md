# 引用提问功能设计

## 概述

移除现有的长按行编辑菜单，替换为「引用提问」功能：用户在代码预览或 Markdown 预览中选择文本后，可将选中文本作为代码块引用、附加文件路径，与用户输入的消息合并发送到当前会话。

## 移除部分

### 删除文件
- `web/src/composables/useLongPressLineMenu.ts` — 整个文件

### 从 CodePreview.vue 移除
- 模板：长按上下文菜单（`Teleport` + `v-if="showContextMenu"`）、编辑/插入 BottomSheet、backdrop
- 逻辑：`useLongPressLineMenu` import 及所有解构返回值、`editDrawerTitle` computed、`closeEditDrawer` 函数、`editingLine` / `insertMode` / `copiedLine` / `highlightedLine` watchers
- Props：`editable` prop
- Emits：`@content-change` emit
- Import：`BottomSheet` import
- CSS：`.line-context-*`、`.line-edit-*`、`.line-copied`、`.line-highlighted`、`.line-editing`、`.line-insert-marker`、`.insert-above`、`.insert-below` 相关样式
- 非scoped样式：`@keyframes line-flash`、`.line-flash`

### 保留不动
- `useDoubleClickCopy.ts` — 双击复制功能不受影响
- `copy-flash` 动画 — 仍被双击复制使用
- 后端 `ServeFileEditLine` handler — 暂时保留，后续可单独清理

## 新增部分：引用提问

### 触发方式
- 用户使用浏览器原生长按选择文本（系统自带选择手柄、放大镜等）
- 选区存在且非空时，在底部 Dock 栏上方显示浮动操作栏
- 选区消失时自动隐藏

### 浮动操作栏
- **位置**：固定定位，紧贴底部 Dock 栏上方
- **内容**：选中文本预览（截断至约 80 字符）+ 「引用提问」按钮
- **样式**：半透明背景，与 Dock 栏视觉风格统一
- **生命周期**：监听 `selectionchange` 事件，选区为空时隐藏；选区变化时更新预览文本
- **作用范围**：仅在 CodePreview 和 MarkdownPreview 的内容区域内选择时显示

### 输入面板（BottomSheet）
- **顶部**：目标会话信息（会话名称 + agent 图标），可点击展开会话选择器
  - 默认为当前打开的会话
  - 没有活跃会话时自动用默认 agent 创建新会话
- **中部**：引用预览（只读），展示将要发送的代码块引用格式
- **底部**：输入框 + 发送按钮
- **交互**：点击「引用提问」按钮后打开此面板

### 消息格式

代码预览中选中（有语言标识 + 文件路径 + 行号）：
````
```go:src/main.go:10-15
选中的文本内容
```

用户输入的消息
````

Markdown 预览中选中（无语言标识）：
````
```:README.md:20-30
选中的文本内容
```

用户输入的消息
````

- 语言标识从代码预览的 language prop 推断
- 行号通过 `Range` API 计算选区覆盖的起止行
- Markdown 预览中的选中：不加语言标识

### 发送行为
- 静默发送到目标会话（POST `/api/ai/chat`，body: `{ message, agentId }`，query: `?session_id=...`）
- 发送后显示 toast "已发送到 [会话名称]"
- 不自动打开 ChatPanel
- 发送后关闭输入面板

## 实现细节

### 选区检测
- 监听 `document.selectionchange` 事件
- 使用 `window.getSelection()` 获取选区
- 通过 `Range.getBoundingClientRect()` 或 `anchorNode/anchorOffset` 判断选区是否在目标区域内
- 代码预览中，通过遍历 `.code-line` 元素和 `data-line` 属性获取行号
- Markdown 预览中，行号计算需基于渲染后 HTML 的文本节点位置

### 跨组件通信
当前 `sendMessage()` 位于 `ChatPanel.vue` 内部，外部组件无法直接调用。需要提供一种机制让引用提问面板发送消息：

**方案：App 层 provide 发送函数**
- `ChatPanel.vue` 通过 `provide('sendChatMessage', sendMessage)` 暴露发送函数
- `App.vue` 管理 ChatPanel 的 ref，获取 session 信息后 provide 给子树
- 引用提问面板通过 `inject` 获取发送函数和会话信息

### 会话切换
- 在输入面板顶部显示当前目标会话
- 点击后弹出会话选择列表（复用 `SessionSelector` 组件的会话列表逻辑）
- 选择后更新目标会话 ID 和 agent ID

### 新增文件
- `web/src/composables/useQuoteQuestion.ts` — 引用提问核心逻辑（选区检测、消息格式化、发送）
- `web/src/components/common/QuoteQuestionBar.vue` — 浮动操作栏组件
- `web/src/components/common/QuoteQuestionSheet.vue` — 输入面板 BottomSheet

### 修改文件
- `web/src/components/file/CodePreview.vue` — 移除长按菜单，集成 QuoteQuestionBar
- `web/src/components/file/MarkdownPreview.vue` — 集成 QuoteQuestionBar
- `web/src/components/chat/ChatPanel.vue` — provide 发送函数和会话信息
- `web/src/App.vue` — provide 会话状态

## 边界情况
- 选区跨多个代码块/语言区域：取选区起始位置的语言和文件信息
- 选区为空（仅点击无拖动）：不显示操作栏
- 代码预览中选区包含行号列：只提取代码文本部分，不包含行号
- 多次打开/关闭面板：确保状态正确重置
- 快速切换选区：防抖处理 selectionchange 事件
