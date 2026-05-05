# R4: Session 管理 Review

> 日期: 2026-05-05
> 审查范围: Session CRUD → SQLite持久化 → 运行时跟踪 → 取消/原因追踪

## 审查范围

| 层次 | 文件 | 行号范围 |
|------|------|----------|
| 模型 | `internal/model/chat.go` | 1-52 |
| 服务-持久化 | `internal/service/chat.go` | 1-381 |
| 服务-运行时 | `internal/service/session_runtime.go` | 1-174 |
| 服务-队列 | `internal/service/queue.go` | 1-109 |
| 服务-数据库 | `internal/service/database.go` | 1-271 |
| Handler-Session CRUD | `internal/handler/chat_session.go` | 1-149 |
| Handler-Chat(核心) | `internal/handler/chat.go` | 1-1054 |
| Handler-History | `internal/handler/chat_history.go` | 1-130 |
| Handler-Queue | `internal/handler/queue.go` | 1-113 |
| Handler-SSE | `internal/handler/chat_stream.go` | 1-172 |
| Handler-路由 | `internal/handler/handler.go` | 1-167 |
| 前端-Identity | `web/src/composables/useSessionIdentity.ts` | 1-213 |
| 前端-Manager | `web/src/composables/useSessionManager.ts` | 1-242 |
| 前端-Session | `web/src/composables/useChatSession.ts` | 1-507 |
| 前端-Stream | `web/src/composables/useChatStream.ts` | 1-493 |
| 前端-Swipe | `web/src/composables/useSwipeSession.ts` | 1-157 |
| 前端-Drawer | `web/src/components/session/SessionDrawer.vue` | 1-491 |
| 前端-Selector | `web/src/components/session/SessionSelector.vue` | 1-225 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**评分: 7.5/10**

**优点:**

1. **useSessionIdentity 单例模式设计精良** — 模块级 `ref` + action callback 注册，实现了身份层的全局唯一真相源，同时将操作委托给 ChatPanel。这种 IoC 模式让 App.vue、QuoteQuestionBar 等组件无需直接依赖 ChatPanel 即可触发会话操作。

2. **useSessionManager 统一入口** — 所有会话切换路径（SessionDrawer、swipe、identity proxy）都经过 manager，确保了 `cleanupActiveStream()` 和队列同步的必然执行。这是防止状态不一致的关键架构决策。

3. **队列系统与流式执行的 drain loop** — `chat.go:348-404` 的 drain loop 设计优雅：正常完成后检查队列，有消息就继续执行，实现了"发送多条消息时排队依次处理"的用户体验。

4. **取消原因追踪** — `sessionCancelReasons` sync.Map + `GetAndClearCancelReason()` 原子操作，让 `finalizeStreamRun` 能精确判断取消类型，在 DB 中标记不同状态。

**问题:**

1. **session_runtime.go 全局可变状态过于分散** — `activeSessions`（map+mutex）、`sessionStreams`（sync.Map）、`sessionCancels`（sync.Map）、`sessionCancelReasons`（sync.Map）四个独立的全局变量管理同一个 session 的不同方面。修改一个 session 的状态需要操作多个全局变量，缺少封装。任一变量的不一致都会导致 session 泄漏。

2. **ForceCancelSession 未在 SSE 断开时调用** — `chat_stream.go:164-168` 当 SSE 客户端断开时仅记录日志并返回，AI goroutine 继续运行。虽然 `ForceCancelSession` 已实现（设置 "disconnect" 原因 + 清理），但从未被 SSE handler 调用。这意味着：如果用户关闭浏览器/网络断开，AI 进程会一直运行直到自然完成，消耗资源且用户回来后可能看到过时内容。

3. **useChatSession 与 useSessionManager 职责重叠** — `useChatSession` 的 `switchSession`、`createSession`、`deleteSession` 和 `useSessionManager` 的同名方法功能高度重叠。Manager 是 wrapper，但 useChatSession 也保留了完整的独立操作能力。这增加了理解成本和维护负担。

4. **DeleteSession 缺少运行中检查** — `chat_session.go:97-124` 的 `DeleteSession` handler 和 `service/chat.go:270-279` 的 `DeleteSession` 函数都没有检查 session 是否正在运行。删除一个正在运行的 session 会留下残留的 goroutine、stream channel 和 cancel function。

### ✨ 代码质量 (30%)

**评分: 7/10**

**优点:**

1. **自启动孤儿清理** — `database.go:176-221` 在启动时检测 `streaming=1` 的消息，标记为 `cancelled` 并添加 warning block。这优雅地解决了服务重启后的数据一致性问题。

2. **trySetSessionRunning 原子操作** — `session_runtime.go:44-53` 的 `TrySetSessionRunning` 是检查+设置的原子操作，防止了并发发送消息时的竞态。

3. **switchSession 序列号防竞态** — `useChatSession.ts:86-87` 的 `switchSessionSeq` 确保"最后获胜"，快速切换时不会显示过时数据。

4. **sendEvent 非阻塞设计** — `chat.go:1022-1040` 当 channel 满时丢弃事件而非阻塞，DB 持久化保证了数据不丢失。

**问题:**

1. **session ID 通过 cookie 传递存在安全风险** — `chat_session.go:139-148` 设置 `HttpOnly: false` 的 cookie 存储 session ID。JavaScript 可读取此 cookie，且 session ID 是全局唯一的 UUID，获取后可操作任意会话。

2. **AddChatMessage 忽略 json.Marshal 错误** — `chat.go:97` `data, _ := json.Marshal(files)` 忽略了序列化错误。虽然 `[]string` 不太可能序列化失败，但这违反了错误处理惯例。

3. **AddChatMessage 返回值忽略了 LastInsertId 错误** — `chat.go:153` `messageID, _ := result.LastInsertId()` 忽略了错误，虽然在事务提交后不太可能失败，但更安全的做法是检查。

4. **GetChatMessageCount 忽略 Scan 错误** — `chat.go:89` 不检查 `DB.QueryRow().Scan()` 的错误。如果 DB 出问题，返回 0 而非错误。

5. **GetSessionAgentID 忽略错误** — `chat.go:299-303` 同样忽略 QueryRow 错误。

6. **UpdateLastRead 忽略 Exec 错误** — `chat.go:239` 不检查 Exec 错误，且函数签名不返回 error，调用者无法感知失败。

7. **SessionSelector 是重复/过时组件** — `SessionSelector.vue` 与 `SessionDrawer.vue` 功能高度重复，但缺少 agent 选择、running 状态、删除确认等关键功能。似乎是被 SessionDrawer 替代的旧组件，但仍存在于代码中。

8. **硬编码中文字符串** — `chat.go:97-98` 的 `"文件消息"`、`"新会话"` 在 Go 代码中硬编码，与 i18n 架构不一致。

9. **useSwipeSession 的 sessionCache 没有失效机制** — `useSwipeSession.ts:13-14` 使用 3 秒 TTL 的缓存，但如果在 3 秒内创建/删除了 session，缓存不会失效，用户可能看到过时列表。

### 🛡️ 健壮性 (40%)

**评分: 7/10**

**优点:**

1. **孤儿流式消息清理** — 启动时自动清理 `streaming=1` 的消息，防止 UI 显示"加载中"的永久状态。

2. **SSE 重连 + 轮询降级** — `useChatStream.ts:447-460` 在 SSE 连接断开时重试 3 次，然后降级到 HTTP 轮询，保证了移动网络不稳定时的可靠性。

3. **visibility change 处理** — `useChatSession.ts:463-473` 页面可见性变化时重连流，处理了移动端切换 app 后回来的场景。

4. **panic recovery in AI goroutine** — `chat.go:311-328` AI goroutine 有 panic recovery，防止单个请求的崩溃导致整个服务不可用。

5. **队列与取消的协调** — `CancelSession` 和 `ForceCancelSession` 都调用 `ClearQueue`，确保取消后不会执行排队中的消息。

**问题:**

1. **P0: ForceCancelSession 从未被调用 — AI 僵尸进程泄漏** — `ForceCancelSession` 已实现但从未在 SSE 断开时调用。当用户关闭浏览器或网络断开，AI 进程会无限运行。如果在手机上操作，这会持续消耗电池和 CPU。应该在 SSE 断开后延迟一段时间（如 30s）后调用 ForceCancelSession。

2. **P1: DeleteSession 不取消运行中的 session** — `service/chat.go:270-279` 直接删除 DB 记录，不检查 `IsSessionRunning`。如果 session 正在运行，goroutine、stream channel、cancel function 会变成孤儿：
   - goroutine 的 `defer SetSessionRunning(sessionID, false)` 会写已删除的 session
   - stream channel 不会被关闭，SSE handler 的 checkTicker 会持续运行
   - cancel function 不会被清理

3. **P1: activeSessions 与 sessionCancels 不一致** — `CancelSession` 的执行顺序是：`LoadAndDelete cancel → Store reason → ClearQueue → cancel() → send cancelled event → SetSessionRunning false`。如果在 `cancel()` 和 `SetSessionRunning false` 之间有新的请求调用 `TrySetSessionRunning`，会返回 false（因为 session 还在 activeSessions 中），但实际上 cancel 已经执行。这个窗口期很窄但存在。

4. **P1: SSE checkTicker 在 session 结束后可能发 cancelled 事件** — `chat_stream.go:155-162` 的 checkTicker 每 2 秒检查 `IsSessionRunning`。如果 AI goroutine 已经发送了 `done` 事件并关闭了 channel，但 `SetSessionRunning(sessionID, false)` 的执行稍微延迟，checkTicker 可能多发一个 `cancelled` 事件给前端。

5. **P1: queue.go 的 DequeueMessage 在空队列后删除 sync.Map entry** — `queue.go:46-48` 当 `len(entry.items) == 0` 时 `sessionQueues.Delete(sessionID)`。但如果随后又有 EnqueueMessage，`LoadOrStore` 会创建新的 entry。问题是 DequeueMessage 先 `Load` 再操作，如果 Load 和 Lock 之间有 ClearQueue（Delete），entry 可能已经被替换。不过 sync.Map 的 Load 返回的是旧 entry，所以实际安全——只是 entry 在 sync.Map 中被删除后仍然被操作，这不会导致数据问题但会浪费内存直到 GC。

6. **P2: useChatSession 的 deleteSession 在删除当前会话后直接调 switchSession** — `useChatSession.ts:307-315` 删除当前 session 后立即 fetch sessions 并 switchSession。如果 API 延迟，用户可能看到短暂的无会话状态。

7. **P2: SSE handler 不发送 queue_update 事件** — `chat_stream.go` 只转发已注册的事件类型。如果 AI goroutine 发送了 `queue_update` 事件，SSE handler 会正确处理（:142-148）。但如果 SSE 连接在 queue_update 事件发送时断开，前端不会收到更新，pendingMessages 列表可能与后端不一致。

8. **P2: useChatStream 的 lastIndex 闭包变量更新** — `useChatStream.ts:411` 在 `queue_consume` 事件中更新 `lastIndex` 闭包变量。这是正确的，但如果 SSE 事件乱序到达（理论上不应发生但 WebSocket 环境可能），lastIndex 可能指向错误的消息。

9. **P2: Cookie-based session ID 在多标签页冲突** — 多个浏览器标签共享同一个 cookie，修改 `chat_session_id` cookie 会影响其他标签的 session 身份。虽然 `useSessionIdentity` 的 `initSessionFromAPI` 会在每个标签加载时初始化，但后续的 cookie 更新（如 `setSessionID`）会互相覆盖。

10. **P3: SessionDrawer 删除后 setTimeout reload** — `SessionDrawer.vue:162` 用 300ms setTimeout 重新加载 session 列表，如果 API 请求延迟超过 300ms，列表可能显示已删除的 session。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R4-001 | P0 | 健壮性 | ForceCancelSession 从未被调用，SSE 断开后 AI 僵尸进程持续运行 | `chat_stream.go:164-168` | 在 SSE 断开时设置延迟（30s），若 AI 未自然结束则调用 ForceCancelSession |
| R4-002 | P1 | 健壮性 | DeleteSession 不取消运行中的 session，留下孤儿 goroutine/channel/cancel | `service/chat.go:270-279` | 在删除前检查 IsSessionRunning，若运行中先调用 CancelSession |
| R4-003 | P1 | 健壮性 | CancelSession 中 SetSessionRunning(false) 与新请求 TrySetSessionRunning 的竞态窗口 | `session_runtime.go:78-114` | 在 TrySetSessionRunning 中增加对 cancel 状态的二次检查，或在 CancelSession 中先 SetSessionRunning(false) 再 cancel |
| R4-004 | P1 | 健壮性 | SSE checkTicker 可能在 done 事件后多发送 cancelled 事件 | `chat_stream.go:155-162` | 在发送 done 事件后立即返回，不进入 checkTicker 分支（已通过 channel close 实现，但 SetSessionRunning 延迟可能造成窗口） |
| R4-005 | P1 | 架构 | session_runtime.go 四个独立全局变量管理同一 session 状态，缺少封装 | `session_runtime.go:11-21` | 封装为 SessionRegistry 结构体，提供原子操作接口 |
| R4-006 | P2 | 代码质量 | SessionSelector.vue 是被 SessionDrawer 替代的旧组件，仍存在于代码中 | `SessionSelector.vue` 全文 | 确认无引用后删除 |
| R4-007 | P2 | 代码质量 | Go 代码中硬编码中文（"文件消息"、"新会话"） | `service/chat.go:134-138` | 移到常量或配置，与 i18n 策略一致 |
| R4-008 | P2 | 代码质量 | 多个 DB 函数忽略错误（GetChatMessageCount, GetSessionAgentID, UpdateLastRead） | `service/chat.go:89, 299-303, 239` | 至少记录日志，关键函数应返回 error |
| R4-009 | P2 | 健壮性 | Cookie-based session ID 多标签页冲突 | `chat_session.go:139-148` | 考虑使用 query param 而非 cookie 作为主要传递方式，或使用 localStorage |
| R4-010 | P2 | 架构 | useChatSession 与 useSessionManager 职责重叠 | 两个 composable 全文 | 明确划分：useChatSession 只做 API 调用，useSessionManager 负责协调和状态清理 |
| R4-011 | P2 | 代码质量 | AddChatMessage 忽略 json.Marshal 和 LastInsertId 错误 | `service/chat.go:97, 153` | 检查错误或至少记录日志 |
| R4-012 | P3 | 健壮性 | SessionDrawer 删除后用 setTimeout(300ms) 重载，可能显示过时列表 | `SessionDrawer.vue:162` | 改为 await deleteSession 完成后立即 reload |
| R4-013 | P3 | 健壮性 | useSwipeSession 3秒缓存无主动失效机制 | `useSwipeSession.ts:13-15` | 在 create/delete session 后清除缓存 |
| R4-014 | P2 | 安全 | session cookie HttpOnly=false，JS 可读取 session ID | `chat_session.go:146` | 设置 HttpOnly: true（如果前端不需要 JS 读取）或评估风险 |
| R4-015 | P1 | 健壮性 | QueueHandler 不验证 session 存在性和归属 | `handler/queue.go:30-64` | 添加 session 存在性检查和 project_path 归属验证，防止向任意 session 排队消息 |
| R4-016 | P2 | 架构 | AIChat GET 自动创建 session 的逻辑与 POST 重复 | `chat.go:82-108, 158-178` | 提取 autoCreateSession 辅助函数 |
| R4-017 | P3 | 代码质量 | chat.go 中的 min() 函数未被使用 | `chat.go:819-824` | 删除未使用函数 |
| R4-018 | P2 | 健壮性 | executeStreamRun 中 flushTicker 在 cancel 后可能继续触发 | `chat.go:457-458, 581-590` | 在 finalize 后 ticker 虽然被 defer Stop，但 finalizeStreamRun 内的 DB 操作可能被 ticker 的 UpdateStreamingMessage 竞争 |

## 改进建议 (Top 3)

1. **实现 SSE 断开后的 AI 进程清理机制** — 在 `chat_stream.go` 的 `r.Context().Done()` 分支中，启动一个带延迟的 goroutine（如 30s），若 session 仍在运行则调用 `ForceCancelSession`。预期收益: 消除僵尸 AI 进程，降低服务器资源消耗，改善移动端体验。这是当前最关键的可靠性问题。

2. **封装 SessionRegistry 替代四个独立全局变量** — 将 `activeSessions`、`sessionStreams`、`sessionCancels`、`sessionCancelReasons` 封装为一个 `SessionRegistry` 结构体，提供 `Start(sessionID, stream, cancel)`、`Cancel(sessionID, reason)`、`ForceCancel(sessionID)`、`Cleanup(sessionID)` 等原子操作方法。预期收益: 消除状态不一致风险，简化调用方代码，便于添加监控和调试。

3. **DeleteSession 增加运行中检查和取消** — 在 `service.DeleteSession` 中，删除 DB 记录前先检查 `IsSessionRunning`，若运行中先调用 `CancelSession`（等待 goroutine 退出后再删除）。QueueHandler 也应验证 session 存在性和归属。预期收益: 防止删除运行中 session 导致的资源泄漏和潜在崩溃。

## 亮点

- **useSessionIdentity 的 IoC 模式**极为精巧 — 通过模块级 ref 存储身份 + action callback 注册委托操作，完美解决了"全局需要读取，局部负责操作"的架构矛盾。这是整个前端架构中最值得借鉴的模式。

- **Orphan streaming message 清理**（`database.go:176-221`）体现了对生产环境异常的深刻理解 — 服务崩溃重启后不会留下"永久加载中"的消息，而是优雅地标记为中断并添加 warning，用户体验从"坏掉"变为"被中断"。

- **Drain loop 设计**（`chat.go:348-404`）将流式执行和消息队列完美结合 — 正常完成后检查队列，无缝衔接下一条消息，50ms 的 re-check delay 优雅地处理了 enqueue-during-exit 竞态。

- **switchSessionSeq 防竞态**是前端并发控制的教科书实现 — 简单的递增计数器 + 完成时比对，零成本解决了快速切换时的数据混乱问题。

- **TrySetSessionRunning** 的原子检查+设置是防止并发 session 启动的关键屏障 — 比先 IsSessionRunning 再 SetSessionRunning 的两步操作安全得多。
