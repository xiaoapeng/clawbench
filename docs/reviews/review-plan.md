# ClawBench 切片式代码 Review 计划

## 设计原则

1. **双维度切片**：流程切片（纵向端到端）× 领域切片（横向跨模块），形成二维矩阵
2. **单切片 × 单角度**：每次 review 只看一个切片的一个角度，深度最大化，反馈集中
3. **七个 review 角度**：架构、设计、复用度、安全性、逻辑正确性、性能、死代码 — 各自独立审视
4. **可执行**：每个切片×角度组合有明确的审查范围、输入文件、关注点清单和产出格式

---

## 一、切片定义

### 流程切片（F）— 纵向端到端数据流

| ID | 名称 | 端到端路径 | 涉及文件 |
|----|------|-----------|---------|
| F1 | Chat 消息流 | 用户输入 → handler 解析 → AI backend 执行 → SSE 事件流 → 前端渲染 | `handler/chat.go`, `handler/chat_stream.go`, `service/session_runtime.go`, `ai/cli_backend.go`, `ai/*_stream.go`, `ai/auto_resume.go`, `composables/useChatStream.ts`, `composables/useChatRender.ts`, `chat/ContentBlocks.vue` |
| F2 | 定时任务生命周期 | 创建任务 → cron 注册 → 触发执行 → AI 调用 → 结果持久化 → 前端展示 | `handler/scheduler.go`, `service/scheduler.go`, `cli/task.go`, `composables/useChatRender.ts`(blockTasks), `task/TaskFormDialog.vue`, `task/TaskExecDialog.vue` |
| F3 | 终端会话流 | WebSocket 连接 → PTY 创建 → I/O 双向泵 → 断连/重连 → idle 超时 → 关闭 | `handler/terminal.go`, `terminal/session.go`, `terminal/manager.go`, `terminal/buffer.go`, `composables/useTerminalSession.ts`, `terminal/TerminalPanel.vue` |
| F4 | 端口转发 + SSH 隧道 | SSH 连接 → direct-tcpip 通道 → ProxyRegistry 注册 → 健康检查 → 前端状态 | `ssh/server.go`, `service/proxy.go`, `handler/proxy_api.go`, `handler/ssh_info.go`, `composables/usePortForward.ts`, `proxy/ProxyPanel.vue` |
| F5 | RAG 索引 + 搜索 | Chat 终结 → 文本提取 → chunk → embed → DuckDB 存储 → 搜索 API → CLI 查询 | `rag/rag.go`, `rag/indexer.go`, `rag/chunker.go`, `rag/embedding.go`, `rag/store.go`, `rag/search.go`, `rag/cleanup.go`, `handler/rag_api.go`, `cli/rag.go` |
| F6 | 文件管理流 | 目录浏览 → 文件查看 → 行编辑 → 文件监听 → SSE 通知 → 前端刷新 | `handler/file.go`, `handler/file_ops.go`, `service/filewatch.go`, `handler/chat.go`(upload), `stores/app.ts`, `file/FileManager.vue`, `file/FileViewer.vue` |
| F7 | 启动 + 配置流 | CLI flag 解析 → config 加载 → 默认值填充 → 初始化序列 → 优雅关停 | `cmd/server/main.go`, `model/defaults.go`, `model/config.go`, `model/agent.go`, `middleware/auth.go` |

### 领域切片（D）— 横向跨模块关注点

| ID | 名称 | 覆盖范围 | 涉及文件 |
|----|------|---------|---------|
| D1 | AI Backend 抽象层 | 接口定义 → 工厂 → CLI 基类 → 7 种流解析器 → AutoResume 包装 → tool_result 累积 | `ai/interface.go`, `ai/factory.go`, `ai/cli_backend.go`, `ai/stream_parser.go`, `ai/*_stream.go`, `ai/auto_resume.go`, `ai/codex.go`, `ai/vecli.go`, `ai/qoder.go` |
| D2 | 认证与授权 | 密码生成 → session cookie → localhost 旁路 → SSH 密码认证 → 暴力破解防护 | `middleware/auth.go`, `model/defaults.go`(auto-password), `ssh/server.go`(authTracker), `handler/chat.go`(session validation) |
| D3 | 数据持久化层 | SQLite schema → CRUD → 软删除 → 级联清理 → DuckDB 向量存储 | `service/database.go`, `service/chat.go`, `rag/store.go`, `rag/cleanup.go`, `model/errors.go` |
| D4 | 错误处理 + i18n | AppError 构造 → 局部化错误消息 → HTTP 响应 → 前端错误展示 | `model/errors.go`, `handler/handler.go`(writeLocalizedError), `i18n/i18n.go`, `web/src/i18n/`, `handler/*.go`(error paths) |
| D5 | 并发原语 | goroutine 生命周期 → channel 模式 → mutex 纪律 → cancel context → sync.Map | `service/session_runtime.go`, `service/scheduler.go`, `service/proxy.go`, `terminal/session.go`, `terminal/manager.go`, `rag/indexer.go` |
| D6 | 前端状态管理 | reactive store → composable 单例 → drawer 互斥 → 跨组件通信 | `stores/app.ts`, `App.vue`(drawer states), `composables/useToast.ts`, `composables/useAutoSpeech.ts`, `composables/useQuickSend.ts`, `composables/useQuickCommands.ts` |
| D7 | 前端渲染管线 | SSE 事件 → block 合并 → Markdown → KaTeX/Mermaid → tool 卡片 → 定时任务卡片 | `composables/useChatRender.ts`, `composables/useMarkdownRenderer.ts`, `composables/useFilePathAnnotation.ts`, `utils/renderToolDetail.ts`, `chat/ContentBlocks.vue`, `utils/streamPerf.ts` |
| D8 | Agent 系统 | YAML 配置加载 → system prompt 构建 → placeholder 替换 → rules.md 注入 → 反递归 | `model/agent.go`, `model/defaults.go`(BuildCommonPrompt), `config/rules.md`, `config/agents/*.yaml` |

---

## 二、Review 角度定义

### A1 — 架构角度

**核心问题**：分层是否清晰？依赖方向是否合理？模块边界是否明确？

| 检查项 | 说明 |
|--------|------|
| 分层合规 | handler 是否只做 HTTP 适配？service 是否只含业务逻辑？model 是否无行为依赖？ |
| 依赖方向 | 是否存在 handler → ai 直接调用绕过 service？是否存在 model 依赖 service？ |
| 模块边界 | 包之间的接口是否最小化？是否有包级全局变量泄漏内部状态？ |
| SOLID 原则 | SRP（一个文件一个职责？）、OCP（扩展 vs 修改？）、DIP（依赖抽象而非实现？） |
| 循环依赖 | Go 包之间是否存在或接近循环引用？前端 composable 之间是否有双向依赖？ |

### A2 — 设计角度

**核心问题**：API 契约、数据模型、错误处理策略、并发模型的设计是否合理？

| 检查项 | 说明 |
|--------|------|
| API 契约 | REST 端点的 URL/方法/状态码是否一致？请求/响应结构是否统一？ |
| 数据模型 | struct 字段是否完整？零值语义是否清晰？JSON tag 是否一致？ |
| 错误策略 | 错误是否分级（用户可见 vs 内部）？是否可恢复？是否传播上下文？ |
| 并发模型 | goroutine 所有权是否清晰？channel 方向是否明确？锁粒度是否合理？ |
| 配置管理 | 零值默认是否安全？可选配置是否真的可选？配置变更是否需要重启？ |
| 扩展性 | 新增 backend/provider/命令是否需要改动多处？策略模式用得是否恰当？ |

### A3 — 复用度角度

**核心问题**：是否存在重复代码？可提取的公共逻辑？DRY 违反点？

| 检查项 | 说明 |
|--------|------|
| 重复逻辑 | 相似的函数/代码块出现 2+ 次？仅参数或名称不同？ |
| 可提取的公共逻辑 | 是否有"差不多但不完全一样"的逻辑可以用参数化抽象统一？ |
| 继承 vs 组合 | 是否用了继承/嵌入但实际只需组合？是否有 is-a vs has-a 的误用？ |
| 模板化机会 | 重复的 CRUD handler 是否可以模板化？重复的 composable 模式是否可以抽取？ |
| 跨层复用 | 前后端是否有相同逻辑各实现一遍（如 cron 解析、路径校验）？ |

### A4 — 安全性角度

**核心问题**：认证/授权、输入校验、注入风险、敏感数据泄露、竞态条件

| 检查项 | 说明 |
|--------|------|
| 认证/授权 | 所有 /api/ 路由是否有 Auth 中间件？localhost 旁路是否过度？ |
| 输入校验 | 用户输入是否在校验后才使用？路径遍历防护是否完整？ |
| 注入风险 | SQL 参数化？Shell 命令拼接？HTML 转义？JSON 注入？ |
| 敏感数据 | 密码/token 是否明文日志？auto-password 文件权限？session cookie 属性？ |
| 竞态条件 | TOCTOU（检查后使用）？并发写无锁？channel 溢出？ |
| 资源泄露 | goroutine 泄露？文件句柄未关？临时文件未清理？ |
| DoS 向量 | 无限重试？无超时？大文件无限制？连接数无上限？ |

### A5 — 逻辑正确性角度

**核心问题**：代码的行为是否符合其意图？边界条件是否正确？状态转换是否完备？这是最根本的审查角度——架构再优雅、代码再 DRY，逻辑错了就是错了。

| 检查项 | 说明 |
|--------|------|
| 不变量维护 | 每个数据结构是否有隐含的不变量？所有代码路径是否都维护了这些不变量？（如"session running 则必有 cancel func"） |
| 状态机完备 | 是否有隐式的状态机？状态转换是否覆盖所有组合？是否有不可达或遗漏的状态？ |
| 边界条件 | 空输入？单元素？最大值？并发边界？时间边界（超时/竞态窗口）？ |
| 错误路径正确性 | error 返回后调用方是否正确处理？defer 中的清理是否在错误路径也执行？ |
| 前后端契约一致性 | Go struct JSON tag 与 TS interface 是否对齐？字段可选性是否一致？枚举值是否一一对应？ |
| 原子性违反 | 多步操作是否需要事务/锁但未加？操作被中断后是否留下半完成状态？ |
| Off-by-one / 索引错误 | 分页？slice 切片？循环条件？游标定位？ |
| 条件逻辑反转 | `if err != nil` 写成 `if err == nil`？`!` 遗漏？条件分支顺序错误？ |
| 资源生命周期 | 创建 → 使用 → 清理 是否在所有路径上都完整？提前 return 是否跳过清理？ |
| 数据丢失风险 | 覆盖写入而非追加？channel 满时丢弃？数据库更新丢失（last-write-wins）？ |

### A6 — 性能角度

**核心问题**：热点路径的延迟是否可接受？是否存在不必要的 I/O、重复计算、无界内存增长？当负载增长时，哪里先断？

| 检查项 | 说明 |
|--------|------|
| I/O 模式 | 是否存在逐字节/逐行 flush（无 bufio）？是否有串行 I/O 可并行化？是否有同步 I/O 阻塞事件循环？ |
| 重复计算 | 是否对相同输入重复计算？（如每次渲染全量 re-sanitize/re-parse）是否有可利用的缓存未利用？ |
| 锁争用 | 是否持有锁做 I/O？是否逐元素加锁而非批量？读写锁 vs 互斥锁选择是否合理？ |
| 内存增长 | 缓存/缓冲区是否有大小上限？是否有无限增长的 Map/Slice？大对象是否及时释放？ |
| N+1 问题 | 循环内是否有独立可批量的 DB 查询/网络请求？前端列表渲染是否逐项触发 reflow？ |
| 启动延迟 | 初始化是否可延迟/并行？是否有启动时全量加载可按需加载的数据？ |
| 前端渲染 | 是否存在 debounce 之外的频繁 DOM 操作？虚拟列表是否覆盖长列表？CSS 动画是否触发 layout/paint？ |

### A7 — 死代码角度

**核心问题**：哪些代码永远不会被执行？哪些导出符号从未被引用？哪些配置分支不可能触发？

| 检查项 | 说明 |
|--------|------|
| 不可达分支 | if/switch 分支的条件是否永远为 true/false？错误路径是否可达？ |
| 未引用导出 | Go: 导出函数/类型/变量是否被其他包使用？TS: export 是否被 import？ |
| 遗留代码 | 注释掉的代码块？TODO/FIXME 标记？废弃的配置项？ |
| 冗余分支 | 配置项的某个值是否永远不会被设置？前端 i18n key 是否在代码中引用？ |
| 防御性过度 | 是否有对不可能发生的错误做了冗余处理？不必要的 nil 检查？ |

---

## 三、Review 矩阵

7 个流程切片 × 8 个领域切片 × 7 个角度 = **105 个独立 review 单元**

> ⚠️ 流程切片和领域切片有交叉 — 同一份代码可能出现在多个切片中，但从不同视角审查。交叉是故意的：同一代码在不同上下文下暴露不同问题。

### 3.1 流程切片 Review 矩阵

|  | A1 架构 | A2 设计 | A3 复用度 | A4 安全性 | A5 逻辑正确性 | A6 性能 | A7 死代码 |
|--|---------|---------|-----------|-----------|---------------|---------|-----------|
| **F1 Chat 消息流** | handler→service→ai 分层是否穿透？SSE handler 是否承担了过多职责？ | StreamEvent 类型系统是否完备？block coalescing 策略是否合理？ | 前后端 SSE 事件序列化是否重复？7 种 stream parser 的共同模式是否充分抽象？ | SSE 是否可被未认证客户端订阅？tool output 截断是否可绕过？ | block coalescing 是否会吞掉 tool_use 边界的内容？SSE 断连后重连是否丢失事件？cancel 后消息是否正确终结？tool_result 累积的截断是否丢失关键信息？ | SSE 每次 fmt.Fprintf+Flush = 1 次系统调用，无 bufio 包裹；Markdown 每次渲染对全量累积文本 re-sanitize+re-parse；onScrollBottom 在每个 content 事件都触发 DOM 操作未 debounce；StaticBlockCache 无大小上限 | 废弃的 SSE 事件类型？未被前端消费的 StreamEvent.Type？ |
| **F2 定时任务** | scheduler 是否既管 cron 又管执行？DB 操作是否耦合在 scheduler 中？ | cron 解析错误是否可提前暴露？执行超时是否有上限？ | task CRUD 在 handler/cli 两处实现是否重复？执行结果持久化与 chat 消息是否共用代码？ | 定时任务 prompt 是否可注入恶意 CLI 参数？CLAWBENCH_SCHEDULED 反递归是否可绕过？ | 任务执行中服务器重启，任务是否泄漏（running 但无 goroutine）？cron 时区是否正确？重复计数 off-by-one？agent-not-found 后暂停是否可恢复？ | executeTask 的 DB 操作是否在锁内做 I/O？多任务同时触发时是否有排队瓶颈？ | 废弃的 task 状态？repeat 模式枚举中是否有死分支？ |
| **F3 终端会话** | session/manager/buffer 三层职责是否清晰？handler 是否承担了 session 生命周期管理？ | RingBuffer 容量策略是否合理？idle timeout 与 reconnect 的交互设计？ | WebSocket 消息解析前后端是否重复？buffer replay 与 SSE replay 模式是否可统一？ | PTY 命令注入？cwd 路径遍历？session ID 碰撞？max_sessions 可否被绕过？ | reconnect 时旧 session 的 PTY 是否正确关闭？idle timer 在重连后是否正确重置？SIGTERM→SIGKILL 升级期间 PTY 输出是否丢失？buffer 满时是否丢行？ | RingBuffer 内存上限配置（max_buffer_mb 4MB）在高输出 PTY 下是否够用？readPTY 的 read 缓冲区大小？WebSocket 写入是否有背压？ | 废弃的 WebSocket 消息类型？未使用的 Session 字段？ |
| **F4 端口转发+SSH** | SSH server 是否与 proxy service 耦合过紧？handler 是否知道太多 SSH 内部细节？ | authTracker 的指数退避设计？端口健康检查策略（5s interval）是否合理？ | 端口检测逻辑（/proc/net/tcp, lsof, netstat）是否可统一？ | SSH 密码是否明文传输？host key 生成是否安全？端口白名单可否绕过？ | authTracker cleanup 后是否可能放过已解封的 IP？端口健康检查与注册/注销的竞态？SSH 通道断开后 ProxyRegistry 是否正确标记端口不活跃？ | checkAllPorts 逐端口加写锁（N 次锁循环）→ 应批量快照；DetectListeningPorts 串行 TLS 探测（每端口 1-3s）→ 可并行；resolveInodeToProcess 扫描 /proc/PID/fd/ 无缓存 | 废弃的 port protocol 类型？未使用的 SSH 配置项？ |
| **F5 RAG 索引+搜索** | rag 包内部层次（store/indexer/embedding/cleanup）是否合理？与 service 层的边界？ | chunk 策略（512 token 滑动窗口）是否最优？embedding 错误处理？ | indexer 和 cleanup 的 DB 操作与 service/database.go 是否重复？ | 搜索 API 是否需要 Auth？嵌入向量是否泄露对话内容？chunk 是否包含敏感信息？ | chunk 滑动窗口是否可能在 token 边界中间截断？embedding 失败后消息是否卡在 unindexed 状态？cleanup 级联顺序错误是否导致孤儿数据？DuckDB 与 SQLite 事务一致性？ | embedding 串行调用 Ollama（每消息 1 次 HTTP）→ 可批量；indexer 每 10s 轮询 DB → 可用 LISTEN/NOTIFY；DuckDB 向量搜索是否用 ANN 索引？ | 废弃的 RAG 配置项？未使用的 DuckDB 表/列？ |
| **F6 文件管理** | file handler 是否混了浏览/编辑/上传三种职责？filewatch 是否应独立为 service？ | 文件编辑的并发冲突策略？上传大小限制的可配置性？ | 文件操作（rename/copy/move/delete）是否共享校验逻辑？前后端路径处理是否重复？ | 路径遍历防护是否覆盖所有 file API？上传文件名注入？符号链接穿越？ | 行编辑的 old_string 匹配是否可能在文件被外部修改后误匹配？文件监听是否漏掉快速连续修改？上传并发时是否覆盖同名文件？ | 大文件读取是否流式？目录列表是否分页？文件监听 SSE 对高频修改是否产生事件风暴？ | 废弃的文件操作 API？未使用的文件类型判断？ |
| **F7 启动+配置** | main.go 是否承担了过多初始化编排？各子系统初始化顺序是否隐式依赖？ | ApplyDefaults 的 bool 零值问题解决方案（ParsePresenceMap）是否优雅？ | TTS provider 初始化的 switch-case 是否可策略模式替代？配置搜索路径逻辑是否重复？ | auto-password 文件权限？密码 salt 是否硬编码？.env 文件是否可被远程读取？ | 初始化顺序错误（如 LoadAgents 前使用 model.Agents）？优雅关停时 defer 顺序是否与初始化相反？配置文件部分解析（YAML 语法错）是否导致半初始化状态？ | TTS provider 初始化是否可延迟到首次使用？config 文件搜索 4 层 Stat 是否可优化？各子系统初始化是否可并行？ | 废弃的配置项？遗留的配置路径搜索？未使用的 CLI flag？ |

### 3.2 领域切片 Review 矩阵

|  | A1 架构 | A2 设计 | A3 复用度 | A4 安全性 | A5 逻辑正确性 | A6 性能 | A7 死代码 |
|--|---------|---------|-----------|-----------|---------------|---------|-----------|
| **D1 AI Backend 抽象** | AIBackend 接口是否最小？CLIBackend 嵌入 vs 组合？AutoResumeBackend 透明包装是否 LSP 替换？ | LineParser 协议是否稳定？StreamParser 的 accumulator 设计？tool_result 累积 vs 替换语义？ | 7 种 stream parser 的共同模式是否充分提取？codex_stream.go 638 行是否可拆分共享？ | CLI 参数拼接是否有命令注入？自定义 command 路径是否可注入？ | AutoResume 检测 ExitPlanMode 后的 cancel+resume 时序：是否可能丢失已产生的事件？tool_result 累积的边界——同一 tool_use ID 的 start 和 result 事件是否总是成对？VeCLI 的 post-stream session-summary 解析：进程异常退出时是否跳过？Codex 的 resume 语义是否与其他 backend 一致？ | StreamParser 的 accumulator 是否有大小上限？scanner buffer 溢出后的状态是否损坏？7 种 parser 是否有不必要的字符串拷贝？ | 废弃的 parser 分支？未处理的 JSON 字段？ |
| **D2 认证与授权** | Auth 中间件是否是唯一入口？localhost 旁路是否应抽为独立策略？ | 三层认证（无密码/localhost/cookie）的设计权衡？SSH authTracker 是否应复用 HTTP auth 框架？ | localhost 检测逻辑是否分散在多处？cookie 验证是否重复？ | session cookie 是否 httpOnly/secure/SameSite？CSRF 防护？密码 hash 是否可被时序攻击？ | 密码为空时跳过认证的判断条件：是否与 auto-password 生成有竞态？localhost 检测（r.RemoteAddr）在反向代理后是否误判？cookie 过期后是否正确拒绝？ | SHA256 密码哈希在每次请求时计算——可缓存结果？authTracker cleanup 是否在热路径上？ | 废弃的 auth 路径？未使用的 auth 配置？ |
| **D3 数据持久化** | service/database.go 是否同时承担 schema 和 query？是否应分出 repository 层？ | 软删除 + RAG 查询的 filter 策略是否一致？级联删除的顺序保证？ | CRUD 操作是否有重复的查询构建？chat 和 scheduler 的 DB 操作是否可共享基础方法？ | SQL 注入？事务隔离级别？备份策略？ | 软删除后的 RAG 查询：GetMessageByID 跳过 deleted=0 filter，但 search API 是否也正确处理？级联删除的顺序错误是否导致孤儿记录？chat_history.indexed 标记是否与 DuckDB 实际索引状态一致？ | SQLite WAL 模式下的并发写瓶颈？是否有缺失索引导致全表扫描？DuckDB 与 SQLite 双 DB 的连接池开销？大消息的 BLOB 读写是否流式？ | 废弃的表/列？未使用的索引？ |
| **D4 错误处理+i18n** | AppError 是否贯穿全栈？前端是否有对应的错误类型系统？ | i18n key 的命名约定？缺失 key 的 fallback 策略？错误上下文是否足够调试？ | writeLocalizedError/writeLocalizedErrorf/writeJSON 是否可统一？前端错误展示是否重复？ | 错误消息是否泄露内部信息（文件路径、堆栈）？ | AppError 的 Code 与 HTTP 状态码是否总是对应？i18n key 缺失时 fallback 到英文还是 key 本身？前端是否正确处理所有后端错误码？ | i18n lookup 在每个错误响应路径上的开销？locale 包的初始化开销？ | 废弃的 i18n key？未使用的 error constructor？ |
| **D5 并发原语** | sync.Mutex vs sync.Map 的选择标准？包级全局变量的并发安全？ | session_runtime 的四组 sync.Map 是否可封装为 struct？cancel reason 的设计是否完备？ | goroutine 启动/停止模式是否可统一（defer + channel + context）？ | 数据竞争？goroutine 泄露？close channel 后写 panic？ | TrySetSessionRunning 的 CAS 语义：并发 TrySet + Set(false) 是否可能让两个 goroutine 都认为 session 属于自己？sessionStreams 的 LoadAndDelete + close(ch)：close 后是否有 goroutine 仍尝试写入？scheduler runningExecutions 的 sync.Map：LoadAndDelete 和 Store 是否原子？ | sync.Map 在高并发读下的 cache line 争用？session channel buffer=64 是否最优？mutex 持有时间是否过长？ | 未使用的 mutex 字段？冗余的 lock/unlock？ |
| **D6 前端状态管理** | reactive store vs composable singleton 的选择标准？App.vue 是否成为 God Object？ | drawer 互斥的状态机设计？跨组件事件传递（emit vs store vs provide/inject）？ | drawer 开关逻辑是否 N² 互斥？toast/notification 是否重复实现？ | XSS via reactive state？store 中的敏感数据？ | drawer 互斥：打开 A 关闭 B，如果 B 的关闭动画回调又触发了 A 的关闭，是否死锁？session 切换的 sequence counter：快速切换时旧请求的回调是否可能覆盖新 session 的数据？store 的 reactive 替换（整个对象替换 vs 逐字段更新）是否导致丢失监听？ | reactive() 深层嵌套对象的变更检测开销？watch 的深度（deep: true）使用是否必要？全局轮询（2s/15s interval）的 CPU 唤醒？ | 废弃的 store 字段？未使用的 composable export？ |
| **D7 前端渲染管线** | useChatRender 是否职责过多（渲染 + 任务卡片 + 问答解析）？静态缓存设计？ | 两阶段渲染（streaming vs finalized）的设计权衡？block 合并的边界条件？ | Markdown 渲染是否与 useMarkdownRenderer 充分解耦？tool detail 渲染是否可复用？ | DOMPurify 配置是否足够？KaTeX/Mermaid 注入？Markdown 中的 script 标签？ | block coalescing：tool_use 事件到达时，当前 text block 是否正确关闭？tool_use 30s timeout 安全网：超时后后续的 tool_result 事件是否被忽略？scheduled-task tag 提取：嵌套的 HTML 标签是否导致提取失败？KaTeX 渲染失败是否破坏整个 block？ | 每次渲染全量 DOMPurify.sanitize + marked.parse 无增量；StaticBlockCache makeKey 截断哈希碰撞风险；缓存 Map 无大小上限内存泄漏；debouncedRender 80ms 外的 onScrollBottom 未 debounce | 废弃的 block 类型？未使用的 render 函数？ |
| **D8 Agent 系统** | LoadAgents 是否应属于 service 而非 model？rules.md 注入是否应独立于模型层？ | BuildCommonPrompt 的 placeholder 替换是否可扩展？anti-recursion 的 SCHEDULED 标记是否健壮？ | agent YAML 解析与 config YAML 解析是否共享？system prompt 构建是否可组合？ | rules.md 注入是否可被 agent YAML 覆盖绕过？自定义 command 是否可执行任意程序？ | BuildCommonPrompt(true) 剥离 SCHEDULED 段落：如果 rules.md 的标记不完整（缺 END），是否截断整个 prompt？{{PROJECT_PATH}} 替换是否处理路径中的特殊字符（如含 `}}`）？AgentID 为空时的 fallback 逻辑是否在所有入口一致？ | LoadAgents 启动时读取整个 agents 目录——agent 数量增长后是否变慢？BuildCommonPrompt 每次请求调用——可缓存？strings.Replace 的多次遍历可优化？ | 废弃的 placeholder？未使用的 agent 配置字段？ |

---

## 四、每次 Review 的执行流程

每个切片 × 角度组合，按以下步骤执行：

### Step 1: 确定范围

- 列出该切片涉及的**所有文件**
- 用 `git ls-files` + 手动标注确认文件列表
- 排除与该角度无关的代码段（如架构角度不需要逐行看实现细节）

### Step 2: 静态扫描

根据角度选择扫描工具：

| 角度 | 扫描方法 |
|------|---------|
| A1 架构 | 画出包/模块依赖图（`go vet`, `digraph`, 或手动），标注依赖方向违规 |
| A2 设计 | 列出所有公开 API 签名，检查契约一致性；列出所有 struct 定义，检查字段零值语义 |
| A3 复用度 | `dupl`（Go 重复代码检测）+ 手动比对相似文件；前端用 `jscpd` |
| A4 安全性 | `gosec`（Go 安全扫描）+ 手动审计输入校验路径；前端检查 DOMPurify 配置 |
| A5 逻辑正确性 | `go test -race ./...` + 关键路径的手动推演 + 边界条件清单 + 前后端契约 diff |
| A6 性能 | `go test -bench ./...` + `pprof` CPU/Memory profile + 前端 Chrome DevTools Performance + 手动热点分析 |
| A7 死代码 | `deadcode`（Go 死代码检测）+ `go vet` + 前端 `ts-prune`/`ts-unused-exports` |

### Step 3: 深度阅读

- **按数据流方向**阅读代码（请求 → 响应，写入 → 读取，启动 → 关闭）
- 每个函数标注：职责、调用者、被调用者、错误路径
- 特别关注：分支覆盖、边界条件、空值处理

### Step 4: 产出 Review 报告

每个切片 × 角度的 review 报告格式：

```markdown
# Review: [切片ID] [切片名称] — [角度ID] [角度名称]

## 审查范围
- 文件列表（带行数）
- 审查日期

## 发现项（按严重程度排序）

### 🔴 Critical — 必须修复
| # | 位置 | 问题 | 建议修复 |
|---|------|------|---------|

### 🟡 Warning — 建议修复
| # | 位置 | 问题 | 建议修复 |
|---|------|------|---------|

### 🔵 Info — 可改进
| # | 位置 | 问题 | 建议 |
|---|------|------|------|

### ✅ Good — 值得保持的模式
| # | 位置 | 模式描述 |
|---|------|---------|

## 量化指标
- 审查代码行数：
- 发现项数量：🔴 _ / 🟡 _ / 🔵 _ / ✅ _
- 关键指标：[角度相关的量化，如架构角度的循环依赖数、复用角度的重复代码行数、安全角度的漏洞数]

## 行动项
- [ ] ...
```

---

## 五、执行节奏建议

### 5.1 优先级排序

**P0 — 先做（逻辑正确性 + 安全性，最高风险）：**
1. F1 × A5（Chat 逻辑正确性）— 最核心的用户交互路径，block coalescing/cancel/reconnect 等逻辑易出错
2. D5 × A5（并发逻辑正确性）— 竞态条件是最难发现、最危险的 bug
3. D1 × A5（AI Backend 逻辑正确性）— 7 种 parser 的状态机正确性、AutoResume 时序
4. F1 × A4（Chat 安全性）— 最核心路径的输入校验
5. F4 × A4（SSH 安全性）— 暴露在网络边界
6. D2 × A4（认证安全性）— 整个系统的门面

**P1 — 再做（架构 + 设计 + 性能改进）：**
7. D1 × A1（AI Backend 架构）— 最复杂的抽象层
8. F1 × A1（Chat 架构）— 核心流程的分层
9. D5 × A2（并发设计）— 设计缺陷比实现 bug 更难修
10. F7 × A2（启动设计）— 初始化复杂度
11. F3 × A5（终端逻辑正确性）— PTY 生命周期管理
12. D7 × A5（前端渲染逻辑正确性）— block 合并/Markdown/任务卡片
13. F1 × A6（Chat 性能）— SSE 渲染管线是用户体验的核心
14. D7 × A6（前端渲染性能）— Markdown 重解析是最大前端瓶颈

**P2 — 然后（代码质量 + 债务清理 + 性能扫尾）：**
15. 全部 A7（死代码）— 快速扫描，高 ROI
16. 全部 A3（复用度）— 识别重复，减少维护面
17. D4 × A2（错误处理设计）— 影响用户体验
18. D6 × A1（前端状态架构）— 复杂度热点
19. 其余 A5（逻辑正确性）— 逐片补齐
20. 其余 A6（性能）— 按热点优先级补齐

**P3 — 最后（润色 + 模式确认）：**
18. 剩余的组合 — 按需挑选

### 5.2 执行节奏

- 每次对话做 **1 个切片 × 1 个角度**
- 预计每次 review 需要 **1-2 轮对话**（Step 1-2 扫描 + Step 3-4 深度阅读和报告）
- P0 6 项 → P1 8 项 → P2 6 项 = 20 次核心 review
- 其余 85 项按需补充，部分可能在核心 review 中已覆盖

### 5.3 防重复机制

由于切片有交叉，同一份代码可能被审查多次。为避免重复劳动：

1. **维护已审查文件清单**：每个 review 报告记录已深度阅读的文件+行范围
2. **角度隔离**：同一代码在不同角度下关注点不同（如 handler/chat.go 在 A1 看分层、在 A4 看输入校验），天然不重复
3. **交叉引用**：如果某发现项已在之前的 review 中报告过，标注 `[Previously: F1×A4 #3]` 而不重复分析

---

## 六、角度专属方法论

### 6.1 A1 架构角度 — 方法论

```
1. 画依赖图
   - Go: `go list -f '{{.ImportPath}}: {{join .Imports ", "}}' ./internal/...`
   - 前端: 分析 import 语句，画 composable 依赖图

2. 检查分层违规
   - handler → model 直接调用？（应通过 service）
   - service → handler 反向依赖？
   - model 包含业务逻辑？（应只含数据结构）

3. 检查接口隔离
   - AIBackend 接口方法数 > 5？
   - 接口是否在消费方定义？（Go 惯例：消费方定义接口）

4. 检查 God Object
   - 单文件 > 500 行的职责分析
   - 单 struct > 10 个字段的角色分析
```

### 6.2 A2 设计角度 — 方法论

```
1. API 契约审查
   - 列出所有 HTTP 端点，检查 URL/方法/状态码一致性
   - 列出所有 WebSocket 消息类型，检查协议对称性
   - 检查 Go struct 的 JSON tag 与前端 TypeScript 接口的对应

2. 数据模型审查
   - 每个零值字段的语义：是"未设置"还是"空值"？
   - 可选字段：用指针？用 omitEmpty？用辅助 bool？
   - 时间字段：精度？时区？格式？

3. 并发模型审查
   - 每个 goroutine：谁启动？谁停止？停止保证？
   - 每个 channel：方向？缓冲？满/空行为？
   - 每个 mutex：粒度？持有时间？死锁风险？

4. 配置设计审查
   - 每个配置项的零值默认是否安全？
   - 配置变更是否需要重启？
   - 配置验证是否在启动时完成？
```

### 6.3 A3 复用度角度 — 方法论

```
1. 自动化扫描
   - Go: `dupl -t 50 ./internal/...`（阈值 50 token）
   - 前端: `npx jscpd web/src/`

2. 人工比对
   - 识别"结构性重复"：不同文件但相同控制流，仅参数不同
   - 识别"概念性重复"：不同语言实现相同逻辑（前后端路径校验、cron 解析）

3. 模式提取机会
   - CRUD handler 模式：是否可泛化为 registerCRUD(pattern, service)?
   - Composable 模式：是否可提取 useAsyncAction/usePaginatedList?
   - 初始化模式：是否可统一为 registry + factory?

4. 误判排除
   - 有些重复是有意的（测试数据、i18n）
   - 有些抽象会增加复杂度（简单场景不必泛化）
```

### 6.4 A4 安全性角度 — 方法论

```
1. 威胁建模（按切片）
   - 画出数据流图（DFD）
   - 标注信任边界（网络 → 服务器 → 文件系统 → 子进程）
   - 每个信任边界的输入校验检查

2. 攻击面枚举
   - 所有 HTTP 端点 → 注入、XSS、CSRF、IDOR
   - 所有文件操作 → 路径遍历、符号链接
   - 所有子进程调用 → 命令注入
   - 所有 SQL 操作 → 参数化检查
   - 所有日志输出 → 敏感数据泄露

3. 并发安全
   - 每个共享状态的并发访问路径
   - TOCTOU 场景：检查→操作之间的窗口
   - goroutine 泄露路径

4. 资源限制
   - 每个无上限的资源（内存、文件数、连接数、goroutine 数）
   - 每个无超时的操作（HTTP、数据库、子进程）
```

### 6.5 A5 逻辑正确性角度 — 方法论

```
1. 不变量挖掘
   - 对每个核心数据结构，写出其隐含不变量
     例：session_runtime 的不变量——
     - "running=true ⟹ cancel func 存在"
     - "stream channel 存在 ⟹ session 曾 running"
     - "cancel reason 被读取后必被清除"
   - 逐一检查每条不变量在所有代码路径上是否维护

2. 状态机提取与遍历
   - 对隐式状态机，画出状态转换图
     例：Chat session 状态——
     idle → running → (done|cancelled|error) → idle
   - 检查每个 (状态, 事件) 对是否有明确定义的行为
   - 特别关注：异常事件到达时当前状态的处理

3. 边界条件清单（逐函数）
   - 输入边界：空字符串、空 slice、0 值、最大值
   - 时间边界：超时窗口内完成 vs 超时、竞态窗口
   - 并发边界：同时到达的两个相同事件
   - 数值边界：off-by-one（分页、slice 切片、计数）

4. 错误路径追踪
   - 对每个可能返回 error 的函数，追踪调用方的处理
   - 检查 defer 清理是否在 error 路径执行
   - 检查 error 被忽略（`_ = foo()`）的地方是否有正当理由

5. 前后端契约验证
   - 提取 Go struct 的 JSON tag → 生成字段清单
   - 提取 TS interface 的属性 → 生成字段清单
   - 做 diff：新增字段是否一端遗漏？可选性是否对齐？
   - 枚举值：Go 的 const vs TS 的 string literal union

6. 原子性审查
   - 多步操作：标记哪些需要原子性但未保证
   - 中断恢复：操作被取消/中断后，是否有半完成状态？
   - 事务缺失：SQLite 操作是否缺少事务包裹？

7. 对比测试与实现
   - 对照现有测试用例，找出测试未覆盖的逻辑分支
   - 对照 CODEBUDDY.md 描述的行为，找出文档与实现的不一致
```

### 6.6 A6 性能角度 — 方法论

```
1. 热点路径识别
   - 后端：SSE streaming、proxy health check、RAG indexing、DB query
   - 前端：Chat Markdown 渲染、终端输出泵、文件列表渲染
   - 对每条热点路径，画出调用栈并标注每步的延迟预期

2. I/O 模式审计
   - 逐 syscall 审计：是否可合并小写？是否可加 bufio？
   - 串行 vs 并行：TLS 探测、/proc 扫描、embedding 调用是否可并发？
   - 阻塞点：同步 I/O 是否阻塞事件循环/goroutine？

3. 内存增长分析
   - 列出所有无上限的 Map/Slice/Cache
   - 估算长会话（1000+ 消息）的内存占用
   - 检查缓存失效策略：是否有 TTL？是否有 LRU？是否有大小上限？

4. 锁争用分析
   - 画出每个 mutex 的持有时间线
   - 识别"持锁做 I/O"的反模式
   - 评估 RWMutex 替代 Mutex 的收益场景
   - 检查 sync.Map 在写多读少场景是否反而更慢

5. 计算冗余检测
   - 前端：相同输入的重复 render/parse/sanitize
   - 后端：相同查询的重复 DB call（如轮询 vs 推送）
   - 评估增量计算 vs 全量重算的 trade-off

6. 基准测试
   - Go: `go test -bench` 对热点函数写 benchmark
   - 前端: Chrome DevTools Performance 录制关键操作
   - 量化：当前延迟 → 目标延迟 → 瓶颈定位

7. 负载推演
   - N 个并发 AI session 时的资源消耗（goroutine、内存、DB 连接）
   - M 个注册端口的 health check 开销
   - 长时间运行（24h+）的内存趋势
```

### 6.7 A7 死代码角度 — 方法论

```
1. 自动化扫描
   - Go: `deadcode -test ./...`
   - Go: `go vet ./...`（检测不可达代码）
   - 前端: `npx ts-prune`（未使用的 export）
   - 前端: `npx ts-unused-exports`

2. 手动审计
   - switch/case 中的不可达分支
   - error 返回值被忽略但调用方从未检查的情况
   - 配置项中从未被代码读取的字段
   - i18n key 在 en.ts/zh.ts 中定义但从未在代码中引用
   - CSS 类名定义但从未在模板中使用

3. 防误判
   - 接口实现：Go 中实现接口的方法即使未直接调用也不是死代码
   - 测试辅助：测试中使用的工具函数
   - 扩展点：预留的但尚未使用的策略/插件
   - 外部调用：被前端调用的 API handler 即使无内部引用也不是死代码

4. 量化
   - 每个发现标注预估可删除行数
   - 汇总：总死代码行数 / 总代码行数 = 死代码率
```

---

## 七、汇总追踪

完成 review 后，在此记录进度：

| 切片 | A1 架构 | A2 设计 | A3 复用度 | A4 安全性 | A5 逻辑正确性 | A6 性能 | A7 死代码 |
|------|---------|---------|-----------|-----------|---------------|---------|-----------|
| F1 Chat 消息流 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| F2 定时任务 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| F3 终端会话 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| F4 端口转发+SSH | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| F5 RAG 索引+搜索 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| F6 文件管理 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| F7 启动+配置 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D1 AI Backend 抽象 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D2 认证与授权 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D3 数据持久化 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D4 错误处理+i18n | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D5 并发原语 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D6 前端状态管理 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D7 前端渲染管线 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| D8 Agent 系统 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

完成标记：⬜ 未开始 → 🔄 进行中 → ✅ 已完成
