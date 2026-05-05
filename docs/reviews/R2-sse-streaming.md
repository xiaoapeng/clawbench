# R2: SSE 流式传输 Review

> 日期: 2026-05-27
> 审查范围: SSE连接 → 事件解析 → 断线重连 → 超时 → Block合并 → 渲染

## 审查范围

| 文件 | 行数 | 职责 |
|------|------|------|
| `web/src/composables/useChatStream.ts` | 1-492 | SSE连接管理、事件解析、断线重连、超时处理、Block合并（流式阶段）、轮询降级 |
| `web/src/composables/useChatRender.ts` | 1-350 | Markdown渲染、Block解析（DB加载阶段）、schedule-proposal提取、Mermaid后渲染 |
| `web/src/composables/useChatSession.ts` | 1-507 | Session CRUD、loadHistory/switchSession编排、全局轮询、可见性恢复、消息计数轮询 |
| `web/src/composables/useSessionIdentity.ts` | 1-212 | 会话身份单例（ID/Title/Backend/AgentId）、Action代理注册、预初始化 |
| `internal/handler/chat_stream.go` | 1-171 | SSE HTTP handler、channel→SSE事件序列化、客户端断连检测、2s存活检查 |
| `internal/service/session_runtime.go` | 1-173 | 活跃Session追踪、Stream channel管理、Cancel函数管理（用户/断连原因追踪） |
| `internal/ai/accumulate.go` | 1-90 | 服务端Block累积：text/thinking coalesce、tool_use去重、warning/error追加 |
| `internal/ai/interface.go` | 1-108 | StreamEvent/ToolCall/QueueEventData类型定义、AIBackend接口 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**整体评分: 8/10**

SSE流式传输的架构分层清晰，职责边界明确：

**优点：**
- **前后端对称的Block合并逻辑**：`accumulate.go` 的 `findLastBlockOfType` + tool_use边界语义，与 `useChatStream.ts` 的 `findLastBlockOfType` 完全对称。服务端和客户端使用同一套合并规则，确保流式阶段和DB加载阶段产生一致的Block结构。
- **关注点分离**：`useChatStream`（连接/事件）、`useChatRender`（渲染/解析）、`useChatSession`（编排/CRUD）三层分工明确，通过回调接口（`UseChatStreamOptions`）解耦。
- **Session Identity单例**：`useSessionIdentity.ts` 将全局身份状态提升为模块级单例，通过 `registerSessionActions` 实现控制反转，解决了跨组件（App.vue、QuoteQuestionBar、ChatPanel）共享身份的难题。
- **优雅降级**：SSE → 3次重连 → 轮询 → DB加载，多层次容错，不会丢失数据。
- **后端channel设计**：`RegisterSessionStream` 返回 buffered channel (cap=64)，生产者非阻塞发送，消费者（SSE handler）按需读取，解耦了AI goroutine和HTTP handler的生命周期。

**问题：**
- **后端channel不广播**：`sessionStreams` 存储单个channel，若多个SSE客户端连接同一session（如多标签页），只有最后一个handler能读到channel数据——先连接的handler读到channel close后退出。前端有EventSource自动重连但后端不重发历史事件。
- **前端Block合并与后端AccumulateBlock重复**：两处实现了几乎相同的合并逻辑。虽然语义对称是优点，但修改一处时容易遗漏另一处（如新增block type时）。
- **useChatStream的回调接口过重**：`UseChatStreamOptions` 有16个回调字段，是composable间通信的"上帝接口"。这反映了ChatPanel拆分后组件间通信复杂度，但可读性不佳。

### ✨ 代码质量 (30%)

**整体评分: 7.5/10**

**优点：**
- **注释质量高**：关键设计决策都有注释说明"为什么"而非"做什么"，如 `findLastBlockOfType` 中解释了tool_use边界的语义、`queue_consume` 中解释了lastIndex更新为CRITICAL。
- **防御式编程**：`guard()` 闭包检测session切换和消息移除，防止陈旧事件污染新session。`forceCleanupStreamingState` 在所有中断路径都调用。
- **tool_use超时机制**：30秒无done事件自动标记完成，防止spinner永转。Map追踪timer，清理完善。
- **后端错误处理**：`json.Marshal` 错误被忽略但不会崩溃（空data仍发送），`json.Unmarshal` tool input失败时用空map兜底。
- **变更检测**：`buildMessageSnapshot` 做轻量级指纹比较，轮询时不触发无意义的UI刷新。

**问题：**
- **SSE事件名硬编码**：前端 `addEventListener('content', ...)` 和后端 `event: content\ndata:` 是字符串对，没有类型约束。新增或重命名事件类型时无编译时检查。
- **pollUntilDone中的JSON解析失败计数**：`jsonParseFailures` 在成功时重置为0，但连续失败5次才放弃。这个逻辑嵌在 setInterval 回调中，较难测试。
- **error事件处理的双重fallback**：`useChatStream.ts:424-445`，error事件先尝试 `onLoadHistory`，catch中又解析原始event data。但 `onLoadHistory` reject后，`e.data` 可能已经不可用（Event对象可能被GC或reset）。
- **中文硬编码**：`chat_stream.go:41` 和 `:51` 的错误消息是中文（"会话未在运行"、"未找到会话流"），但前端通过i18n显示。后端错误消息应使用reason code而非直接中文文本，保持国际化一致性。

### 🛡️ 健壮性 (40%)

**整体评分: 7.5/10**

**优点：**
- **done事件后重新加载DB**：`useChatStream.ts:329`，`onLoadHistory().finally(...)` 确保即使SSE事件在传输中丢失，最终状态也从DB获取，这是数据完整性的关键保障。
- **reconnectAttempts上限**：3次重连后降级为轮询，防止无限重连循环。
- **ForceCancelSession与CancelSession分离**：`CancelSession` 发cancelled事件（用户主动取消），`ForceCancelSession` 不发事件（SSE客户端已断连），避免向已关闭的channel发送。
- **channel close作为终止信号**：后端AI goroutine退出时 `UnregisterSessionStream` 关闭channel，SSE handler收到 `ok=false` 后发送done事件。这确保了goroutine退出后SSE连接也会关闭。
- **checkTicker存活检查**：2秒间隔检查 `IsSessionRunning`，即使channel被意外清空，SSE handler也不会永远挂起。
- **CancelSession的幂等性**：如果session已不在running状态，返回true（视为已取消）。`sessionCancels.LoadAndDelete` 保证只执行一次cancel。
- **tool_use done标记的一致性**：`cancelled` 事件和 `forceCleanupStreamingState` 都遍历blocks标记未完成的tool_use为done，防止UI spinner永转。

**问题（详见问题清单）：**
- **P0: 后端channel事件丢失**：`SendSessionEvent` 使用非阻塞发送（`select default`），当channel满（cap=64）时事件被静默丢弃。对于metadata/warning等非关键事件可接受，但tool_use done事件丢失会导致前端spinner永转（虽然有30秒超时兜底）。
- **P1: 重连后SSE事件不回放**：客户端断连后重连SSE，只能读到重连后产生的事件。断连期间产生的事件虽然已持久化到DB，但只在done时通过 `onLoadHistory` 加载。如果重连后AI继续运行很长时间，断连期间的增量内容不会被前端看到。
- **P1: 重连不重置reconnectAttempts**：`resetStreamTimeout` 中超时后重连，`reconnectAttempts++` 但成功重连后不重置为0。一次超时就消耗一次重连配额，3次超时（即使每次都成功重连）就会降级为轮询。
- **P1: queue_consume事件中lastIndex更新与guard竞争**：`useChatStream.ts:411`，`lastIndex = messages.value.length - 1` 更新闭包变量，但其他事件handler中的 `guard()` 仍使用原始 `lastIndex` 闭包。在极端情况下，一个事件在queue_consume之前到达但guard检查在lastIndex更新之后，可能写入错误的message。
- **P2: error事件处理中的e.data不可靠**：`useChatStream.ts:431`，在 `onLoadHistory` 的catch中读取 `e.data`，但EventSource spec不保证Event对象在回调后仍可用。
- **P2: 后端checkTicker发送cancelled事件但前端可能已知道**：session正常完成后2秒内如果SSE handler的ticker先触发，可能误发cancelled事件。但 `IsSessionRunning` 已返回false说明goroutine已退出，此时channel close也会触发done——存在短暂竞争窗口。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R2-001 | P1 | 健壮性 | **重连不重置reconnectAttempts**：超时重连成功后reconnectAttempts不归零，3次超时（即使每次都成功重连）就会强制降级为轮询 | `useChatStream.ts:77-79` | 在SSE `onopen` 回调中重置 `reconnectAttempts = 0` |
| R2-002 | P1 | 健壮性 | **重连后事件不回放**：客户端断连→重连SSE期间，后端继续产生的事件不会回放给新SSE连接。用户在重连后看不到断连期间的增量内容，直到done时onLoadHistory | `useChatStream.ts:447-460` | 重连后立即做一次轻量级HTTP poll获取当前content，或在connectStream时通过增量API获取断连期间的事件 |
| R2-003 | P1 | 健壮性 | **SendSessionEvent非阻塞丢失**：channel满（cap=64）时事件被静默丢弃。tool_use done事件丢失导致spinner永转（30秒超时兜底，但用户体验差） | `session_runtime.go:162-173` | 对于terminal事件（done/cancelled/tool_use done），使用阻塞发送或增大buffer；或在SSE handler侧增加heartbeat机制检测事件间隙 |
| R2-004 | P1 | 健壮性 | **queue_consume后lastIndex更新与guard竞争**：lastIndex是闭包变量，queue_consume事件更新了lastIndex，但其他并发事件handler可能仍在使用旧值 | `useChatStream.ts:411` | 将lastIndex改为ref或在每次事件处理时动态查找streaming message的index（`findIndex`），而非依赖闭包变量 |
| R2-005 | P2 | 代码质量 | **error事件catch中读取e.data不可靠**：Event对象在异步回调中可能已被GC/reset | `useChatStream.ts:431` | 在addEventListener回调中立即解析 `e.data` 并缓存，不依赖异步后的Event对象 |
| R2-006 | P2 | 代码质量 | **SSE事件名前后端无类型约束**：前端addEventListener和后端fmt.Fprintf使用字符串匹配，新增/重命名事件类型无编译时检查 | `chat_stream.go:76-149`, `useChatStream.ts:244-445` | 定义共享的事件类型常量（至少在各自代码中统一管理），或使用代码生成 |
| R2-007 | P2 | 代码质量 | **后端错误消息中文硬编码**：`"会话未在运行"`, `"未找到会话流"` 直接写入SSE data，前端通过reason code做i18n更合适 | `chat_stream.go:41,51` | 改为发送reason code（如 `{"error":"session not running","reason":"not_running"}`），前端按reason做i18n |
| R2-008 | P2 | 代码质量 | **useChatStream回调接口过重**：16个回调字段，composable间通信复杂 | `useChatStream.ts:5-22` | 将相关回调分组为子接口（如 `StreamCallbacks`, `UICallbacks`），或使用provide/inject |
| R2-009 | P2 | 健壮性 | **后端checkTicker与channel close竞争**：session正常完成后，UnregisterSessionStream关闭channel触发done事件，但2秒ticker可能先检测到not-running发送cancelled | `chat_stream.go:155-162` | 在IsSessionRunning检查为false后，先尝试非阻塞读取channel是否还有pending事件；或在SetSessionRunning(false)之后立即close channel以减少竞争窗口 |
| R2-010 | P2 | 健壮性 | **前端tool_use超时30秒可能不够**：长时间运行的tool（如Bash执行编译）可能超过30秒，超时后前端标记done但后端仍会发送真正的done事件，导致UI闪烁 | `useChatStream.ts:55,302-310` | 将TOOL_USE_TIMEOUT_MS改为可配置值，或根据tool name调整（Bash类120秒，其他30秒） |
| R2-011 | P2 | 健壮性 | **onerror中无延迟重连**：SSE连接失败后立即重连（`connectStream`），无退避策略。若后端短暂不可用，3次快速重连都会失败 | `useChatStream.ts:447-460` | 添加指数退避（1s, 2s, 4s），避免在服务端恢复前耗尽重连配额 |
| R2-012 | P2 | 代码质量 | **accumulate.go的error事件存为warning类型**：`AccumulateBlock` 中error类型事件被存为type="warning"的ContentBlock，语义混淆 | `accumulate.go:88` | error事件应存为type="error"，与前端`forceCleanupStreamingState`和`cancelled`事件处理中的error block类型保持一致 |
| R2-013 | P3 | 代码质量 | **pollUntilDone没有超时上限**：轮询没有最大次数或总时间限制，如果后端session.running永远为true（zombie session），前端会无限轮询 | `useChatStream.ts:131-193` | 添加最大轮询次数（如90次 = 3分钟），超时后forceCleanup |
| R2-014 | P3 | 代码质量 | **renderTimer未在disconnect时清理**：`disconnectStream` 清理了streamTimeout和toolUseTimeouts，但未清理renderTimer | `useChatStream.ts:88-95` | 在disconnectStream中增加 `if (renderTimer) { clearTimeout(renderTimer); renderTimer = null }` |
| R2-015 | P3 | 健壮性 | **parseAssistantContent的空catch**：`useChatRender.ts:159` 的 `catch {}` 吞掉了JSON解析错误，调试困难 | `useChatRender.ts:159` | 至少添加 `console.warn` 记录解析失败的内容片段 |
| R2-016 | P3 | 代码质量 | **blockProposals和blockAskQuestions使用reactive但无清理机制**：这些reactive对象随消息增长，session切换时不清理旧条目（只有createSession时清理） | `useChatRender.ts:14-16` | 在switchSession/loadHistory时清理不在当前消息列表中的proposal/ask条目 |

## 改进建议 (Top 3)

1. **SSE重连事件回放机制**: 当前重连后无法获取断连期间的增量事件，用户可能长时间看不到新内容。建议在 `connectStream` 时先做一次轻量HTTP请求获取当前assistant message的完整content，与本地状态做diff后补齐缺失的blocks/text。预期收益: 消除断线重连期间的内容盲区，提升移动网络场景下的用户体验。

2. **重连策略优化（重置计数器 + 指数退避）**: 当前超时重连不重置reconnectAttempts，且连接失败后无退避。建议：(1) 在SSE `onopen` 中重置 `reconnectAttempts = 0`；(2) 在 `onerror` 中添加指数退避（1s → 2s → 4s）。预期收益: 避免因间歇性超时耗尽重连配额，减少无效快速重连对服务端的冲击。

3. **Terminal事件保障送达**: `SendSessionEvent` 的非阻塞发送在channel满时会静默丢弃事件，tool_use done丢失导致spinner永转。建议对terminal事件（done/cancelled/error）使用带短超时的阻塞发送（如100ms），或增大channel buffer到128。预期收益: 消除spinner永转的用户体验问题，减少对30秒超时兜底的依赖。

## 亮点

- **done后onLoadHistory保障数据完整性**: SSE事件可能因网络问题丢失，done事件后总是从DB重新加载完整内容，这是数据一致性的最后一道防线。设计思路值得推广。
- **findLastBlockOfType + tool_use边界语义**: 前后端使用完全相同的Block合并规则，tool_use作为自然分隔符防止跨工具调用的文本/思考合并。这个抽象简洁且正确，处理了GLM-5.1等模型交替输出thinking/text_delta的复杂场景。
- **Cancel reason追踪**: `sessionCancelReasons` 区分"user"和"disconnect"两种取消原因，让AI goroutine可以针对不同原因做不同处理（用户取消清除队列，断连保留队列）。这种细粒度的原因追踪在异步系统中很有价值。
- **优雅的多层降级策略**: SSE → 重连(3次) → HTTP轮询 → DB加载，每一层都能独立工作，不会因某一层失败导致整个流式体验崩溃。
- **useSessionIdentity的控制反转设计**: 模块级单例持有身份refs，通过 `registerSessionActions` 让ChatPanel注册操作实现。其他消费者（App.vue、QuoteQuestionBar）通过代理调用，无需直接依赖ChatPanel实例。这种IoC模式在Vue composable生态中较为少见但非常实用。
