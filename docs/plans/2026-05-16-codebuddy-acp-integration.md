# CodeBuddy ACP (Agent Client Protocol) 集成设计

> 调研日期：2026-05-16
> CodeBuddy 版本：v2.94.2 (`@tencent-ai/codebuddy-code`)

## 一、背景

当前 ClawBench 的 CodeBuddy 后端采用 CLI 子进程模式（`codebuddy --print --output-format stream-json`），每次对话启动新进程。现需新增 HTTP 传输层，通过 CodeBuddy daemon 的 ACP 协议实现流式对话，支持多会话并发、斜杠命令和 Skill 查询。

## 二、CodeBuddy Daemon 模式概览

### 2.1 启动方式

```bash
# 启动 daemon（默认端口 9191）
codebuddy daemon start

# 指定端口
codebuddy daemon start --port 9192

# 停止 daemon
codebuddy daemon stop

# 查看状态
codebuddy daemon status
```

Daemon 启动后提供 HTTP API，监听 `http://localhost:{port}`。

### 2.2 可用的传输协议

| 协议 | 端点 | 特点 |
|------|------|------|
| **Runs API** | `POST /api/v1/runs` | Gateway Protocol 格式，仅返回**完成后的**消息，不支持增量流式 |
| **ACP** | `POST /api/v1/acp` | JSON-RPC 2.0 over SSE，**完整增量流式**，支持 session 管理、斜杠命令、Skill |
| **WebUI** | `GET /` | 浏览器界面，非 API |

**结论：ACP 是唯一满足流式需求的协议。**

### 2.3 请求头要求

所有 API 请求（除 `/api/v1/health` 外）必须包含：

```
x-codebuddy-request: true
```

## 三、ACP 协议详解

### 3.1 协议基础

- 传输：HTTP + SSE (Server-Sent Events)
- 格式：JSON-RPC 2.0
- 请求：`POST /api/v1/acp`
- 响应：SSE 流，每个事件格式为 `data: {json}\n\n`

### 3.2 连接生命周期

```
connect → initialize → session/new → session/prompt (流式) → session/end
                                                  ↕
                                          session/cancel (可随时取消)
```

### 3.3 Step 1: Connect（建立连接）

**请求：**
```
POST /api/v1/acp/connect
Headers: x-codebuddy-request: true
```

**响应（非 SSE，普通 JSON）：**
```json
{
  "connectionId": "conn-abc123",
  "sessionToken": "st-xyz789"
}
```

### 3.4 Step 2: Initialize（协议握手）

**请求：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "clawbench",
      "version": "1.0.0"
    }
  }
}
```

**SSE 响应：**
```
data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"serverInfo":{"name":"codebuddy","version":"2.94.2"}}}
```

### 3.5 Step 3: Session/New（创建会话）

**请求：**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/home/user/project",
    "mcpServers": []
  }
}
```

> ⚠️ **关键参数说明：**
> - `cwd`：必填，工作目录（不是 `workingDirectory`）
> - `mcpServers`：必填，MCP 服务器配置数组（即使为空也要传 `[]`）

**SSE 响应（多事件）：**

1. `session/update` — 返回 sessionId：
```
data: {"jsonrpc":"2.0","id":2,"result":{"type":"session/update","sessionId":"sess-xxx"}}
```

2. `available_commands_update` — 返回可用斜杠命令列表（71个）：
```
data: {"jsonrpc":"2.0","id":2,"result":{"type":"available_commands_update","commands":[...]}}
```

3. 后续可能有 `mcp_server_update` 等事件

> ⚠️ SSE 连接在 session/new 后保持打开，需要逐行读取，提取 sessionId 后继续。**不要** `resp.read()` 全部响应，否则会阻塞。

### 3.6 Step 4: Session/Prompt（发送提示，流式响应）

**请求：**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess-xxx",
    "prompt": [
      {"type": "text", "text": "帮我实现这个功能"}
    ]
  }
}
```

> ⚠️ **prompt 格式：**
> - 是一个**内容部件数组**，不是嵌套的 `messages` 结构
> - 每个部件：`{type: "text", text: "..."}`
> - 不支持 `role` 字段，不需要包装在 `messages` 里

**SSE 流式事件（增量输出）：**

| 事件类型 | 说明 | 对应 StreamEvent |
|---------|------|-----------------|
| `agent_message_chunk` | AI 文本输出增量 | `content` |
| `agent_thought_chunk` | 思考过程增量 | `thinking` |
| `tool_call` | 工具调用开始 | `tool_use` |
| `tool_call_update` | 工具调用进度/完成 | `tool_result` |
| `session_end` | 会话轮次结束 | `done` |

**事件示例：**

```
data: {"jsonrpc":"2.0","id":3,"result":{"type":"agent_message_chunk","sessionId":"sess-xxx","content":"我来帮你"}}

data: {"jsonrpc":"2.0","id":3,"result":{"type":"agent_message_chunk","sessionId":"sess-xxx","content":"实现这个功能"}}

data: {"jsonrpc":"2.0","id":3,"result":{"type":"tool_call","sessionId":"sess-xxx","toolCall":{"id":"tc-1","toolName":"Read","input":{"file_path":"/path/to/file"}}}}

data: {"jsonrpc":"2.0","id":3,"result":{"type":"tool_call_update","sessionId":"sess-xxx","toolCallId":"tc-1","status":"completed","output":"file contents..."}}

data: {"jsonrpc":"2.0","id":3,"result":{"type":"session_end","sessionId":"sess-xxx","reason":"end_turn"}}
```

### 3.7 Step 5: Session/Cancel（取消）

**请求（通知，无 id）：**
```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "sess-xxx"
  }
}
```

### 3.8 Session/Resume（恢复会话）

**请求：**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "session/resume",
  "params": {
    "sessionId": "sess-xxx"
  }
}
```

- 恢复运行时会话（进程仍存活），**不回放历史**
- 适用于：网络断线重连、AutoResume（ExitPlanMode 后继续）

### 3.9 Session/Load（加载历史会话）

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/load",
  "params": {
    "sessionId": "sess-xxx"
  }
}
```

- 加载历史会话**并回放历史消息**
- ⚠️ **已知问题：** `session/load` 的 SSE 连接会持续打开等待回放完成，存在挂起风险
- 建议：优先使用 `session/resume`

### 3.10 其他 ACP 方法

| 方法 | 说明 |
|------|------|
| `session/set_model` | 切换模型 |
| `session/set_mode` | 切换模式 |
| `session/set_config_option` | 设置配置项（可能用于 systemPrompt） |
| `notifications/list` | 列出通知 |

## 四、斜杠命令与 Skill 查询

### 4.1 斜杠命令列表

**来源：** `session/new` 时的 `available_commands_update` SSE 事件

**格式：**
```json
{
  "type": "available_commands_update",
  "commands": [
    {
      "name": "/commit",
      "description": "Create a git commit",
      "metadata": {}
    },
    {
      "name": "/brainstorming",
      "description": "You MUST use this before any creative work...",
      "metadata": {"source": "skill", "skillName": "brainstorming"}
    },
    {
      "name": "/systematic-debugging",
      "description": "Use when encountering any bug...",
      "metadata": {"source": "plugin", "pluginName": "superpowers"}
    }
  ]
}
```

**已验证的 71 个命令分类：**
- 内置命令：`/commit`, `/clear`, `/compact`, `/cost`, `/review`, `/skills`, `/help` 等
- 插件命令：`/superpowers:brainstorm`, `/superpowers:systematic-debugging` 等
- Skill 命令：`/brainstorming`, `/test-driven-development`, `/systematic-debugging` 等

**使用方式：** 在 prompt 中直接发送斜杠命令文本即可，如 `{type: "text", text: "/commit"}`

### 4.2 Skill/Plugin 列表

**API：** `GET /api/v1/plugins`

**请求头：** `x-codebuddy-request: true`

**响应格式：**
```json
{
  "plugins": [
    {
      "id": "plugin-id",
      "name": "Plugin Name",
      "skills": [
        {
          "name": "skill-name",
          "description": "Skill description",
          "triggers": ["trigger phrase 1", "trigger phrase 2"]
        }
      ],
      "commands": [
        {
          "name": "/command-name",
          "description": "Command description"
        }
      ]
    }
  ]
}
```

### 4.3 MCP 服务器列表

**CLI 命令：** `codebuddy mcp list`

**ACP 方式：** `session/new` 的 `mcpServers` 参数可配置 MCP 服务器

## 五、并发会话支持

已验证：单个 CodeBuddy daemon 支持多个并发 ACP 会话。

测试结果：3 个并发 Runs API 请求在 3.6s 内全部完成，各自拥有独立会话。

ACP 协议中每个 `session/new` 创建独立的 sessionId，互不干扰。

## 六、systemPrompt 注入

ACP 协议的 `session/new` 和 `session/prompt` **没有显式的 systemPrompt 参数**。

可能的方案：
1. `session/set_config_option` — 需验证是否支持 systemPrompt 配置项
2. 在 prompt 前缀中注入 — 将 systemPrompt 作为首条 prompt 的文本前缀
3. CLI 模式已有 `--system-prompt` 参数，ACP 可能通过其他机制支持

## 七、与 CLI 模式的对比

| 维度 | CLI 子进程模式 | ACP Serve 模式 |
|------|--------------|----------------|
| 启动 | 每次对话 spawn 新进程 | Daemon 常驻，session/new 即用 |
| 流式 | `stream-json` 格式 stdout | SSE 增量事件 |
| 并发 | 每进程独立 | 单 daemon 多 session |
| 会话恢复 | `--resume --session-id` | `session/resume` |
| 斜杠命令 | 用户手动输入 | `available_commands_update` 枚举 |
| Skill 查询 | 无 API | `/api/v1/plugins` |
| systemPrompt | `--system-prompt` 参数 | 待确认 |
| 资源占用 | 高（每进程独立） | 低（共享 daemon 进程） |
| 延迟 | 冷启动 + CLI 初始化 | 热连接，低延迟 |

## 八、ClawBench 集成状态

### 已完成

- `internal/model/agent.go`：新增 `Transport` 和 `ServePort` 字段
  ```go
  Transport string `yaml:"transport" json:"transport"`       // "cli" (default) or "serve"
  ServePort int    `yaml:"serve_port" json:"servePort"`       // daemon port (default: 9191)
  ```
  - `IsServeTransport()` 方法
  - `EffectiveServePort()` 方法

### 待实现

1. **ServeBackend** (`internal/ai/codebuddy_serve.go`)：实现 `AIBackend` 接口，使用 ACP 协议
2. **DaemonManager** (`internal/ai/daemon.go`)：健康检查、自动启动、生命周期管理
3. **Handler 集成**：根据 agent 的 transport 字段选择后端
4. **Scheduler 支持**：定时任务支持 serve 传输
5. **前端 Skill/命令选择器**：在输入栏附件按钮旁添加按钮，打开选择对话框
