# RAG 历史记忆系统设计

> 日期：2026-07-17
> 状态：已确认，待实施

## 概述

将 ClawBench 所有聊天历史构建为 RAG（Retrieval-Augmented Generation）系统，基于 DuckDB 做向量存储，使 AI 能在任意会话中自主检索历史对话和分析流程。同时支持人工通过聊天语义搜索历史。

## 核心架构

### 双场景

- **AI 自动召回**：AI 通过 system prompt 注入的技能描述，自主判断何时调用 RAG API 搜索历史
- **人工语义搜索**：用户在聊天中直接问 AI，AI 自主搜索并返回结果，无需独立搜索 UI

### 数据流

```
用户发消息 → AI 判断需要查历史 → curl /api/rag/search
                                          ↓
                                    Ollama embed query
                                          ↓
                                    DuckDB 向量搜索
                                          ↓
                                    返回匹配片段 → AI 参考回答

助手消息 Finalize → chat_history.indexed=0
                          ↓ (每10s轮询)
                    RAG Worker 扫描 → 提取 text blocks
                          ↓
                    512 token 滑窗切分 (重叠64 token)
                          ↓
                    Ollama /api/embeddings → 向量
                          ↓
                    写入 DuckDB chat_chunks → indexed=1
```

## 关键决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 场景 | AI 召回 + 人工搜索 | 同一向量库底座服务两个入口 |
| Embedding 模型 | BGE-M3 (Ollama 本地) | 中文强、~2GB 内存、已有 Ollama 基础设施 |
| 分块策略 | 语义段级：提取 text blocks，512 token 滑窗切分 | 召回质量最高；排除 tool_use 和 thinking |
| 索引触发 | 异步增量（不回填历史） | 简单直接，YAGNI |
| DuckDB 表结构 | 单表 chat_chunks | 列存查询不碰 embedding 列，无性能问题 |
| 向量检索 | DuckDB 暴力余弦搜索 | 万条级 <50ms，预留 HNSW 升级路径 |
| AI 召回方式 | System prompt 注入技能描述 + API 定义，AI 自主 curl 调用 | CLI 工具自带 tool_use 能力，告诉接口即可 |
| 技能注入 | 全局配置 + 运行时拼接 config/rag_prompt.md | 可开关，不改 agent prompt 文件 |
| DuckDB 文件位置 | `.clawbench/rag.duckdb` | 符合绿色部署，删 .clawbench/ 即清空 |
| API 鉴权 | 免鉴权，仅 localhost | AI 跑在同一进程，天然可信 |
| Ollama 不可用 | 静默降级 + 自动恢复 | Worker 持续探测，恢复后自动补索引 |
| 消息生命周期 | 不删除 | 无需考虑消息清理场景 |

## DuckDB 表结构

```sql
CREATE TABLE chat_chunks (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL,
    embedding FLOAT[1024],
    project_path TEXT NOT NULL,
    backend TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE INDEX idx_chunks_session ON chat_chunks(session_id);
CREATE INDEX idx_chunks_project ON chat_chunks(project_path);
CREATE INDEX idx_chunks_created ON chat_chunks(created_at);
CREATE INDEX idx_chunks_message ON chat_chunks(message_id);
```

- `chunk_index`：同一消息切分后的序号
- `embedding` 可为 NULL：Ollama 失败时先存文本，后续 worker 补向量
- `session_title` 不存：搜索时 JOIN `chat_sessions` 获取

## RAG API

```
GET /api/rag/search?q=<查询文本>&limit=5&project=<path>&backend=<name>&session_id=<id>&from=<datetime>&to=<datetime>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `q` | ✅ | 自然语言查询，后端做 embedding 后向量搜索 |
| `limit` | ❌ | 返回条数，默认 5 |
| `project` | ❌ | 按项目路径过滤 |
| `backend` | ❌ | 按后端过滤（claude/codebuddy/...） |
| `session_id` | ❌ | 限定在某个会话内搜索 |
| `from` | ❌ | 起始时间 |
| `to` | ❌ | 结束时间 |

**返回格式：**

```json
{
  "results": [
    {
      "chunk_text": "SSH 隧道保活的关键是用 WifiLock...",
      "score": 0.87,
      "session_id": "abc-123",
      "session_title": "SSH Tunnel Keep-Alive",
      "message_id": 456,
      "role": "assistant",
      "project_path": "/home/user/projects/clawbench",
      "backend": "codebuddy",
      "created_at": "2026-05-22T10:30:00Z"
    }
  ],
  "total": 12
}
```

**鉴权：** 免鉴权，仅 localhost 可达。

## System Prompt 技能注入

文件：`config/rag_prompt.md`，与 `agent_common_prompt.md` 同级。

运行时加载，端口号用 `{{PORT}}` 占位符动态替换。当 `rag.enabled: true` 时拼接到 agent prompt。

## 索引 Worker

```
RAG Indexer (goroutine, 启动时由 main.go 拉起):

1. 每 10s 触发一轮 (可配置 rag.poll_interval)
2. 探测 Ollama: GET http://localhost:11434/api/tags
   - 失败 → 跳过本轮，下轮自动重试
   - 成功且 bge-m3 不在列表 → 日志警告一次，跳过
3. 查询 SQLite: SELECT id, content, role, session_id, project_path, backend, created_at
   FROM chat_history WHERE indexed = 0 AND streaming = 0 LIMIT 10
4. 逐条处理：
   a. role=user → chunk_text = content, 直接切分
   b. role=assistant → 解析 JSON，提取 type=text 的 blocks，排除 thinking/tool_use
   c. 对每个文本段按 512 token 滑窗切分 (重叠 64 token)
   d. 批量调用 Ollama /api/embeddings 获取向量
   e. 批量写入 DuckDB chat_chunks
   f. 更新 SQLite: chat_history.indexed = 1
5. 未索引消息为空 → 休眠等待下轮
```

**SQLite 改动：** `chat_history` 加一列 `indexed INTEGER NOT NULL DEFAULT 0`

## Go 包结构

```
internal/rag/
├── rag.go            — RAG 服务入口：Init(), StartIndexer(), Shutdown()
├── indexer.go        — 轮询 worker 逻辑
├── embedding.go      — Ollama embedding 客户端
├── chunker.go        — 文本切分（512 token 滑窗）
├── search.go         — 向量搜索 + 元数据过滤
├── store.go          — DuckDB 连接管理、建表、CRUD
└── rag_test.go       — 测试

internal/handler/
└── rag.go            — GET /api/rag/search handler

config/
└── rag_prompt.md     — RAG 技能提示词模板
```

**新增依赖：** `github.com/marcboeker/go-duckdb`（Go DuckDB 驱动，CGO 绑定）

**Ollama 调用：** 复用 `internal/speech/ollama_summarizer.go` 的 HTTP 客户端模式

## 和现有代码的集成点

| 改动点 | 文件 | 内容 |
|--------|------|------|
| SQLite schema 迁移 | `internal/service/database.go` | `chat_history` 加 `indexed` 列 |
| Finalize 时标记 | `internal/service/chat.go` | `FinalizeStreamingMessage` 时设置 `indexed=0` |
| API 路由注册 | `internal/handler/handler.go` | `/api/rag/search` 免鉴权路由组 |
| Prompt 拼接 | `internal/service/` prompt 构造处 | 加载 `config/rag_prompt.md`，替换 `{{PORT}}` |
| 启动 & 关闭 | `cmd/server/main.go` | `rag.Init()` + `rag.StartIndexer()` + graceful shutdown |
| 配置模型 | `internal/model/` | 新增 RAG 配置结构体 |

## 配置项

```yaml
rag:
  enabled: false                    # 总开关，默认关闭
  ollama_base_url: "http://localhost:11434"
  ollama_model: "bge-m3"
  chunk_size: 512
  chunk_overlap: 64
  poll_interval: "10s"
  batch_size: 10
  search_limit: 5
```

**Go 配置结构体：**

```go
type RAGConfig struct {
    Enabled       bool   `yaml:"enabled"`
    OllamaBaseURL string `yaml:"ollama_base_url"`
    OllamaModel   string `yaml:"ollama_model"`
    ChunkSize     int    `yaml:"chunk_size"`
    ChunkOverlap  int    `yaml:"chunk_overlap"`
    PollInterval  string `yaml:"poll_interval"`
    BatchSize     int    `yaml:"batch_size"`
    SearchLimit   int    `yaml:"search_limit"`
}
```

默认值在 `internal/model/defaults.go` 的 `ApplyDefaults()` 中填充。

## 边界情况 & 错误处理

| 场景 | 处理方式 |
|------|----------|
| DuckDB 文件损坏 | 删除 `.clawbench/rag.duckdb`，重建空表，日志警告。indexed=0 的消息自动重新索引 |
| Ollama 长期不可用 | Worker 静默跳过，不影响聊天。恢复后自动补 |
| 单条消息过大（>50KB content） | 限流：单条消息最多产出 50 个 chunk，超出截断并日志警告 |
| Embedding 维度不匹配（模型切换后） | 启动时检测已有向量维度 vs 配置维度，不一致则清空表重建，日志警告 |
| 并发写入 DuckDB | 单写者模式：所有写操作走 indexer goroutine，搜索走只读连接 |
| 服务器 graceful shutdown | `rag.Shutdown()` 通知 worker 停止，等当前 batch 完成，关闭 DuckDB 连接 |

## MVP 交付范围

### ✅ Phase 1 包含

- `internal/rag/` 完整包（store, indexer, chunker, embedding, search）
- `internal/handler/rag.go` — `/api/rag/search` 免鉴权 API
- `config/rag_prompt.md` — 技能提示词模板
- SQLite `chat_history` 加 `indexed` 列 + 迁移
- `chat_history.indexed=0` 标记在 Finalize 时
- DuckDB `.clawbench/rag.duckdb` 单表 `chat_chunks`
- 轮询 worker：探测 Ollama → 扫描未索引 → 提取 text blocks → 512 token 滑窗切分 → embedding → 写入
- Ollama 不可用时静默降级 + 自动恢复
- System prompt 运行时拼接 `rag_prompt.md`
- `config.yaml` `rag` 配置段 + ApplyDefaults
- 启动/关闭集成到 `main.go`

### ❌ Phase 1 不包含

- 历史数据全量回填
- 独立搜索 UI
- HNSW/ANN 索引
- 多模型切换 UI
- 跨项目搜索优化

## 实现顺序

1. 配置模型 + 默认值
2. DuckDB store（建表、CRUD）
3. Chunker（text 提取 + 滑窗切分）
4. Embedding 客户端（Ollama /api/embeddings）
5. Indexer worker（轮询 + 编排）
6. Search（向量搜索 + 元数据过滤）
7. API handler + 路由注册
8. SQLite 迁移（indexed 列）+ Finalize 标记
9. Prompt 拼接集成
10. 启动/关闭集成
