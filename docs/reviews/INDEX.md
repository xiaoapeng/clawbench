# ClawBench 全面代码 Review 汇总索引（二次验证版）

> 审查日期: 2026-05-05
> 二次验证日期: 2026-05-05
> 审查范围: 12个流程、130+文件、约20000+行代码
> 审查团队: 12个并行审查Agent
> 验证团队: 5个并行验证Agent（4个分类验证 + 1个P0专项验证）

## 验证结论总览

| 原始级别 | 总数 | 确认 | 夸大 | 误报 | 降级建议 |
|----------|------|------|------|------|----------|
| P0 | 5 | 5 | 0 | 0 | 3个应降为P1/P2（见下方） |
| P1 安全 | 10 | 5 | 4 | 1 | — |
| P1 并发 | 8 | 3 | 2 | 2 | — |
| P1 数据 | 7 | 4 | 1 | 2 | — |
| P1 资源 | 6 | 6 | 0 | 0 | — |
| P1 功能 | 8 | 6 | 2 | 0 | — |
| **合计** | **44** | **29** | **9** | **5** | |

---

## P0 问题验证结论（必须立即修复 → 修正后）

| ID | 原始描述 | 验证结论 | 修正后级别 | 修正理由 |
|----|----------|----------|------------|----------|
| R4-001 | ForceCancelSession 从未被调用 | ✅ **确认** | **P1** | Bug真实，但不是功能失效。AI进程会自然完成，只是缺少主动清理。影响是资源浪费而非功能阻断 |
| R5-001 | Cron解析器与调度器不匹配，"所有定时任务执行时间完全错误" | ⚠️ **确认但严重夸大** | **P2** | WithSeconds()是死代码，但5位表达式通过ParseStandard()正确解析。定时任务实际按预期执行，仅秒级精度不可用 |
| R5-008 | 并发run_count丢失更新 | ✅ **确认** | **P2** | Bug真实，但仅手动触发+自动执行重叠时触发，纯cron路径无影响 |
| R7-001 | SSH密码认证无暴力破解防护 + 信息泄露 | ✅ **确认** | **P1** | 安全缺陷真实，但非功能性Bug。内网使用风险低 |
| R10-002 | /api/watch-dir和/api/project未包裹Auth | ✅ **确认** | **P1** | 安全缺陷真实。无密码模式下不影响，有密码模式是认证绕过 |

### 关键洞察：为什么Bug存在但系统正常运行

所有5个P0都不是**功能性阻断Bug**——没有一个是"系统跑不起来"的问题：
- R4-001：AI进程自然完成后清理，只是不主动杀
- R5-001：5位表达式正确工作，WithSeconds()是死代码
- R5-008：仅手动+自动重叠时触发
- R7-001/R10-002：安全加固缺失，功能本身正常

---

## P1 安全类验证结论（10个）

| ID | 原始描述 | 验证结论 | 修正后级别 | 验证要点 |
|----|----------|----------|------------|----------|
| R7-002 | SSH默认绑定0.0.0.0 | ✅ **确认** | P1 | `server.go:53` 硬编码 `0.0.0.0`，无配置项覆盖 |
| R7-006 | /api/ssh/info无需认证暴露SSH信息 | ✅ **确认(低)** | P2 | 信息泄露真实，但开发者有意设计（注释写明"not sensitive"），且不含密码 |
| R8-018 | basePath参数可覆盖项目路径 | ✅ **确认** | **P0** | **最高危**：ValidatePath只校验相对basePath内的路径，不校验basePath本身是否在WatchDir内。认证用户可删除/重命名任意文件 |
| R8-016 | serveProjectsCreate接受绝对路径 | ⚠️ **夸大** | P3 | 有WatchDir边界检查(file.go:460-463)，绝对路径被限制在WatchDir内 |
| R9-001 | SHA/commit参数未验证，可注入git flag | ❌ **误报** | — | Go的`exec.Command`不调用shell，参数直接传递给OS。无法注入flag |
| R9-002 | v-html渲染diff HTML，XSS风险 | ⚠️ **夸大** | P2 | diff.ts使用escapeHtml()转义用户内容，highlight.js输出被认为是安全的。加DOMPurify是纵深防御，非紧急修复 |
| R10-001 | Session固定：同密码产生相同token | ⚠️ **夸大** | P2 | 不是Session固定（攻击者无法设置受害者session），实为"无token轮换"。单用户工具影响低 |
| R10-003 | Cookie未设置Secure标志 | ✅ **确认(低)** | P2 | 确认无Secure标志，但无TLS模式下设了反而不能用。应条件性设置 |
| R12-001 | getPassword()暴露明文密码给JS | ✅ **确认** | P1 | XSS可窃取密码，Android WebView场景下风险真实 |
| R12-002 | setSSHPassword()明文传入原生层 | ⚠️ **夸大** | P3 | JS-to-Native IPC是同应用内通信，不跨越信任边界 |

### 安全类重大发现：R8-018 应升级为 P0

R8-018（basePath路径穿越）是本次验证中发现的**最高危安全漏洞**：
- 认证用户可通过basePath参数指定任意目录（如`/etc`）
- ValidatePath只校验请求路径在basePath内，不校验basePath本身
- 可删除/重命名服务器上任意文件
- **建议从P1升级为P0，立即修复**

---

## P1 并发/竞态类验证结论（8个）

| ID | 原始描述 | 验证结论 | 修正后级别 | 验证要点 |
|----|----------|----------|------------|----------|
| R1-001 | SSE channel满时静默丢queue事件 | ✅ **确认** | P2 | 非阻塞发送确认，但有DB持久化和onLoadHistory兜底，仅queue_update UI状态可能过时 |
| R1-003 | CancelSession与TrySetSessionRunning竞态 | ✅ **确认** | P1 | 三步操作(delete cancel → cancel ctx → set not-running)不原子，新请求可能被错误标记 |
| R2-001 | 重连不重置reconnectAttempts | ❌ **误报** | — | `connectStream()`在line 198显式重置`reconnectAttempts = 0` |
| R2-004 | queue_consume后lastIndex闭包竞争 | ❌ **误报** | — | JavaScript单线程，SSE事件处理器在同事件循环执行，无竞态 |
| R4-003 | CancelSession与TrySetSessionRunning竞态 | ⚠️ **夸大** | P2 | 与R1-003是同一竞态的重复报告，极窄窗口 |
| R4-004 | SSE checkTicker可能在done后多发cancelled | ⚠️ **夸大** | P3 | select竞争最坏结果是发cancelled替代done，两者都是终止事件 |
| R5-010 | PauseTask/RemoveTask先改内存后改DB | ✅ **确认** | P2 | DB失败时任务从cron移除但DB仍显示active，重启后重现 |
| R7-003 | checkAllPorts快照竞态 | ✅ **确认(低)** | P3 | 已有ok检查处理端口缺失，最坏5秒陈旧 |

---

## P1 数据一致性类验证结论（7个）

| ID | 原始描述 | 验证结论 | 修正后级别 | 验证要点 |
|----|----------|----------|------------|----------|
| R2-002 | 重连后SSE事件不回放 | ⚠️ **夸大** | P3 | 断连期间内容盲区是暂时的，done事件触发onLoadHistory()从DB重载，最终一致性保证 |
| R2-003 | SendSessionEvent非阻塞丢失导致spinner永转 | ❌ **误报** | — | 64缓冲channel足够，前端有30秒TOOL_USE_TIMEOUT_MS兜底，不会永转 |
| R3-001 | resume_split时raw_output可能保存到错误消息ID | ✅ **确认** | P1 | GetStreamingMessageID用`streaming=0 ORDER BY id DESC`查询，不绑定特定messageID |
| R5-009 | AddTaskExecution和UPDATE不在同一事务 | ✅ **确认** | P2 | 崩溃时execution记录存在但run_count/status陈旧 |
| R5-014 | RFC3339 vs CURRENT_TIMESTAMP格式不匹配 | ❌ **误报** | — | SQLite驱动处理格式归一化，DATETIME比较在两种格式间正常工作 |
| R6-001 | TTS缓存键仅基于文本SHA256 | ✅ **确认** | P2 | 同扩展名引擎(如MiniMax+Edge均.mp3)切换时会命中错误缓存 |
| R8-001 | ServeFileEditLine非原子读写 | ✅ **确认** | P2 | 经典TOCTOU，但单用户移动工作站场景下并发编辑概率极低 |

---

## P1 资源泄漏+功能缺陷类验证结论（14个）

| ID | 原始描述 | 验证结论 | 修正后级别 | 验证要点 |
|----|----------|----------|------------|----------|
| R1-002 | resetStreamTimeout在guard之前调用 | ✅ **确认** | P3 | 仅延迟超时60秒，guard仍会返回 |
| R4-002 | DeleteSession不取消运行中session | ✅ **确认** | P1 | 孤儿goroutine+CLI进程泄漏，与R4-001相关 |
| R5-002 | executeTask无超时 | ✅ **确认** | P1 | 代码注释明确承认"no timeout"，CLI挂起则goroutine永久阻塞 |
| R5-012 | TriggerTask不防重入 | ✅ **确认** | P2 | 无running检查，多次手动触发产生并发执行 |
| R7-004 | SSH连接无限流 | ✅ **确认** | P1 | 无连接上限，恶意客户端可耗尽FD/goroutine |
| R7-005 | SSH channel io.Copy无超时 | ✅ **确认** | P1 | backend挂起时两个goroutine永久阻塞 |
| R5-011 | schedule-proposal无cron频率限制 | ✅ **确认** | P1 | AI可创建`* * * * *`每分钟执行的任务 |
| R6-002 | TTS引擎只验证文件存在不检查大小 | ✅ **确认** | P3 | 0字节音频被缓存，体验差但非崩溃 |
| R8-002 | ServeFileDelete忽略os.RemoveAll错误 | ✅ **确认** | P3 | 静默返回200，客户端误以为删除成功 |
| R8-003 | ListFiles递归遍历无深度/数量限制 | ✅ **确认** | P2 | 大项目（node_modules等）可能OOM |
| R9-003 | Git搜索全量加载所有commit | ✅ **确认** | P2 | 客户端内存/延迟问题，需后端`git log --grep`支持 |
| R11-001 | JSON解码未检查错误，空Password绕过认证 | ⚠️ **夸大** | P3 | 空Password的hash不等于配置密码的hash，无法绕过认证。仅代码质量问题 |
| R11-002 | 静态盐值"clawbench-salt" | ✅ **确认** | P2 | SHA-256+静态盐不适合密码存储，但单用户本地工具影响低 |
| R12-003 | Bridge同步调用无超时保护 | ⚠️ **夸大** | P3 | Android WebView JS Bridge本身是同步设计，简单boolean检查不应阻塞 |

---

## 误报清单（5个，可从修复计划中移除）

| ID | 原始描述 | 误报原因 |
|----|----------|----------|
| R9-001 | SHA/commit参数可注入git flag | Go `exec.Command`不调用shell，参数直接传递，无法注入 |
| R2-001 | 重连不重置reconnectAttempts | `connectStream()` line 198显式重置计数器 |
| R2-004 | queue_consume后lastIndex闭包竞争 | JavaScript单线程，无并发访问可能 |
| R2-003 | SendSessionEvent非阻塞导致spinner永转 | 64缓冲channel + 前端30秒超时兜底 |
| R5-014 | RFC3339 vs CURRENT_TIMESTAMP格式不匹配 | SQLite驱动处理格式归一化，比较正常 |

---

## 修正后优先级排序与并发执行计划

### 修正原则
1. 原P0中仅R8-018（basePath路径穿越）和R10-002（Auth缺失）是真正需要紧急修复的安全漏洞
2. R5-001（Cron不匹配）降为P2——功能正常，仅死代码
3. 合并重复/相关问题（如R1-003与R4-003同一竞态）
4. 按文件/模块分组以最大化并发效率

---

### Phase 1: 紧急安全修复（Day 1-2，可全部并行）

| 并行轨道 | 问题ID | 修复内容 | 涉及文件 | 预估工时 | 依赖 |
|----------|--------|----------|----------|----------|------|
| **Track A: 路由Auth** | R10-002 + R7-006 | 为`/api/watch-dir`、`/api/project`、`/api/ssh/info`添加Auth中间件 | `handler/handler.go` | 0.5h | 无 |
| **Track B: 路径穿越** | R8-018 | ValidatePath增加basePath必须在WatchDir内的校验 | `handler/file_ops.go`, `model/path.go` | 1h | 无 |
| **Track C: SSH加固** | R7-001 + R7-002 | SSH添加登录限速(5次/分钟/IP) + 默认绑定127.0.0.1 + 添加bind_address配置 | `ssh/server.go`, `model/config.go` | 3h | 无 |
| **Track D: Cookie安全** | R10-003 | 条件性设置Cookie Secure标志(当TLS启用时) | `handler/auth.go` | 0.5h | 无 |

**4条轨道零依赖，可4个Agent完全并行执行。**

---

### Phase 2: 核心可靠性修复（Day 3-5，3条并行轨道）

| 并行轨道 | 问题ID | 修复内容 | 涉及文件 | 预估工时 | 依赖 |
|----------|--------|----------|----------|----------|------|
| **Track E: Session清理** | R4-001 + R4-002 | SSE断开30s后调ForceCancelSession + DeleteSession取消运行中session | `handler/chat_stream.go`, `service/chat.go` | 3h | 无 |
| **Track F: Session竞态** | R1-003 + R4-003 | CancelSession整体包裹activeMu，使三步操作原子化 | `service/session_runtime.go` | 2h | 无（但与Track E同文件session_runtime.go，需串行或协调） |
| **Track G: 定时任务可靠性** | R5-002 + R5-008 + R5-009 + R5-010 + R5-011 + R5-012 | executeTask加30min超时 + run_count用SQL原子更新 + 操作包裹事务 + DB优先内存后改 + cron最小间隔5min + TriggerTask防重入 | `service/scheduler.go` | 4h | 无 |

**依赖说明：**
- Track E 和 Track F 都修改 `session_runtime.go`，但不同函数（ForceCancelSession调用点 vs CancelSession锁范围），可协调后并行
- Track G 独立修改 `scheduler.go`，与其他轨道零冲突

**推荐并发方案：Track G 先行（无冲突），Track E 和 Track F 串行执行（同文件）**

---

### Phase 3: 安全与健壮性增强（Day 6-10，4条并行轨道）

| 并行轨道 | 问题ID | 修复内容 | 涉及文件 | 预估工时 | 依赖 |
|----------|--------|----------|----------|----------|------|
| **Track H: SSH健壮性** | R7-004 + R7-005 | SSH连接限流(max 20) + channel io.Copy加30s超时 | `ssh/server.go` | 2h | 无 |
| **Track I: TTS缓存** | R6-001 + R6-002 | 缓存键加engine+voice+speed + 验证文件大小>0 | `handler/tts.go`, `speech/minimax.go` 等 | 1h | 无 |
| **Track J: 文件安全** | R8-001 + R8-002 + R8-003 | ServeFileEditLine原子化(temp+rename) + 检查RemoveAll错误 + ListFiles加深度/数量限制 | `handler/file_ops.go`, `handler/file.go` | 3h | 无 |
| **Track K: 前端修复** | R1-002 + R9-003 | tool_use handler中resetStreamTimeout移到guard后 + Git搜索加commit数量限制或后端搜索API | `useChatStream.ts`, `GitHistoryDrawer.vue` | 2h | 无 |

---

### Phase 4: 代码质量与长期改进（Week 3-4，可按需并行）

| 并行轨道 | 问题ID | 修复内容 | 涉及文件 | 预估工时 |
|----------|--------|----------|----------|----------|
| **Track L: 认证改进** | R10-001 + R11-001 + R11-002 | 添加logout端点 + JSON解码错误检查 + 密码哈希提取为共享函数(长期迁移bcrypt) | `handler/auth.go`, `cmd/server/main.go` | 2h |
| **Track M: SSE可靠性** | R2-002 + R1-001 | 重连后HTTP poll补齐 + 终止事件(done/cancelled)用带超时阻塞发送 | `useChatStream.ts`, `service/session_runtime.go` | 4h |
| **Track N: Android安全** | R12-001 | 实现performLogin()让密码不离开Java层 | Android native code | 4h |
| **Track O: 死代码清理** | R5-001 | 移除WithSeconds()，保持ParseStandard()一致性 | `service/scheduler.go` | 0.5h |
| **Track P: resume修复** | R3-001 | resume_split前缓存messageID而非事后查询 | `handler/chat.go` | 1h |

---

## 并发执行总览

```
Day 1-2 (Phase 1): 4个Agent完全并行
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ Track A    │ │ Track B    │ │ Track C    │ │ Track D    │
│ Auth路由   │ │ 路径穿越   │ │ SSH加固    │ │ Cookie安全 │
│ handler.go │ │ file_ops   │ │ server.go  │ │ auth.go    │
└────────────┘ └────────────┘ └────────────┘ └────────────┘

Day 3-5 (Phase 2): 2个Agent并行（Track E/F串行后并行）
┌────────────────────────┐ ┌────────────┐
│ Track E → Track F      │ │ Track G    │
│ Session清理 + 竞态修复 │ │ 定时任务6合1│
│ chat_stream+runtime    │ │ scheduler  │
└────────────────────────┘ └────────────┘

Day 6-10 (Phase 3): 4个Agent完全并行
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ Track H    │ │ Track I    │ │ Track J    │ │ Track K    │
│ SSH健壮性  │ │ TTS缓存    │ │ 文件安全   │ │ 前端修复   │
│ server.go  │ │ tts.go     │ │ file_ops   │ │ TS/Vue     │
└────────────┘ └────────────┘ └────────────┘ └────────────┘

Week 3-4 (Phase 4): 5个Agent按需并行
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Track L  │ │ Track M  │ │ Track N  │ │ Track O  │ │ Track P  │
│ 认证改进 │ │ SSE可靠  │ │ Android  │ │ 死代码   │ │ resume   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### 文件冲突矩阵

| 文件 | Phase 1 | Phase 2 | Phase 3 | 冲突处理 |
|------|---------|---------|---------|----------|
| `handler/handler.go` | Track A | — | — | 无冲突 |
| `handler/file_ops.go` | Track B | — | Track J | Phase间无冲突 |
| `ssh/server.go` | Track C | — | Track H | Phase间无冲突 |
| `service/session_runtime.go` | — | Track E+F | Track M | Track E和F需串行 |
| `service/scheduler.go` | — | Track G | Track O | Phase间无冲突 |
| `handler/auth.go` | Track D | — | Track L | Phase间无冲突 |

### 总工时估算

| Phase | 串行工时 | 并行后工时 | 加速比 |
|-------|----------|------------|--------|
| Phase 1 | 5h | 3h | 1.7x |
| Phase 2 | 9h | 6h | 1.5x |
| Phase 3 | 8h | 3h | 2.7x |
| Phase 4 | 11.5h | 4h | 2.9x |
| **合计** | **33.5h** | **16h** | **2.1x** |

---

## 审查文件列表

| 编号 | 流程 | 文件 | 问题总数 | P0 | P1 | P2 | P3 |
|------|------|------|----------|----|----|----|----|
| R1 | Chat 主流程 | [R1-chat-main-flow.md](R1-chat-main-flow.md) | 25 | 0 | 3 | 12 | 10 |
| R2 | SSE 流式传输 | [R2-sse-streaming.md](R2-sse-streaming.md) | 16 | 0 | 4 | 8 | 4 |
| R3 | Auto-Resume | [R3-auto-resume.md](R3-auto-resume.md) | 10 | 0 | 1 | 5 | 4 |
| R4 | Session 管理 | [R4-session-management.md](R4-session-management.md) | 18 | 1 | 5 | 9 | 3 |
| R5 | 定时任务 | [R5-scheduled-tasks.md](R5-scheduled-tasks.md) | 15 | 2 | 5 | 6 | 2 |
| R6 | TTS 语音 | [R6-tts-voice-flow.md](R6-tts-voice-flow.md) | 16 | 0 | 2 | 9 | 5 |
| R7 | SSH/端口转发 | [R7-ssh-port-forward.md](R7-ssh-port-forward.md) | 17 | 1 | 5 | 7 | 4 |
| R8 | 文件管理 | [R8-file-management.md](R8-file-management.md) | 27 | 0 | 3 | 14 | 10 |
| R9 | Git 历史 | [R9-git-history.md](R9-git-history.md) | 16 | 0 | 4 | 8 | 4 |
| R10 | 认证流程 | [R10-auth-flow.md](R10-auth-flow.md) | 14 | 1 | 2 | 5 | 6 |
| R11 | 配置/默认值 | [R11-config-defaults.md](R11-config-defaults.md) | 16 | 0 | 3 | 9 | 4 |
| R12 | Android Bridge | [R12-android-bridge.md](R12-android-bridge.md) | 12 | 0 | 3 | 6 | 3 |
| **合计** | | | **202** | **5** | **40** | **98** | **59** |

---

## 跨流程共性问题

### 1. 全局可变状态泛滥 (5个流程受影响)

`session_runtime.go` 的4个独立全局变量、`service.ProxyService` 全局单例、`model` 包12+个包级var、TTS的`speechProvider`/`summarizer`全局变量。缺少封装和依赖注入，导致：
- 测试困难（无法隔离/替代）
- 状态一致性靠隐式约定
- 无法支持多实例

**受影响流程**: R4(Session), R7(SSH), R11(配置), R6(TTS), R1(Chat)

### 2. 认证/安全边界不完整 (6个流程受影响)

多个API端点缺少Auth中间件（`/api/watch-dir`, `/api/project`, `/api/ssh/info`），密码处理存在多处缺陷（明文存储、静态盐值、无速率限制），Android Bridge暴露密码给JS层。

**受影响流程**: R10(认证), R7(SSH), R12(Android), R11(配置), R8(文件), R9(Git)

### 3. 非原子DB操作 (4个流程受影响)

多处DB操作不在事务中（scheduler executeTask、proxy RegisterPort、file ServeFileEditLine），内存状态与DB状态更新非原子（PauseTask/RemoveTask），导致失败时数据不一致。

**受影响流程**: R5(定时任务), R7(SSH), R8(文件), R4(Session)

### 4. 并发竞态条件 (5个流程受影响)

CancelSession与TrySetSessionRunning竞态、SSE事件丢失/乱序、checkAllPorts快照竞态、executeTask并发执行无互斥、ListFiles无并发控制。

**受影响流程**: R1(Chat), R2(SSE), R4(Session), R5(定时任务), R7(SSH)

### 5. 资源泄漏风险 (4个流程受影响)

AI僵尸进程（ForceCancelSession未被调用）、SSH连接/goroutine无限增长、定时任务goroutine无超时、TTS摘要器流式读取无上限。

**受影响流程**: R4(Session), R5(定时任务), R7(SSH), R6(TTS)

### 6. i18n不一致 (4个流程受影响)

Go后端多处硬编码中文字符串（`"会话未在运行"`, `"文件消息"`, `"新会话"`, `"[当前文件: %s]"`），与前端vue-i18n国际化架构不一致。错误消息应使用reason code。

**受影响流程**: R1(Chat), R2(SSE), R4(Session), R9(Git)

### 7. 前端类型安全不足 (4个流程受影响)

消息流水线大量`any`类型（`parseMessages(rawMsgs: any[])`），AndroidNative全部`(window as any)`，gitGraph.ts无TypeScript类型注解，API响应缺少统一类型定义。

**受影响流程**: R1(Chat), R9(Git), R12(Android), R8(文件)

---

## 各流程评分总览

| 流程 | 架构设计 | 代码质量 | 健壮性 | 综合 |
|------|----------|----------|--------|------|
| R1 Chat 主流程 | 8/10 | 7.5/10 | 8/10 | **7.8** |
| R2 SSE 流式传输 | 8/10 | 7.5/10 | 7.5/10 | **7.7** |
| R3 Auto-Resume | 8.5/10 | 8/10 | 7.5/10 | **8.0** |
| R4 Session 管理 | 7.5/10 | 7/10 | 7/10 | **7.2** |
| R5 定时任务 | 7/10 | 6.5/10 | 5.5/10 | **6.3** |
| R6 TTS 语音 | 8/10 | 7.5/10 | 7/10 | **7.5** |
| R7 SSH/端口转发 | 7.5/10 | 7/10 | 6.5/10 | **7.0** |
| R8 文件管理 | 7/10 | 7/10 | 7/10 | **7.0** |
| R9 Git 历史 | 7/10 | 7/10 | 6.5/10 | **6.8** |
| R10 认证流程 | 7/10 | 7.5/10 | 6.5/10 | **7.0** |
| R11 配置/默认值 | 7.5/10 | 7.5/10 | 7/10 | **7.3** |
| R12 Android Bridge | 7/10 | 7/10 | 7/10 | **7.0** |
| **加权平均** | **7.5** | **7.3** | **7.1** | **7.3** |

---

## 总体评价

ClawBench是一个架构清晰、设计精良的项目，在许多方面展现了出色的工程实践：

**核心优势**：
- AI Backend抽象（Decorator模式、策略模式）是教科书级设计
- SSE三层降级策略（重连→轮询→DB）覆盖了所有已知中断场景
- useSessionIdentity的IoC模式解决了Vue跨组件状态共享的难题
- 零配置启动理念贯穿始终，用户体验友好
- 前后端对称的Block合并逻辑保证了数据一致性

**主要风险（二次验证修正后）**：
- ~~定时任务系统存在严重的配置错误（Cron不匹配）~~ → WithSeconds()是死代码，定时任务实际按预期工作
- **R8-018 basePath路径穿越是真正的最高危漏洞**（原P1，应升级P0）
- 安全边界不完整（未认证API端点、SSH暴力破解无防护）
- AI僵尸进程泄漏是最大的可靠性隐患
- Session竞态条件是最值得修复的并发问题

**建议路线图（修正后）**：
1. **Day 1-2**: 4轨道并行修复紧急安全问题（Auth路由、路径穿越、SSH加固、Cookie安全）
2. **Day 3-5**: 2轨道并行修复核心可靠性（Session清理+竞态、定时任务6合1）
3. **Day 6-10**: 4轨道并行修复健壮性（SSH限流、TTS缓存、文件安全、前端修复）
4. **Week 3-4**: 5轨道按需并行代码质量改进（认证、SSE、Android、死代码、resume）
