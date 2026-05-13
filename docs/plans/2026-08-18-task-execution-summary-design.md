# 定时任务执行总结功能设计

## 概述

为定时任务执行添加自动总结功能。任务完成后自动调用 AI 后端生成保留 Markdown 格式的精简摘要，用户查看执行详情时默认看到总结，也可切换查看原文。

## 1. 配置

`config/config.yaml` 新增 `tasks` 段：

```yaml
tasks:
  summarize_backend: ""       # 可选：simple/claude/codebuddy/gemini/api 等任意 AI 后端
  summarize_model: ""        # 可选：模型覆盖，留空用后端默认
```

- `summarize_backend` 为空（默认）时不生成总结，向后兼容零风险
- `summarize_model` 为空时使用后端默认模型
- 当 `summarize_backend` 为 `api` 时，复用 `tts.api` 配置段（base_url / key / format / model）

`internal/model/config.go` 新增：

```go
type TasksConfig struct {
    SummarizeBackend string `yaml:"summarize_backend"`
    SummarizeModel   string `yaml:"summarize_model"`
}

// Config struct 新增字段
Tasks TasksConfig `yaml:"tasks"`
```

`internal/model/defaults.go` 中无需设置默认值（空即不启用）。

## 2. 包结构重构

### 现状问题

所有总结代码位于 `internal/speech/` 包，但总结并非语音专用。命名和职责不匹配。

### 重构方案

提取 `internal/summarize/` 包，将总结相关代码从 `internal/speech/` 迁出：

```
internal/summarize/
  ├── summarizer.go          # Summarizer 接口 + ttsPipeline（原 genericSummarizer）+ 常量
  ├── simple.go              # SimpleSummarizer（截断，不做 AI）
  ├── mmx.go                 # MMXSummarizer
  ├── ai_backend_summarizer.go  # AIBackendSummarizer（流式 AI 后端）
  ├── openai.go              # OpenAISummarizer
  ├── anthropic.go           # AnthropicSummarizer
  ├── task.go                # TaskSummarizer（定时任务总结，保留格式）
  └── strip_markdown.go      # StripMarkdown() 从 speech/interface.go 拆出

internal/speech/
  ├── interface.go           # SpeechProvider 接口（移除 StripMarkdown）
  ├── common_tts.go          # CLISpeechProvider
  ├── minimax.go             # MiniMax TTS
  ├── edge.go                # Edge TTS
  ├── piper.go               # Piper TTS
  ├── kokoro.go              # Kokoro TTS
  └── ...                    # 只保留语音合成相关
```

### 迁移映射

| 旧路径 | 新路径 | 备注 |
|--------|--------|------|
| `speech.Summarizer` | `summarize.Summarizer` | 接口不变 |
| `speech.StripMarkdown()` | `summarize.StripMarkdown()` | 工具函数移到新包 |
| `speech.NewSimpleSummarizer()` | `summarize.NewSimple()` | 包名已表达 summarize，命名简化 |
| `speech.NewMMXSummarizer()` | `summarize.NewMMX()` | 同上 |
| `speech.NewAIBackendSummarizer()` | `summarize.NewAIBackendSummarizer()` | 保留全名避免与 `ai.AIBackend` 混淆 |
| `speech.NewOpenAISummarizer()` | `summarize.NewOpenAI()` | 同上 |
| `speech.NewAnthropicSummarizer()` | `summarize.NewAnthropic()` | 同上 |
| `speech.shortTextThreshold` 等 | `summarize.ShortTextThreshold` | 常量改为导出（internal 包，仅供测试调整） |
| `speech.DefaultMaxSummarizeRunes` | `summarize.DefaultMaxSummarizeRunes` | 同上 |
| `speech.SimpleMaxSummarizeRunes` | `summarize.SimpleMaxSummarizeRunes` | 同上 |
| `speech.genericSummarizer` | `summarize.ttsPipeline` | 重命名：明确为 TTS 专用管道 |

### 命名说明

- `AIBackendSummarizer` 保留全名：因为 `AIBackend` 会与 `ai.AIBackend` 产生命名碰撞，两个包同时 import 时容易混淆
- `genericSummarizer` → `ttsPipeline`：该管道包含 `StripMarkdown` 输入/输出处理，是 TTS 专用逻辑；`TaskSummarizer` 不使用它

### 引用更新

- `internal/handler/tts.go` — 改为引用 `summarize` 包
- `cmd/server/main.go` — 总结初始化改为 `summarize` 包，`speech` 包不再管总结
- `internal/speech/` 内部如有引用 — 清理

## 3. TaskSummarizer

### 设计思路

与 TTS 总结的核心区别：

| 维度 | TTS 总结 | 任务总结 |
|------|----------|----------|
| 目的 | 语音朗读 | 阅读精简 |
| 格式 | 纯文本（StripMarkdown） | 保留 Markdown（标题、列表、代码块、加粗） |
| 代码块 | 删除 | 保留关键片段，删减冗余 |
| 表格 | 删除 | 保留精简版 |
| 后处理 | StripMarkdown | 无（保留原格式） |
| 管道 | `ttsPipeline`（strip→AI→strip） | 自有管道（raw→AI→raw） |

### 重要：TaskSummarizer 不使用 ttsPipeline

`TaskSummarizer` **必须不** 使用 `ttsPipeline`（原 `genericSummarizer`），因为：
- `ttsPipeline` 会在输入端调用 `StripMarkdown` 清洗文本
- `ttsPipeline` 会在输出端调用 `StripMarkdown` 移除格式
- `TaskSummarizer` 需要保留 Markdown 格式

`TaskSummarizer` 只复用 `AIBackendSummarizer` 的流式 AI 调用能力（`doSummarizePass` 策略函数），自行管理输入准备和输出处理。

### 实现

`internal/summarize/task.go`：

```go
// TaskSummarizer 为定时任务生成保留 Markdown 格式的精简总结。
// 它不使用 ttsPipeline（会 StripMarkdown），而是直接调用 AI 后端。
type TaskSummarizer struct {
    backend *AIBackendSummarizer
}

func NewTaskSummarizer(backendType, model string) (*TaskSummarizer, error) {
    b, err := NewAIBackendSummarizer(backendType, model)
    if err != nil {
        return nil, err
    }
    return &TaskSummarizer{backend: b}, nil
}

func (t *TaskSummarizer) Summarize(ctx context.Context, text string, language string) (string, error)
```

`Summarize` 方法内部逻辑：

1. 短文本判断（< ShortTextThreshold）→ 返回空字符串，前端直接显示原文
2. 长文本截断（> DefaultMaxSummarizeRunes）→ 截断输入到限制长度
3. 构建 system prompt（保留格式版）
4. 单次 AI 调用（调用 `AIBackendSummarizer` 的流式执行逻辑）
5. 不做 StripMarkdown 后处理
6. 不做 re-summarize 二次压缩（保留格式的总结通常比 TTS 纯文本短）

### 总结 Prompt

```
你是一个精简总结助手。请对以下 AI 助手的输出进行精简总结，要求：
1. 保留 Markdown 格式（标题、列表、代码块、加粗等）
2. 保留关键代码片段（但删减冗余的重复代码）
3. 保留核心结论和操作结果
4. 删减详细的推理过程、中间步骤、冗长的解释
5. 保留重要的错误信息和警告
6. 目标长度不超过原文的 30%
7. 使用与原文相同的语言输出
```

注意：prompt 第 7 条要求使用与原文相同的语言，避免硬编码 `"zh"`。

## 4. 数据库变更

### 新增列

```sql
ALTER TABLE task_executions ADD COLUMN summary TEXT;
```

- `NULL`：未生成（未配置总结后端，或生成中，或生成失败）
- `""`（空字符串）：原文太短无需总结，前端直接显示原文
- 有内容：总结文本

### 三态设计说明

| summary 值 | 含义 | 前端行为 |
|-------------|------|----------|
| `NULL` | 未配置/生成中/生成失败 | 不显示切换，直接显示原文 |
| `""` | 原文太短无需总结 | 显示切换，默认原文 Tab |
| 有内容 | 总结可用 | 显示切换，默认总结 Tab |

### 新增 service 函数

```go
func UpdateExecutionSummary(executionID int64, summary string) error
```

SQL：
```sql
UPDATE task_executions SET summary = ? WHERE id = ?
```

### API 变更

`GET /api/tasks/{id}/executions` 返回的每个 Execution 对象新增字段：

```go
type Execution struct {
    // ... 现有字段
    Summary    *string `json:"summary"`     // 新增：总结内容
}
```

SQL 查询新增 `te.summary` 列。

## 5. 后端执行集成

### scheduler.go 变更

在 `executeTask()` 中，AI 执行完成、写入 assistant message 之后：

```go
// 4. 更新 task 统计（run_count, last_run_at, next_run_at）
updateTaskStats(...)

// 5. [新增] 异步生成总结
if s.taskSummarizer != nil {
    executionID := executionID  // 捕获值
    blocks := blocks             // 捕获值
    go func() {
        // 使用独立 context，不继承 executeTask 的 ctx（会在函数返回时被 cancel）
        sumCtx, sumCancel := context.WithTimeout(context.Background(), 5*time.Minute)
        defer sumCancel()

        text := extractTextFromBlocks(blocks)
        if utf8.RuneCountInString(text) < summarize.ShortTextThreshold {
            service.UpdateExecutionSummary(executionID, "")
            return
        }
        summary, err := s.taskSummarizer.Summarize(sumCtx, text, "")
        if err != nil {
            log.Printf("task execution summary failed: task=%d exec=%d err=%v", task.ID, executionID, err)
            return  // summary 保持 NULL，前端显示原文
        }
        service.UpdateExecutionSummary(executionID, summary)
    }()
}
```

### 关键设计决策

- **独立 context**：总结 goroutine 使用 `context.WithTimeout(context.Background(), 5min)`，不继承 `executeTask` 的 ctx（后者在函数返回时被 cancel）
- **5 分钟超时**：防止 AI 后端无限挂起
- **异步执行**：总结在独立 goroutine 中执行，不阻塞任务状态更新
- **任务完成立即可见**：`run_count`、`next_run_at` 等统计在总结之前更新
- **容错**：总结失败不影响任务执行结果，只记日志
- **时序**：用户在总结完成前打开详情，看到原文（summary=NULL → 显示原文）
- **前端轮询**：现有 2 秒轮询机制自然能看到更新后的 summary
- **服务关闭**：总结 goroutine 可能被孤儿化（server shutdown），但最坏情况是 summary 保持 NULL，前端显示原文。可接受。

### extractTextFromBlocks

从 ContentBlock 数组中提取纯文本（text 类型的 content 拼接），用于总结输入：

```go
func extractTextFromBlocks(blocks []model.ContentBlock) string {
    var buf strings.Builder
    for _, b := range blocks {
        if b.Type == "text" && b.Text != "" {
            if buf.Len() > 0 {
                buf.WriteString("\n\n")
            }
            buf.WriteString(b.Text)
        }
    }
    return buf.String()
}
```

### Scheduler 初始化

`cmd/server/main.go` 中，当 `cfg.Tasks.SummarizeBackend` 非空时创建 `TaskSummarizer` 并注入 Scheduler：

```go
var taskSummarizer *summarize.TaskSummarizer
if cfg.Tasks.SummarizeBackend != "" {
    if cfg.Tasks.SummarizeBackend == "api" {
        // 复用 tts.api 配置段，创建 OpenAI/Anthropic 总结器
        apiSummarizer := createAPISummarizer(cfg)  // 抽取为函数，TTS 和 Task 共用
        taskSummarizer = summarize.NewTaskSummarizerFromSummarizer(apiSummarizer)
    } else {
        taskSummarizer, err = summarize.NewTaskSummarizer(cfg.Tasks.SummarizeBackend, cfg.Tasks.SummarizeModel)
    }
    if err != nil {
        log.Printf("Warning: failed to create task summarizer: %v", err)
    }
}
scheduler.SetTaskSummarizer(taskSummarizer)
```

`SetTaskSummarizer` 必须在 `scheduler.Start()` 之前调用，避免与早期任务执行产生竞争。

### `api` 后端的工厂函数

当 `summarize_backend` 为 `api` 时，不走 `AIBackendSummarizer`，而是根据 `tts.api.format` 创建 `OpenAISummarizer` 或 `AnthropicSummarizer`。这与 TTS 总结器的初始化逻辑一致。

新增 `NewTaskSummarizerFromSummarizer` 构造函数，接受已有的 `Summarizer` 接口，包装为 `TaskSummarizer`：

```go
func NewTaskSummarizerFromSummarizer(s Summarizer) *TaskSummarizer {
    return &TaskSummarizer{delegate: s}
}
```

此时 `TaskSummarizer.Summarize` 委托给 `delegate`，但跳过 `StripMarkdown` 后处理。对于 `api` 后端，`OpenAISummarizer`/`AnthropicSummarizer` 内部使用 `ttsPipeline`（会 StripMarkdown），这与任务总结"保留格式"的需求矛盾。

**解决方案**：`OpenAISummarizer`/`AnthropicSummarizer` 也需要支持"保留格式"模式。为此引入 `SummarizeOption`：

```go
type SummarizeOption struct {
    PreserveMarkdown bool  // 是否保留 Markdown 格式
}
```

`ttsPipeline` 在 `PreserveMarkdown=true` 时跳过 `StripMarkdown` 输入/输出处理。`TaskSummarizer` 传入 `PreserveMarkdown: true`。

这样所有后端都统一通过 `Summarizer` 接口 + `SummarizeOption` 工作，无需 `NewTaskSummarizerFromSummarizer` 特殊构造。

## 6. 前端变更

### TaskExecDetail.vue

新增「总结 / 原文」切换 Tab：

```
┌─────────────────────────────────┐
│  ← 返回    执行详情    🔊朗读   │  ← 现有头部
├─────────────────────────────────┤
│  [📌 总结]  [📄 原文]           │  ← 新增 Tab 切换（仅 summary 存在时显示）
├─────────────────────────────────┤
│                                 │
│  （总结/原始内容）               │  ← 复用 ChatMessageItem 渲染
│                                 │
└─────────────────────────────────┘
```

**切换逻辑**：

| 条件 | Tab 显示 | 默认选中 |
|------|----------|----------|
| `summary === null` | 不显示切换，直接显示原文 | — |
| `summary === ""` | 显示切换，但总结 Tab 提示"原文较短无需总结" | 原文 |
| `summary` 有内容 | 显示切换 | 总结 |

**总结内容渲染**：将 `summary` 文本在前端包装为 `{"blocks": [{"type": "text", "text": "<summary markdown>"}]}` JSON，通过 `chatRender.parseAssistantContent()` 解析后复用 `ChatMessageItem` 渲染。由于总结保留 Markdown 格式，渲染效果与原文一致。包装在前端完成，DB 中只存储纯 Markdown 文本。

### TaskHistoryTab.vue

执行列表的摘要显示优先级调整：

1. 有 `execution.summary` → StripMarkdown 后取前 100 字符作为摘要（列表预览需纯文本）
2. 无总结 → 现有 `extractSummary()` 逻辑（从 blocks 提取第一段文本）

### useTaskHistory.ts

`loadExecutions()` 解析结果新增 `summary` 字段传递。

## 7. 测试计划

### 后端

- `internal/summarize/` 包：
  - 现有总结器测试从 `speech` 迁移，确认通过
  - `TaskSummarizer` 单元测试：短文本返回空、正常总结、AI 调用失败返回错误
  - `StripMarkdown` 测试从 `speech` 迁移
  - `ttsPipeline` 测试：验证 `PreserveMarkdown` 选项行为

- `internal/service/` 包：
  - `UpdateExecutionSummary` 测试
  - 执行查询包含 summary 列

- `internal/handler/` 包：
  - `serveTaskExecutions` 返回 summary 字段

### 前端

- `TaskExecDetail.vue`：summary=null 不显示切换、summary 有内容默认显示总结、切换到原文
- `TaskHistoryTab.vue`：summary 优先用于摘要显示

## 8. 实现顺序

1. **包结构重构**：提取 `internal/summarize/`，迁移代码和引用，确保现有测试通过
2. **数据库 + 配置**：新增 `summary` 列、`TasksConfig`、`UpdateExecutionSummary`
3. **SummarizeOption + ttsPipeline 改造**：引入 `PreserveMarkdown` 选项，`ttsPipeline` 条件化 StripMarkdown
4. **TaskSummarizer**：新增 `task.go`，实现保留格式的总结
5. **Scheduler 集成**：`executeTask()` 中异步调用总结，main.go 初始化
6. **API 变更**：`serveTaskExecutions` 返回 summary
7. **前端**：TaskExecDetail 切换 Tab、TaskHistoryTab 摘要优先级
8. **测试**：各层测试补充
