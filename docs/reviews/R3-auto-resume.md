# R3: Auto-Resume 流程 Review

> 日期: 2026-05-27
> 审查范围: ExitPlanMode检测 → 取消CLI → 自动续传 → resume_split事件

## 审查范围

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `internal/ai/factory.go` | 1-23 | AutoResumeBackend包装入口 |
| `internal/ai/auto_resume.go` | 1-173 | 核心逻辑：两阶段流合并、ExitPlanMode检测、cancel+resume |
| `internal/ai/auto_resume_test.go` | 1-410 | 单元测试（7个测试用例 + 2个mock backend） |
| `internal/ai/stream_parser.go` | 1-329 | ExitPlanMode事件的解析层（tool_use事件生成） |
| `internal/ai/cli_backend.go` | 1-225 | CLI进程管理、context取消与进程清理 |
| `internal/ai/interface.go` | 1-109 | StreamEvent/ToolCall/ChatRequest类型定义 |
| `internal/ai/accumulate.go` | 1-91 | 事件→ContentBlock累积逻辑 |
| `internal/ai/claude.go` | 1-20 | Claude backend + preStart stdin注入 |
| `internal/ai/codebuddy.go` | 1-26 | Codebuddy backend + preStart stdin注入 |
| `internal/handler/chat.go` | 1-1054 | resume_split处理、消息持久化、executeStreamRun |
| `internal/handler/chat_stream.go` | 1-171 | SSE层事件转发（resume_split不在SSE中转发） |
| `internal/service/session_runtime.go` | 1-174 | 取消函数管理、cancel reason追踪 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**评分: 8.5/10**

**优点：**

1. **Decorator模式应用恰当**：`AutoResumeBackend`作为装饰器包装`AIBackend`，通过`factory.go`选择性应用于claude/codebuddy后端，实现了关注点分离。对不支持的backend（opencode/gemini/codex）完全透明，扩展性好。

2. **两阶段流的抽象干净**：`mergeStreams`将Phase1（正常转发+ExitPlanMode检测）和Phase2（resume流转发）封装在一个goroutine内，外部只看到一个连续的`<-chan StreamEvent`，调用方无感知。

3. **分层边界清晰**：ExitPlanMode检测在`auto_resume.go`（AI层），消息持久化切分在`chat.go`（Handler层），SSE转发在`chat_stream.go`（传输层）。每层只处理自己关心的事件。

4. **resume_split事件设计**：引入`resume_split`作为层间信号，让Handler知道何时切分DB消息，避免了一个消息跨越两个CLI进程的持久化不一致问题。

**问题：**

1. **resume_split未在SSE层转发**：`chat_stream.go`的switch没有`resume_split` case，该事件在handler层被消费后不会到达SSE。这意味着前端无法得知auto-resume发生了——如果前端需要做任何UI响应（如显示"正在续传..."提示），当前架构不支持。虽然目前前端可能不需要，但这是一个可扩展性隐患。

2. **AutoResumeBackend与CLIBackend的耦合**：`AutoResumeBackend`直接依赖`inner AIBackend`接口，但Phase2创建`resumeReq`时硬编码了`Resume: true`和`Prompt: "继续"`。如果未来有非CLI backend也需要auto-resume，这些CLI特定假设可能不适用。

3. **单层resume限制硬编码**：Phase2不检测嵌套ExitPlanMode，这是正确的设计选择（避免无限递归），但没有文档或常量说明为什么只支持一层。如果AI在resume后再次进入plan mode，用户看到的是第二个ExitPlanMode tool_use事件但没有后续action。

### ✨ 代码质量 (30%)

**评分: 8/10**

**优点：**

1. **forwardEvent的非阻塞设计**：使用`select`+`default`避免goroutine阻塞在满channel上，配合warn日志，是正确的流控策略——宁可丢事件也不死锁。

2. **Phase1 drain逻辑**：取消inner CLI后，用`for drainEvent := range innerCh`排空剩余事件，只转发`raw_output`，抑制`done`事件，避免handler收到虚假的"完成"信号。这体现了对事件语义的深刻理解。

3. **raw_output的Phase2抑制**：Resume流的`raw_output`被`continue`跳过，避免两段不同CLI进程的raw_output混淆。Phase1的raw_output正常转发，保证调试信息完整。

4. **测试覆盖全面**：7个测试用例覆盖了透明透传、ExitPlanMode检测、外部取消（Phase1/Phase2）、resume失败降级、raw_output处理、嵌套ExitPlanMode抑制。Mock backend设计简洁有效。

5. **注释质量高**：`auto_resume.go`的文件头注释和`mergeStreams`的方法注释清晰描述了两阶段行为和边界条件。

**问题：**

1. **goto的使用**：`mergeStreams`使用`goto phase1Done`进行Phase1→Phase2的跳转。虽然功能正确，但Go社区通常避免`goto`。可以用`break`+label或提取函数替代，提升可读性。

2. **innerCancel泄漏风险**：Phase1结束后，`innerCancel`没有被defer调用。虽然inner context已经取消，但在`innerCancel`和`phase1Done`之间的代码路径中，如果发生panic，cancel不会被调用。不过由于Phase1 drain用`range`保证完成，实际风险很低。

3. **magic string "继续"**：resume prompt硬编码为中文字符串，没有常量提取。如果需要国际化或调整，需要修改源码。建议提取为包级常量。

4. **ChatRequest字段逐个拷贝**：`resumeReq`通过逐字段赋值构建，如果`ChatRequest`新增字段，容易遗漏。可以使用值拷贝+选择性覆盖的方式：
   ```go
   resumeReq := origReq
   resumeReq.Prompt = "继续"
   resumeReq.Resume = true
   ```

### 🛡️ 健壮性 (40%)

**评分: 7.5/10**

**优点：**

1. **两阶段切换的原子性**：ExitPlanMode检测→转发事件→emit resume_split→cancel inner→drain，这一系列操作在同一个goroutine内顺序执行，没有并发风险。`resume_split`在cancel之前发出，确保handler能在CLI进程死亡前完成消息切分。

2. **CLI进程清理**：`innerCancel()`取消子context，`exec.CommandContext`会向CLI进程发送SIGKILL（Go默认行为）。drain阶段`range innerCh`确保channel被关闭后才进入Phase2，不会遗漏还在管道中的数据。

3. **外层context取消的传播**：Phase1和Phase2都`select`了`<-ctx.Done()`，外层取消（用户取消/disconnect）能立即终止两阶段中的任何一个。`defer close(outerCh)`保证channel一定被关闭。

4. **Resume失败降级**：Phase2 `ExecuteStream`失败时，emit一个`done`事件让handler正常收尾，避免stream永远挂起。

5. **cancel reason正确性**：`auto_resume.go`的`innerCancel()`取消的是child context，不会触发`session_runtime.go`中的cancel reason记录。外层`ctx`（来自handler的`context.Background()`子context）不受影响，因此auto-resume的内部取消不会被误判为用户取消。

**问题（按严重度排序）：**

1. **[P1] Phase1 drain期间外层取消的竞态窗口**：`auto_resume.go:85-94`，在`innerCancel()`之后、`range innerCh` drain期间，如果外层`ctx`被取消（用户点击取消），drain循环不会检查`ctx.Done()`。正常情况下drain很快（CLI进程被杀后stdout pipe很快关闭），但如果CLI进程不响应SIGKILL（如僵死进程），drain可能阻塞，导致外层取消延迟。

   不过，实际上`innerCh`是`cli_backend.go`中goroutine的输出channel，当`innerCtx`被cancel后，goroutine内的`cmd.Wait()`会返回，goroutine退出并`close(ch)`，所以drain不会无限阻塞。因此这是一个理论上的问题，实际风险很低。

2. **[P1] executeStreamRun中resume_split时raw_output的保存竞态**：`chat.go:529-538`，在`resume_split`处理中，先调用`FinalizeStreamingMessage`，然后检查`rawOutput != ""`来保存raw output。但此时获取的`GetStreamingMessageID`是最新streaming message的ID——而刚finalize的消息已经不是streaming状态了，新创建的streaming placeholder才是。

   **具体流程**：
   - L522: `FinalizeStreamingMessage` — 将消息A标记为finalized
   - L530: `GetStreamingMessageID` — 此时返回的可能不再是消息A的ID（取决于实现）
   - L547: `AddChatMessage(isStreaming=true)` — 创建新的streaming消息B

   这意味着如果`GetStreamingMessageID`在finalize后不再返回旧ID，raw_output可能保存到错误的消息或丢失。

3. **[P2] Phase2的innerCancel2可能延迟调用**：`auto_resume.go:116-117`，`innerCtx2, innerCancel2 := context.WithCancel(ctx)` + `defer innerCancel2()`。innerCancel2只在`mergeStreams`函数返回时调用。如果Phase2流正常运行完成（收到`done`后return），defer能正确执行。但如果外层ctx被取消导致提前return，innerCancel2也能通过defer执行。这部分是正确的。

   但有一个微妙点：Phase2的`ExecuteStream`返回error时（L131-138），emit done后直接return，innerCancel2通过defer调用。此时`innerCh2`是nil（因为err != nil），所以没有channel需要drain。这是正确的。

4. **[P2] channel buffer大小不一致**：`auto_resume.go:26`创建`outerCh`时使用`streamChanSize`（64），与`cli_backend.go:64`和`session_runtime.go:133`一致。但`forwardEvent`在channel满时丢弃事件并warn——对于content事件，丢弃意味着前端丢失文本片段。虽然DB持久化独立于channel，前端可以通过reload恢复，但用户体验会受损。

5. **[P2] AutoResumeBackend不是线程安全的**：同一个`AutoResumeBackend`实例可能被多个goroutine并发调用`ExecuteStream`（虽然当前代码中每次都通过`NewBackend`创建新实例，但factory.go中claude/codebuddy backend是包级单例）。`AutoResumeBackend`本身没有可变状态，所以实际上是安全的——每次`ExecuteStream`都创建新的child context和channel，状态全部在局部变量中。

6. **[P3] resume_split后eventCount重置但flushTicker未重置**：`chat.go:543`将`eventCount`重置为0，但`flushTicker`仍在运行。这不是bug（ticker只做增量flush，即使触发也只是多一次无效的UpdateStreamingMessage），但不够优雅。

7. **[P3] ExitPlanMode检测条件可能过于严格**：`auto_resume.go:73-74`要求`event.Tool.Done == true`。如果CLI输出中ExitPlanMode的tool_use事件`Done=false`（如仅收到content_block_start），则不会触发auto-resume。当前StreamParser在`content_block_stop`时设置`Done=true`，所以正常流程没问题。但如果CLI异常导致只有start没有stop，auto-resume不会触发，CLI会挂起。这是一个边界条件，实际发生概率低。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R3-001 | P1 | 健壮性 | resume_split时raw_output可能保存到错误消息ID | `chat.go:529-538` | 在FinalizeStreamingMessage之前保存raw_output，或使用finalize前缓存的messageID |
| R3-002 | P2 | 代码质量 | resume prompt "继续"硬编码为magic string | `auto_resume.go:120` | 提取为包级常量 `const autoResumePrompt = "继续"` |
| R3-003 | P2 | 代码质量 | ChatRequest字段逐个拷贝，新增字段易遗漏 | `auto_resume.go:119-129` | 改为值拷贝+覆盖：`resumeReq := origReq; resumeReq.Prompt = ...; resumeReq.Resume = true` |
| R3-004 | P2 | 架构 | resume_split未在SSE层转发，前端无法感知auto-resume | `chat_stream.go:75-149` | 添加resume_split case或在handler层转发一个前端可见的提示事件 |
| R3-005 | P2 | 健壮性 | forwardEvent丢弃content事件导致前端文本片段丢失 | `auto_resume.go:165-173` | 考虑增大buffer或对content事件使用阻塞发送+超时 |
| R3-006 | P2 | 代码质量 | goto phase1Done降低可读性 | `auto_resume.go:67,95,110` | 用`break`+label或提取phase1为独立函数 |
| R3-007 | P3 | 健壮性 | resume_split后flushTicker未重置 | `chat.go:543,457` | 无实际影响，但可考虑在resume_split处理中重置ticker |
| R3-008 | P3 | 架构 | 单层resume限制无文档/常量说明 | `auto_resume.go:141` | 添加注释或常量说明为什么Phase2不检测嵌套ExitPlanMode |
| R3-009 | P3 | 健壮性 | ExitPlanMode检测要求Done=true，CLI异常时可能漏检 | `auto_resume.go:73-74` | 添加超时机制：检测到ExitPlanMode start后，如果超时未收到stop则强制触发 |
| R3-010 | P3 | 代码质量 | innerCancel未在defer中调用 | `auto_resume.go:30` | 添加`defer innerCancel()`在goroutine内，或确认drain保证cancel后不需要 |

## 改进建议 (Top 3)

1. **修复resume_split时raw_output保存竞态 (R3-001)**：在`resume_split`处理中，先缓存当前streaming message ID，再调用FinalizeStreamingMessage，然后用缓存的ID保存raw_output。预期收益：消除消息持久化不一致的隐患，确保raw output总是关联到正确的DB记录。

2. **ChatRequest值拷贝替代逐字段赋值 (R3-003)**：将`auto_resume.go`中的resumeReq构建改为`resumeReq := origReq`后选择性覆盖。预期收益：防止未来ChatRequest新增字段时遗漏拷贝，减少维护负担，代码更简洁。

3. **SSE层增加resume_split/续传通知 (R3-004)**：在`chat_stream.go`中添加`resume_split` case，向前端发送一个提示事件（如`event: resume_split\ndata: {}`），让前端可以显示"正在自动续传..."状态。预期收益：提升用户体验透明度，让用户知道AI在自动恢复而非卡住。

## 亮点

- **两阶段流合并设计精巧**：在一个goroutine内用Phase1→Phase2的顺序状态机实现透明的auto-resume，外部调用者完全无感知，是一个教科书级的Decorator模式应用。

- **resume_split信号设计**：作为AI层→Handler层的层间信号，优雅地解决了"一个逻辑请求跨越两个CLI进程"的DB持久化问题，避免了复杂的两阶段提交。

- **cancel reason隔离**：AutoResume的innerCancel不会污染外层的cancel reason追踪，确保用户取消/disconnect的语义不被内部auto-resume操作干扰。这体现了对并发cancel语义的深入理解。

- **测试设计周到**：特别是`TestAutoResume_OuterCancelDuringResume`和`TestAutoResume_NoNestedExitPlanMode`，覆盖了边缘场景，mock backend设计简洁但足够灵活。
