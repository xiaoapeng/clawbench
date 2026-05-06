# Agent 可选模型配置设计

## 概述

在 Agent YAML 配置中增加 `models` 列表，支持同 Agent 内切换模型（后端/系统提示词不变）。前端在会话输入区域显示模型切换芯片，切换仅更新前端状态，发消息时携带 `modelId` 参数覆盖默认模型。新建会话使用 Agent 默认模型。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 切换范围 | 同 Agent 内切换模型 | 后端/提示词不变，只换模型标识 |
| 数据来源 | YAML 静态列表 | CLI 无统一 `--list-models`，静态列表简单可控 |
| 消息处理 | 不做分界标记 | 每条消息已自带模型号，无需额外处理 |
| 模型状态持久化 | 不持久化 | 前端状态，随消息下发，无需改 DB/新接口 |
| UI 方式 | InputBar 上方模型芯片 | 模型信息更醒目 |
| 芯片显示条件 | 仅多模型 Agent 显示 | 单模型芯片无交互价值，浪费空间 |
| 兼容性 | 不向后兼容 | 直接替换 `model` 为 `models`，所有 YAML 一次性更新 |

## 数据模型

### Agent YAML

```yaml
id: codebuddy-glm
name: 顶梁柱
icon: 🤖
specialty: 通用问答、代码、文档、运维、科研
backend: codebuddy
models:
  - id: glm-5.1
    name: GLM 5.1
    default: true
  - id: gpt-5.4
    name: GPT 5.4
  - id: gemini-3.1-pro
    name: Gemini 3.1 Pro
system_prompt: |
  ...
```

### Go Model

```go
type AgentModel struct {
    ID      string `yaml:"id" json:"id"`
    Name    string `yaml:"name" json:"name"`
    Default bool   `yaml:"default" json:"default"`
}

type Agent struct {
    // ... 原有字段保留 ...
    Models       []AgentModel  `yaml:"models" json:"models"`      // 替换原 Model string
    // ...
}
```

- 删除 `Model string` 字段
- `LoadAgents()` 中默认模型取 `Models` 中 `default: true` 的，无标记取第一个
- `models` 只有一个元素 → 前端不显示芯片

## 后端变更

### 1. `GET /api/agents` — 无改动

`models` 数组自动序列化返回。

### 2. `POST /api/ai/sessions` — 无改动

不加 `modelId`。前端自行从 Agent `models` 中取默认模型作为初始状态。

### 3. `POST /api/ai/chat` — 增加 `modelId` 参数

```go
var req struct {
    // ... 原有字段 ...
    ModelID string `json:"modelId"`    // 新增：覆盖 agent 默认模型
}
```

- 若 `modelId` 非空，用它覆盖 Agent 默认模型
- 若为空，用 Agent 默认模型（和现在行为一致）

### 4. 不新增 API 接口，不改数据库 schema

## 前端变更

### 1. `useAgents.ts` — 增加模型 helper

```typescript
function getDefaultModelId(agentId: string): string
function getAgentModels(agentId: string): { id: string; name: string; default: boolean }[]
function isMultiModel(agentId: string): boolean
```

### 2. `useSessionIdentity.ts` — 增加模型状态

```typescript
const currentModelId = ref('')
const currentModelName = ref('')
```

- 新建会话时，从 Agent `models` 中取默认模型初始化
- 切换会话时，根据目标会话 Agent 重新加载默认模型

### 3. `ChatInputBar.vue` — 模型切换芯片

- 位置：`chat-top-actions` 区域，Sessions 按钮组旁边
- 仅 `isMultiModel(currentAgentId)` 为 true 时渲染
- 显示当前模型名 + 下拉箭头
- 点击弹出模型选择列表（复用 attach-menu 的 teleport 下拉模式）
- 选中后更新 `currentModelId` / `currentModelName`，无后端交互

### 4. `useChatStream.ts` — 发消息携带 modelId

构造 SSE 请求时，将 `currentModelId` 加入请求体。

## 边界情况

| 场景 | 处理 |
|------|------|
| 切换会话 | 模型重置为该 Agent 默认模型 |
| Agent 单模型 | 不显示芯片，不发 modelId，后端用默认 |
| 页面刷新/重连 | 从 Agent 默认模型重新初始化 |
| 旧会话 | 无影响，历史消息已自带模型号 |

## 变更文件清单

| 文件 | 变更 |
|------|------|
| `internal/model/agent.go` | `Model string` → `Models []AgentModel`，新增 `AgentModel` 结构体，更新 `LoadAgents()` |
| `internal/handler/chat_stream.go` | 请求体增加 `ModelID`，覆盖 Agent 默认模型 |
| `internal/handler/chat_session.go` | 移除对 `Agent.Model` 的直接引用，改用 `Models` |
| `internal/ai/factory.go` | `NewBackend()` 签名适配 `Models` |
| `config/agents/*.yaml` | 所有 YAML 从 `model: xxx` 改为 `models: [{id, name, default}]` |
| `web/src/composables/useAgents.ts` | 新增 `getDefaultModelId`、`getAgentModels`、`isMultiModel` |
| `web/src/composables/useSessionIdentity.ts` | 新增 `currentModelId`、`currentModelName` ref |
| `web/src/composables/useChatStream.ts` | 发消息请求体携带 `modelId` |
| `web/src/components/chat/ChatInputBar.vue` | 新增模型切换芯片 UI |
