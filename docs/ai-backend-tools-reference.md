# ClawBench AI 后端工具调用参考文档

> 生成时间：2026-05-02
>
> 本文档记录了 ClawBench 支持的 5 种 AI 后端（Claude、Codebuddy、OpenCode、Gemini、Codex）各自支持的工具调用列表、原始 JSON 输出结构以及经过 ClawBench 解析器规范化后的统一事件格式。

---

## 目录

1. [后端概览](#1-后端概览)
2. [统一事件格式（ClawBench 内部）](#2-统一事件格式clawbench-内部)
3. [Claude 后端](#3-claude-后端)
4. [Codebuddy 后端](#4-codebuddy-后端)
5. [OpenCode 后端](#5-opencode-后端)
6. [Gemini 后端](#6-gemini-后端)
7. [Codex 后端](#7-codex-后端)
8. [工具名称规范化映射](#8-工具名称规范化映射)
9. [跨后端工具对比矩阵](#9-跨后端工具对比矩阵)

---

## 1. 后端概览

| 后端 | CLI 命令 | 流式输出格式 | 解析器 | 独有工具 |
|------|---------|------------|--------|---------|
| Claude | `claude` | stream-json (verbose) | `StreamParser` | LSP, Monitor, NotebookEdit, PushNotification, RemoteTrigger, ScheduleWakeup, TodoWrite, Worktree |
| Codebuddy | `codebuddy` | stream-json (include-partial-messages) | `StreamParser` (共享) | PowerShell, TaskCreate/Get/Update/List, SkillManage, StructuredOutput, SendMessage, TeamCreate/Delete, ImageGen, WeChatReply, WeComReply, ComputerUse |
| OpenCode | `opencode` | json | `OpenCodeStreamParser` | LSP (goto_definition/find_references/symbols/diagnostics/rename), AST grep, task/background_output/background_cancel, session_list/read/search/info, skill/skill_mcp, look_at, mobile, todowrite |
| Gemini | `gemini` | stream-json | `GeminiStreamParser` | google_web_search, invoke_agent, activate_skill, save_memory, enter_plan_mode |
| Codex | `codex` | json (--json) | `CodexStreamParser` | command_execution (规范化为 Bash) |

---

## 2. 统一事件格式（ClawBench 内部）

所有后端的输出最终被解析为统一的 `StreamEvent` 结构：

```go
type StreamEvent struct {
    Type      string    // "content", "thinking", "tool_use", "metadata", "done", "error", "warning", "raw_output", "resume_split"
    Content   string    // 增量文本（Type=content 或 Type=thinking）
    Meta      *Metadata // 元数据（Type=metadata）
    Error     string    // 错误消息（Type=error）
    Tool      *ToolCall // 工具调用信息（Type=tool_use）
    RawOutput string    // AI 后端的原始输出行（Type=raw_output）
}

type ToolCall struct {
    Name   string // 规范化工具名（如 "Read", "Bash", "Edit"）
    ID     string // 工具调用 ID
    Input  string // 工具输入（JSON 字符串，已规范化为 snake_case）
    Done   bool   // 工具调用输入是否完成
}

type Metadata struct {
    Model        string  `json:"model,omitempty"`
    InputTokens  int     `json:"inputTokens,omitempty"`
    OutputTokens int     `json:"outputTokens,omitempty"`
    DurationMs   int     `json:"durationMs,omitempty"`
    CostUSD      float64 `json:"costUsd,omitempty"`
    SessionID    string  `json:"sessionId,omitempty"`
    StopReason   string  `json:"stopReason,omitempty"`
    IsError      bool    `json:"isError,omitempty"`
    ErrorMessage string  `json:"errorMessage,omitempty"`
}
```

---

## 3. Claude 后端

### 3.1 工具列表

**内置工具（26 个）：**

| 工具名 | 描述 |
|--------|------|
| Agent | 启动子代理处理复杂多步任务 |
| AskUserQuestion | 向用户提问 |
| Bash | 执行 shell 命令 |
| Edit | 对文件进行精确字符串替换 |
| EnterPlanMode | 进入计划模式 |
| EnterWorktree | 创建/进入 git worktree |
| ExitPlanMode | 退出计划模式 |
| ExitWorktree | 退出 worktree |
| Glob | 按模式匹配文件路径 |
| Grep | 基于 ripgrep 的内容搜索 |
| ListMcpResourcesTool | 列出 MCP 服务器资源 |
| LSP | 与语言服务器协议交互 |
| Monitor | 后台监控长时间运行脚本 |
| NotebookEdit | 编辑 Jupyter notebook 单元格 |
| PushNotification | 发送桌面通知 |
| Read | 读取本地文件内容 |
| ReadMcpResourceTool | 读取 MCP 资源 |
| RemoteTrigger | 调用 Claude.ai 远程触发器 |
| ScheduleWakeup | 调度唤醒任务 |
| Skill | 执行技能 |
| TaskOutput | 获取后台任务输出 |
| TaskStop | 停止后台任务 |
| TodoWrite | 创建/管理任务列表 |
| WebFetch | 从 URL 获取内容 |
| WebSearch | 网络搜索 |
| Write | 写入文件 |

**MCP 工具（29 个 chrome-devtools + 2 个 tavily）：**

| 工具名 | 描述 |
|--------|------|
| mcp__chrome-devtools__click | 点击元素 |
| mcp__chrome-devtools__close_page | 关闭页面 |
| mcp__chrome-devtools__drag | 拖拽元素 |
| mcp__chrome-devtools__emulate | 模拟浏览器特性 |
| mcp__chrome-devtools__evaluate_script | 执行 JavaScript |
| mcp__chrome-devtools__fill | 填写输入框 |
| mcp__chrome-devtools__fill_form | 填写多个表单元素 |
| mcp__chrome-devtools__get_console_message | 获取控制台消息 |
| mcp__chrome-devtools__get_network_request | 获取网络请求详情 |
| mcp__chrome-devtools__handle_dialog | 处理对话框 |
| mcp__chrome-devtools__hover | 悬停元素 |
| mcp__chrome-devtools__lighthouse_audit | Lighthouse 审计 |
| mcp__chrome-devtools__list_console_messages | 列出控制台消息 |
| mcp__chrome-devtools__list_network_requests | 列出网络请求 |
| mcp__chrome-devtools__list_pages | 列出页面 |
| mcp__chrome-devtools__navigate_page | 导航页面 |
| mcp__chrome-devtools__new_page | 新建页面 |
| mcp__chrome-devtools__performance_analyze_insight | 性能分析 |
| mcp__chrome-devtools__performance_start_trace | 开始性能追踪 |
| mcp__chrome-devtools__performance_stop_trace | 停止性能追踪 |
| mcp__chrome-devtools__press_key | 按键 |
| mcp__chrome-devtools__resize_page | 调整页面大小 |
| mcp__chrome-devtools__select_page | 选择页面 |
| mcp__chrome-devtools__take_memory_snapshot | 内存快照 |
| mcp__chrome-devtools__take_screenshot | 截图 |
| mcp__chrome-devtools__take_snapshot | 文本快照 |
| mcp__chrome-devtools__type_text | 输入文本 |
| mcp__chrome-devtools__upload_file | 上传文件 |
| mcp__chrome-devtools__wait_for | 等待元素 |
| mcp__tavily__tavily-extract | URL 内容提取 |
| mcp__tavily__tavily-search | Tavily AI 搜索 |

### 3.2 原始流式输出结构

Claude CLI 使用 `--output-format stream-json --verbose --include-partial-messages` 输出。

#### init 事件
```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/home/user/project",
  "session_id": "a4d67364-5ec9-4123-9d81-47bfb82f4d37",
  "tools": ["Read", "Write", "Edit", "Bash", ...],
  "mcp_servers": [
    {"name": "chrome-devtools", "status": "connected"},
    {"name": "tavily", "status": "connected"}
  ],
  "model": "claude-sonnet-4-6",
  "permissionMode": "bypassPermissions"
}
```

#### stream_event: content_block_start (tool_use)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "index": 2,
    "content_block": {
      "type": "tool_use",
      "id": "call_function_lkryuxu01n08_1",
      "name": "Read",
      "input": {}
    }
  }
}
```

#### stream_event: input_json_delta (工具输入增量)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "delta": {
      "type": "input_json_delta",
      "partial_json": "{\"file_path\":\"/etc/hostname\"}"
    }
  }
}
```

#### stream_event: content_block_stop
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_stop",
    "index": 2
  }
}
```

#### assistant 消息（完整工具调用）
```json
{
  "type": "assistant",
  "message": {
    "content": [
      {
        "type": "tool_use",
        "id": "call_function_lkryuxu01n08_1",
        "name": "Read",
        "input": {
          "file_path": "/etc/hostname"
        }
      }
    ]
  }
}
```

#### result 事件
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "session_id": "a4d67364-5ec9-4123-9d81-47bfb82f4d37",
  "duration_ms": 9419,
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 33904,
    "output_tokens": 98,
    "cache_read_input_tokens": 34240
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 33904,
      "outputTokens": 98,
      "cacheReadInputTokens": 34240,
      "costUSD": 0.113454,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  }
}
```

### 3.3 各工具输入样例

#### Read
```json
{
  "type": "tool_use",
  "id": "call_function_lkryuxu01n08_1",
  "name": "Read",
  "input": {
    "file_path": "/etc/hostname"
  }
}
```

#### Read (带行号范围)
```json
{
  "type": "tool_use",
  "name": "Read",
  "input": {
    "file_path": "/home/user/project/package.json",
    "limit": 10
  }
}
```

#### Write
```json
{
  "type": "tool_use",
  "name": "Write",
  "input": {
    "file_path": "/tmp/test_write.txt",
    "content": "hello world"
  }
}
```

#### Edit
```json
{
  "type": "tool_use",
  "name": "Edit",
  "input": {
    "file_path": "/home/user/project/package.json",
    "old_string": "\"version\": \"1.0.0\",",
    "new_string": "\"version\": \"1.0.1\",",
    "replace_all": false
  }
}
```

#### Bash
```json
{
  "type": "tool_use",
  "name": "Bash",
  "input": {
    "command": "echo hello",
    "description": "Print hello to stdout"
  }
}
```

#### Grep
```json
{
  "type": "tool_use",
  "name": "Grep",
  "input": {
    "pattern": "func main",
    "output_mode": "content"
  }
}
```

#### Glob
```json
{
  "type": "tool_use",
  "name": "Glob",
  "input": {
    "path": "/tmp",
    "pattern": "**/*.txt"
  }
}
```

#### Agent
```json
{
  "type": "tool_use",
  "name": "Agent",
  "input": {
    "description": "Explore /tmp directory",
    "prompt": "Explore the /tmp directory. List all files and subdirectories found there.",
    "subagent_type": "Explore"
  }
}
```

---

## 4. Codebuddy 后端

### 4.1 工具列表

| 工具名 | 描述 |
|--------|------|
| Agent | 启动子代理处理复杂多步任务 |
| Read | 读取本地文件内容（支持文本、图片、PDF、Jupyter notebook） |
| Write | 写入文件（覆盖已有文件） |
| Edit | 对文件进行精确字符串替换 |
| Bash | 执行 bash 命令 |
| PowerShell | 执行 PowerShell 命令 |
| EnterPlanMode | 进入规划模式 |
| ExitPlanMode | 退出规划模式 |
| TaskCreate | 创建结构化任务项 |
| TaskGet | 获取任务详情 |
| TaskUpdate | 更新任务状态 |
| TaskList | 列出所有任务 |
| WebFetch | 从 URL 获取并处理内容 |
| WebSearch | 网络搜索 |
| TaskStop | 停止后台任务 |
| TaskOutput | 获取后台任务输出 |
| Skill | 执行技能 |
| SkillManage | 管理技能 |
| AskUserQuestion | 向用户提问 |
| StructuredOutput | 结构化输出 |
| SendMessage | 发送消息给团队成员 |
| TeamCreate | 创建团队 |
| TeamDelete | 删除团队 |
| NotebookEdit | 编辑 Jupyter notebook 单元格 |
| LSP | 与语言服务器协议交互 |
| ImageGen | 生成图片 |
| EnterWorktree | 创建/进入 git worktree |
| LeaveWorktree | 离开 worktree |
| WeChatReply | 微信回复 |
| WeComReply | 企业微信回复 |
| ComputerUse | 计算机使用（GUI 操作） |

**MCP 工具（5 个 tavily）：**

| 工具名 | 描述 |
|--------|------|
| mcp__tavily__tavily_search | Tavily 搜索 |
| mcp__tavily__tavily_extract | URL 内容提取 |
| mcp__tavily__tavily_crawl | 网站爬取 |
| mcp__tavily__tavily_map | 网站地图 |
| mcp__tavily__tavily_research | 深度研究 |

### 4.2 原始流式输出结构

Codebuddy CLI 使用 `--output-format stream-json --include-partial-messages` 输出。格式与 Claude 基本一致（共享 `StreamParser`），但有以下差异：

- `init` 事件的 `type` 为 `"system"`，`subtype` 为 `"init"`
- `providerData` 字段包含模型信息（Claude 用 `modelUsage`）
- 无 `verbose` 标志要求

#### init 事件
```json
{
  "type": "system",
  "subtype": "init",
  "tools": ["Agent", "Read", "Write", "Edit", "Bash", ...],
  "model": "glm-5.1",
  "permissionMode": "bypassPermissions"
}
```

#### stream_event: content_block_start (tool_use)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "index": 2,
    "content_block": {
      "type": "tool_use",
      "id": "019de88124c2e41d3a805694792ca7a4",
      "name": "Read",
      "input": {}
    }
  }
}
```

#### result 事件
```json
{
  "type": "result",
  "is_error": false,
  "session_id": "bf1ec79f-2310-46b8-b5f8-d936921aacf1",
  "duration_ms": 5862,
  "usage": {
    "input_tokens": 56729,
    "output_tokens": 52,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "providerData": {
    "model": "glm-5.1",
    "usage": {
      "inputTokens": 56729,
      "outputTokens": 52
    }
  }
}
```

### 4.3 各工具输入样例

#### Read
```json
{
  "type": "tool_use",
  "id": "019de88124c2e41d3a805694792ca7a4",
  "name": "Read",
  "input": {
    "file_path": "/etc/hostname"
  }
}
```

#### Write
```json
{
  "type": "tool_use",
  "name": "Write",
  "input": {
    "content": "Hello World",
    "file_path": "/tmp/test_cb.txt"
  }
}
```

#### Edit
```json
{
  "type": "tool_use",
  "name": "Edit",
  "input": {
    "file_path": "/tmp/test_cb.txt",
    "new_string": "Hello CodeBuddy",
    "old_string": "Hello World",
    "replace_all": false
  }
}
```

#### Bash
```json
{
  "type": "tool_use",
  "name": "Bash",
  "input": {
    "command": "echo hello",
    "description": "Echo hello"
  }
}
```

#### WebSearch
```json
{
  "type": "tool_use",
  "name": "WebSearch",
  "input": {
    "query": "Go programming"
  }
}
```

#### Agent
```json
{
  "type": "tool_use",
  "name": "Agent",
  "input": {
    "description": "Explore /tmp directory files",
    "prompt": "List the files and directories in /tmp. Use `ls -la /tmp` to show all files with details.",
    "subagent_type": "Explore"
  }
}
```

#### TaskCreate
```json
{
  "type": "tool_use",
  "name": "TaskCreate",
  "input": {
    "subject": "Review /tmp directory contents",
    "description": "Explore the /tmp directory to understand what files exist there.",
    "activeForm": "Reviewing /tmp directory contents"
  }
}
```

#### EnterPlanMode
```json
{
  "type": "tool_use",
  "name": "EnterPlanMode",
  "input": {}
}
```

#### Skill
```json
{
  "type": "tool_use",
  "name": "Skill",
  "input": {
    "skill": "skills"
  }
}
```

---

## 5. OpenCode 后端

### 5.1 工具列表

**核心文件/搜索工具：**

| 工具名 | 描述 | OpenCode 原名 |
|--------|------|-------------|
| Read | 读取文件或目录内容 | read |
| Write | 写入文件 | write |
| Edit | 对文件进行精确字符串替换 | edit |
| Glob | 按模式匹配文件路径 | glob |
| Grep | 正则搜索文件内容 | grep |
| Bash | 执行 bash 命令 | bash |
| LS | 列出目录 | ls |

**LSP 工具：**

| 工具名 | 描述 |
|--------|------|
| lsp_goto_definition | 跳转到符号定义 |
| lsp_find_references | 查找符号引用 |
| lsp_symbols | 获取文件符号列表 |
| lsp_diagnostics | 获取语言服务器诊断信息 |
| lsp_prepare_rename | 检查重命名有效性 |
| lsp_rename | 重命名符号 |
| ast_grep_search | AST 感知搜索 |
| ast_grep_replace | AST 感知替换 |

**Agent/任务工具：**

| 工具名 | 描述 |
|--------|------|
| task | 基于 agent 执行任务 |
| background_output | 获取后台任务输出 |
| background_cancel | 取消后台任务 |

**会话工具：**

| 工具名 | 描述 |
|--------|------|
| session_list | 列出会话 |
| session_read | 读取会话消息 |
| session_search | 搜索会话内容 |
| session_info | 获取会话元数据 |

**Web 工具：**

| 工具名 | 描述 |
|--------|------|
| webfetch | 从 URL 获取内容 |
| websearch | Exa AI 搜索 |
| tavily_tavily-search | Tavily 搜索 |
| tavily_tavily-extract | Tavily 提取 |
| context7_resolve-library-id | 解析库 ID |
| context7_query-docs | 查询文档 |
| grep_app_searchGitHub | GitHub 代码搜索 |

**Chrome DevTools 工具（30 个，与 Claude 相同）**

**其他工具：**

| 工具名 | 描述 |
|--------|------|
| look_at | 从媒体文件提取信息 |
| skill | 加载/执行技能 |
| skill_mcp | 从 MCP 技能调用操作 |
| mobile | 生成移动连接二维码 |
| todowrite | 创建任务清单 |

### 5.2 原始流式输出结构

OpenCode CLI 使用 `--format json` 输出，格式与其他后端完全不同。

#### step_start 事件
```json
{
  "type": "step_start",
  "timestamp": 1777722110399,
  "sessionID": "ses_2178177f5ffetfMQSWFBKCwjpY",
  "part": {
    "id": "prt_de87eb1af001fNhddAk8HkawTc",
    "messageID": "msg_de87e88ce001nKpLP3QD43pKjo",
    "sessionID": "ses_2178177f5ffetfMQSWFBKCwjpY",
    "type": "step-start"
  }
}
```

#### text 事件
```json
{
  "type": "text",
  "timestamp": 1777722117643,
  "sessionID": "ses_2178177f5ffetfMQSWFBKCwjpY",
  "part": {
    "id": "prt_de87eb8a10015U7bj3G8dSgZc8",
    "type": "text",
    "text": "\n\n以下是所有支持的工具..."
  }
}
```

#### reasoning 事件（思考过程）
```json
{
  "type": "reasoning",
  "timestamp": 1777722112000,
  "sessionID": "ses_2178177f5ffetfMQSWFBKCwjpY",
  "part": {
    "type": "reasoning",
    "text": "\n\nLet me analyze this..."
  }
}
```

#### tool_use 事件
```json
{
  "type": "tool_use",
  "timestamp": 1777722325296,
  "sessionID": "ses_2177e2dc6ffe9kBr96eVzT0kOP",
  "part": {
    "type": "tool",
    "tool": "bash",
    "callID": "call_3287f1b12ee74e209c9fae53",
    "state": {
      "status": "completed",
      "input": {
        "command": "echo hello",
        "description": "Execute echo hello command"
      },
      "output": "hello\n",
      "metadata": {
        "output": "hello\n",
        "exit": 0,
        "description": "Execute echo hello command",
        "truncated": false
      },
      "title": "Execute echo hello command",
      "time": {
        "start": 1777722325273,
        "end": 1777722325291
      }
    }
  }
}
```

#### step_finish 事件
```json
{
  "type": "step_finish",
  "timestamp": 1777722117894,
  "sessionID": "ses_2178177f5ffetfMQSWFBKCwjpY",
  "part": {
    "reason": "stop",
    "type": "step-finish",
    "tokens": {
      "total": 39464,
      "input": 37514,
      "output": 1950,
      "reasoning": 0,
      "cache": {"write": 0, "read": 0}
    },
    "cost": 0
  }
}
```

**注意：** `reason` 可以是 `"stop"`（完成）或 `"tool-calls"`（还有更多步骤）。

### 5.3 各工具输入样例

#### bash (→ Bash)
```json
{
  "tool": "bash",
  "callID": "call_3287f1b12ee74e209c9fae53",
  "state": {
    "status": "completed",
    "input": {
      "command": "echo hello",
      "description": "Execute echo hello command"
    },
    "output": "hello\n"
  }
}
```

#### read (→ Read)
```json
{
  "tool": "read",
  "callID": "call_0e7bcd657f7c41c18a84f3b7",
  "state": {
    "status": "completed",
    "input": {
      "filePath": "/tmp/test_write.txt"
    },
    "output": "<path>/tmp/test_write.txt</path>\n<type>file</type>\n<content>\n1: hello world\n\n(End of file - total 1 lines)\n</content>",
    "metadata": {
      "preview": "hello world",
      "truncated": false,
      "loaded": []
    }
  }
}
```
**注意：** OpenCode 使用 `filePath`（camelCase），解析器会规范化为 `file_path`（snake_case）。

#### edit (→ Edit)
```json
{
  "tool": "edit",
  "callID": "call_3dd261f72aca43fba530b307",
  "state": {
    "status": "completed",
    "input": {
      "filePath": "/tmp/test_write.txt",
      "oldString": "hello world",
      "newString": "hi world"
    },
    "output": "Edit applied successfully.",
    "metadata": {
      "diagnostics": {},
      "diff": "Index: /tmp/test_write.txt\n===\n--- /tmp/test_write.txt\n+++ /tmp/test_write.txt\n@@ -1,1 +1,1 @@\n-hello world\n+hi world\n",
      "filediff": {
        "file": "/tmp/test_write.txt",
        "patch": "...",
        "additions": 1,
        "deletions": 1
      }
    }
  }
}
```
**注意：** OpenCode 使用 `oldString`/`newString`（camelCase），解析器会规范化为 `old_string`/`new_string`（snake_case）。`filePath` 规范化为 `file_path`。

#### grep (→ Grep)
```json
{
  "tool": "grep",
  "callID": "call_d553f5702cea4b93a4127eda",
  "state": {
    "status": "completed",
    "input": {
      "pattern": "hello",
      "path": "/tmp/test_write.txt",
      "output_mode": "content"
    },
    "output": "Found 1 match(es) in 1 file(s)\n\n/tmp/test_write.txt\n  1: hello world"
  }
}
```

---

## 6. Gemini 后端

### 6.1 工具列表

| 工具名 | Gemini 原名 | 描述 |
|--------|-----------|------|
| Read | read_file | 读取文件内容（支持 start_line/end_line 局部读取） |
| Write | write_file | 写入文件 |
| Edit | edit_file / replace | 编辑/替换文件内容 |
| Bash | shell / run_command | 执行 shell 命令 |
| LS | list_files | 列出目录 |
| Grep | search_files | 搜索文件内容 |
| Glob | glob | 按模式匹配文件 |
| WebFetch | web_fetch | 从 URL 获取内容（支持最多 20 个链接） |
| WebSearch | google_web_search | Google 搜索 |
| invoke_agent | invoke_agent | 调用子代理（如 codebase_investigator、generalist） |
| activate_skill | activate_skill | 激活技能（如 skill-creator） |
| enter_plan_mode | enter_plan_mode | 进入规划模式 |
| save_memory | save_memory | 保存记忆（全局/项目作用域） |
| list_directory | list_directory | 列出目录内容 |

### 6.2 原始流式输出结构

Gemini CLI 使用 `--output-format stream-json` 输出。

#### init 事件
```json
{
  "type": "init",
  "timestamp": "2026-05-02T11:44:34.640Z",
  "session_id": "41b56c60-4e7e-4802-8085-1afcd07066a0",
  "model": "gemini-3-flash-preview"
}
```

#### message 事件（增量）
```json
{
  "type": "message",
  "timestamp": "2026-05-02T11:41:51.039Z",
  "role": "assistant",
  "content": "我支持以下工具",
  "delta": true
}
```

#### tool_use 事件
```json
{
  "type": "tool_use",
  "timestamp": "2026-05-02T11:44:37.322Z",
  "tool_name": "read_file",
  "tool_id": "read_file_1777722277322_0",
  "parameters": {
    "file_path": "/etc/hostname"
  }
}
```
**注意：** Gemini 一次性发送完整的工具输入（Done=true），无增量。

#### tool_result 事件
```json
{
  "type": "tool_result",
  "tool_id": "read_file_1777722277322_0",
  "status": "success",
  "output": "文件内容..."
}
```

#### tool_result 错误事件
```json
{
  "type": "tool_result",
  "tool_id": "read_file_1777722277322_0",
  "status": "error",
  "output": "Path not in workspace: Attempted path \"/etc/hostname\" resolves outside the allowed workspace directories..."
}
```

#### result 事件
```json
{
  "type": "result",
  "status": "success",
  "stats": {
    "total_tokens": 32353,
    "input_tokens": 32078,
    "output_tokens": 113,
    "cached": 15182,
    "input": 16896,
    "duration_ms": 23615,
    "tool_calls": 2,
    "models": {
      "gemini-3-flash-preview": {
        "total_tokens": 32353,
        "input_tokens": 32078,
        "output_tokens": 113,
        "cached": 15182,
        "input": 16896
      }
    }
  }
}
```

### 6.3 各工具输入样例

#### read_file (→ Read)
```json
{
  "type": "tool_use",
  "tool_name": "read_file",
  "tool_id": "read_file_1777722277322_0",
  "parameters": {
    "file_path": "/etc/hostname"
  }
}
```

#### write_file (→ Write)
```json
{
  "type": "tool_use",
  "tool_name": "write_file",
  "tool_id": "write_file_1777722488715_0",
  "parameters": {
    "content": "hello gemini",
    "file_path": "/tmp/gemini_test.txt"
  }
}
```

#### replace (→ Edit)
```json
{
  "type": "tool_use",
  "tool_name": "replace",
  "tool_id": "replace_1777722491571_0",
  "parameters": {
    "file_path": "/tmp/gemini_test.txt",
    "old_string": "hello gemini",
    "new_string": "hello world",
    "instruction": "Change \"gemini\" to \"world\" in the greeting message."
  }
}
```
**注意：** Gemini 的 `replace` 工具额外包含 `instruction` 字段。

#### run_shell_command (→ Bash)
```json
{
  "type": "tool_use",
  "tool_name": "run_shell_command",
  "tool_id": "run_shell_command_1777722289442_0",
  "parameters": {
    "description": "Read the /etc/hostname file using cat.",
    "command": "cat /etc/hostname"
  }
}
```

#### glob (→ Glob)
```json
{
  "type": "tool_use",
  "tool_name": "glob",
  "tool_id": "glob_1777722401114_0",
  "parameters": {
    "pattern": "**/*.txt",
    "dir_path": "/tmp"
  }
}
```

#### web_fetch (→ WebFetch)
```json
{
  "type": "tool_use",
  "tool_name": "web_fetch",
  "tool_id": "web_fetch_1777722401493_1",
  "parameters": {
    "prompt": "https://example.com"
  }
}
```

---

## 7. Codex 后端

### 7.1 工具列表

Codex 只有一种工具：`command_execution`，在 ClawBench 中规范化为 `Bash`。

| Codex 原始类型 | 规范化名称 | 描述 |
|---------------|----------|------|
| command_execution | Bash | 执行 shell 命令 |
| agent_message | (content/thinking) | AI 回复文本 |

### 7.2 原始流式输出结构

Codex CLI 使用 `--json` 输出。

#### thread.started 事件
```json
{
  "type": "thread.started",
  "thread_id": "019de87e-7fb8-7653-aa4c-86d066ffab5f"
}
```

#### turn.started 事件
```json
{
  "type": "turn.started"
}
```

#### item.started 事件
```json
{
  "type": "item.started",
  "item": {
    "id": "item_abc123",
    "type": "command_execution",
    "command": "ls -la",
    "status": "in_progress"
  }
}
```

#### item.completed 事件（agent_message）
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_xyz789",
    "type": "agent_message",
    "text": "这是一个回复内容"
  }
}
```

**思考过程与回复的分离：** Codex 使用 `\n\n` 分隔思考过程和回复内容：
```
<思考过程文本>\n\n<实际回复内容>
```

#### item.completed 事件（command_execution）
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_abc123",
    "type": "command_execution",
    "command": "ls -la /tmp",
    "aggregated_output": "total 48\ndrwxrwxrwt ...",
    "exit_code": 0,
    "status": "completed"
  }
}
```

#### turn.completed 事件
```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 12000,
    "cached_input_tokens": 5000,
    "output_tokens": 800
  }
}
```

#### error 事件
```json
{
  "type": "error",
  "message": "Reconnecting... 1/5"
}
```

#### turn.failed 事件
```json
{
  "type": "turn.failed",
  "error": {
    "message": "exceeded retry limit, last status: 401 Unauthorized"
  }
}
```

### 7.3 工具输入规范化

Codex 的 `command_execution` 被规范化为 Bash 工具调用：

**item.started（开始执行）：**
```
原始: {"type":"item.started","item":{"type":"command_execution","command":"ls -la","id":"item_1"}}
规范化: ToolCall{Name:"Bash", ID:"item_1", Input:"{\"command\":\"ls -la\"}", Done:false}
```

**item.completed（执行完成）：**
```
原始: {"type":"item.completed","item":{"type":"command_execution","command":"ls -la","aggregated_output":"total 48\n...","id":"item_1"}}
规范化: ToolCall{Name:"Bash", ID:"item_1", Input:"{\"command\":\"ls -la\",\"output\":\"total 48\\n...\"}", Done:true}
```

### 7.4 Resume 模式

Codex 的 resume 模式（`codex exec resume`）不支持 `--json`，输出为纯文本到 stderr，格式如下：

```
OpenAI Codex v0.57.0 (research preview)
--------
workdir: /home/user/project
model: codex-MiniMax-M2.7
--------
user
<prompt>
codex
<thinking block>
<response content>
exec
<command> in <dir> [succeeded|failed] in <time>:
<output>
codex
<thinking block>
<response content>
```

思考块使用 `<tool_call>...`\u0060 标记，解析器通过这些标记区分思考过程和回复内容。

---

## 8. 工具名称规范化映射

ClawBench 解析器将各后端的工具名称规范化为统一的 PascalCase 格式：

### Gemini → 规范化

| Gemini 原名 | 规范化名称 |
|-----------|----------|
| read_file | Read |
| write_file | Write |
| edit_file | Edit |
| replace | Edit |
| shell | Bash |
| run_command | Bash |
| list_files | LS |
| search_files | Grep |

### OpenCode → 规范化

| OpenCode 原名 | 规范化名称 |
|-------------|----------|
| read | Read |
| write | Write |
| edit | Edit |
| bash | Bash |
| glob | Glob |
| grep | Grep |
| ls | LS |

### Codex → 规范化

| Codex 原始类型 | 规范化名称 |
|--------------|----------|
| command_execution | Bash |

### 字段名规范化

各后端使用不同的字段命名风格，解析器统一规范化为 snake_case：

| 后端 | 原始字段 | 规范化字段 |
|------|---------|----------|
| OpenCode | `filePath` | `file_path` |
| OpenCode | `oldString` | `old_string` |
| OpenCode | `newString` | `new_string` |
| Gemini | `filePath` | `file_path` |

---

## 9. 跨后端工具对比矩阵

### 核心工具对比

| 功能 | Claude | Codebuddy | OpenCode | Gemini | Codex |
|------|--------|-----------|----------|--------|-------|
| 读取文件 | Read | Read | read | read_file | - |
| 写入文件 | Write | Write | write | write_file | - |
| 编辑文件 | Edit | Edit | edit | replace | - |
| 执行命令 | Bash | Bash | bash | run_command | command_execution |
| 搜索内容 | Grep | - | grep | search_files | - |
| 匹配文件 | Glob | - | glob | glob | - |
| 网络搜索 | WebSearch | WebSearch | websearch | google_web_search | - |
| 获取URL | WebFetch | WebFetch | webfetch | web_fetch | - |
| 子代理 | Agent | Agent | task | invoke_agent | - |
| 规划模式 | EnterPlanMode | EnterPlanMode | - | enter_plan_mode | - |
| 技能 | Skill | Skill | skill | activate_skill | - |

### 特有工具对比

| 工具类别 | Claude 独有 | Codebuddy 独有 | OpenCode 独有 | Gemini 独有 |
|---------|-----------|--------------|-------------|-----------|
| 语言服务 | LSP | LSP | lsp_* (6个) + ast_grep | - |
| 任务管理 | TodoWrite | TaskCreate/Get/Update/List | todowrite | - |
| 团队协作 | - | SendMessage, TeamCreate/Delete | - | - |
| 图片生成 | - | ImageGen | - | - |
| 记忆系统 | - | - | - | save_memory |
| 媒体分析 | - | ComputerUse | look_at | - |
| 社交集成 | - | WeChatReply, WeComReply | - | - |
| PowerShell | - | PowerShell | - | - |
| 结构化输出 | - | StructuredOutput | - | - |
| 浏览器 | chrome-devtools (MCP) | - | chrome-devtools | - |
| 后台任务 | Monitor, TaskOutput/Stop | TaskOutput/Stop | background_* | - |
| 笔记本 | NotebookEdit | NotebookEdit | - | - |
| 通知 | PushNotification | - | - | - |
| Worktree | Enter/ExitWorktree | Enter/LeaveWorktree | - | - |

### 流式事件类型对比

| 事件类型 | Claude | Codebuddy | OpenCode | Gemini | Codex |
|---------|--------|-----------|----------|--------|-------|
| 文本内容 | assistant.text / stream_event.text_delta | assistant.text / stream_event.text_delta | text | message (delta) | agent_message |
| 思考过程 | assistant.thinking / stream_event.thinking_delta | stream_event.thinking_delta | reasoning | - | agent_message (\\n\\n分隔) |
| 工具调用 | stream_event.content_block_start + input_json_delta + content_block_stop | stream_event.content_block_start + input_json_delta + content_block_stop | tool_use (part.state) | tool_use (parameters) | item.started + item.completed |
| 工具结果 | (内置在后续消息中) | (内置在后续消息中) | (part.state.output) | tool_result | aggregated_output |
| 元数据 | result | result | step_finish | result | turn.completed |
| 完成 | result (done) | result (done) | step_finish (reason=stop) | result | turn.completed |
| 错误 | result (is_error) | result (is_error) | - | error / tool_result (status=error) | error / turn.failed |

### 工具调用增量 vs 一次性

| 后端 | 工具输入传输方式 |
|------|---------------|
| Claude | 增量传输：content_block_start → input_json_delta (多次) → content_block_stop |
| Codebuddy | 增量传输：content_block_start → input_json_delta (多次) → content_block_stop |
| OpenCode | 一次性：tool_use 事件包含完整的 state.input |
| Gemini | 一次性：tool_use 事件包含完整的 parameters |
| Codex | 一次性：item.started/item.completed 包含完整 command |

---

> **备注：** 以上数据通过直接调用各 AI 后端 CLI 工具获取，结合 ClawBench 源码中的解析器实现（`internal/ai/` 目录）交叉验证。Codex 后端因 API 认证问题未能实时获取，其输出结构基于源码分析。