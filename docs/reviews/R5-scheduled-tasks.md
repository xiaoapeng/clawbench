# R5: 定时任务流程 Review

> 日期: 2026-05-05
> 审查范围: 前端CRUD → Cron调度 → Agent执行 → 结果持久化

## 审查范围

| 文件 | 行号范围 | 职责 |
|------|----------|------|
| `web/src/components/task/TaskDrawer.vue` | 1-377 | 任务列表抽屉：加载/暂停/恢复/删除任务，未读标记 |
| `web/src/components/task/TaskFormDialog.vue` | 1-618 | 任务创建/编辑表单：cron预设、验证、提交 |
| `web/src/components/task/TaskExecDialog.vue` | 1-401 | 任务执行历史：列表视图、详情视图、手动触发 |
| `internal/handler/scheduler.go` | 1-251 | HTTP handler：任务CRUD API、执行历史查询 |
| `internal/handler/chat.go` | 594-932 | schedule-proposal检测、注入task_id、创建任务 |
| `internal/service/scheduler.go` | 1-491 | 核心调度器：cron注册/移除、任务执行、状态持久化 |
| `internal/service/database.go` | 1-271 | 数据库初始化：scheduled_tasks和task_executions表定义 |
| `internal/ai/factory.go` | 1-24 | 后端工厂：创建AI后端实例 |
| `internal/ai/cli_backend.go` | 1-225 | CLI后端：执行流、事件解析 |
| `internal/ai/accumulate.go` | 1-91 | 事件累积：content/thinking/tool_use块合并 |
| `internal/ai/interface.go` | 1-109 | 接口定义：ChatRequest.ScheduledExecution标志 |
| `internal/model/scheduler.go` | 1-26 | 数据模型：ScheduledTask结构体 |
| `cmd/server/main.go` | 398-406 | 启动初始化：创建、加载、启动调度器 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**层次清晰度：良好**

整体遵循 Handler → Service → AI Backend 的三层架构，职责边界明确：
- Handler层仅做HTTP解析、参数校验、错误映射
- Service层封装cron调度、任务状态机、执行编排
- AI层通过`AIBackend`接口解耦，`ScheduledExecution`标志阻止递归创建任务

**值得注意的设计决策：**

1. **`ScheduledExecution`标志的巧妙运用**（`interface.go:19`）：通过在`ChatRequest`中标记定时执行，在handler的finalize阶段跳过`<schedule-proposal>`检测，防止AI在定时任务输出中创建新的定时任务——形成无限递归。这是关键的安全阀门。

2. **`task_executions`独立存储**（`scheduler.go:302`）：执行结果不再写入`chat_history`，而是写入专用的`task_executions`表。这使得定时任务与聊天会话解耦，查询性能更好，避免污染聊天历史。

3. **全局单例调度器**（`scheduler.go:19`）：`GlobalScheduler`作为包级变量，在启动时初始化。虽然简单，但在单进程场景下足够。

**架构问题：**

- **Cron解析器与调度器配置不匹配**（P0，详见R5-001）：`cron.New(cron.WithSeconds())`配置6位cron，但所有解析使用`cron.ParseStandard()`（5位），导致调度器与解析器对cron表达式的理解不一致。
- **`executeTask`在无超时下运行**（P1，详见R5-002）：注释明确说"no timeout"，长时间运行的AI进程可能无限期占用资源。
- **Service层直接访问全局`DB`**（P2）：`scheduler.go`中`DB.Exec`散布多处，没有事务保护，也没有通过数据访问层抽象。

### ✨ 代码质量 (30%)

**正面：**

- 前端表单设计精良：`TaskFormDialog.vue`的cron预设/自定义切换、`detectPreset`逆向解析、智能默认值填充，用户体验出色
- `AccumulateBlock`的合并策略设计合理：tool_use作为自然边界，避免跨工具调用的文本合并
- 前端组件职责分明：`TaskDrawer`(列表)、`TaskFormDialog`(表单)、`TaskExecDialog`(执行历史)各司其职

**问题：**

- **正则表达式重复编译**（R5-003）：`detectAndCreateScheduleProposal`和`injectTaskIDIntoProposal`每次调用都重新编译相同的正则，且在同一个文本上两次匹配
- **前端API调用未封装**（R5-004）：`TaskDrawer.vue`中多处使用裸`fetch`，与项目已有的`apiGet/apiPost`工具函数不一致
- **错误处理不一致**（R5-005）：`PauseTask`/`RemoveTask`忽略`DB.Exec`返回的错误；`TriggerTask`返回404 for内部错误
- **注释残留**（R5-006）：`scheduler.go:138`有重复的`UpdateTask`注释，像是代码合并残留
- **前端`markAllTasksRead`不等待完成**（R5-007）：`TaskDrawer.vue:121`处`markAllTasksRead()`是async但没有await

### 🛡️ 健壮性 (40%)

**关键问题：**

1. **Cron并发竞态**（R5-001）：这是最严重的问题。`executeTask`在goroutine中运行，cron可能在前一次执行未完成时触发下一次。例如，一个每小时执行的任务如果执行超过1小时，就会有两个goroutine同时运行同一个task。没有任何互斥保护。

2. **`executeTask`使用陈旧数据更新状态**（R5-008）：`scheduler.go:309`使用`task.RunCount + 1`更新，但`task`是执行开始时从DB加载的快照。如果两次执行并发，后写入的会覆盖先写入的run_count增量。

3. **DB更新无事务保护**（R5-009）：`executeTask`中的`AddTaskExecution`和后续的`UPDATE scheduled_tasks`不在同一事务中。如果第一个成功但第二个失败，会出现执行记录存在但任务计数未更新的不一致。

4. **`PauseTask`/`ResumeTask`/`RemoveTask`的竞态**（R5-010）：这些操作先改cron entries map，再更新DB。如果DB更新失败，内存和持久化状态不一致。虽然cron entries已正确在mutex保护下操作，但DB操作在锁外。

5. **schedule-proposal注入风险**（R5-011）：`detectAndCreateScheduleProposal`直接信任AI输出的JSON内容来创建任务，没有对`cron_expr`做合理性验证（例如`* * * * *`每分钟执行）。恶意或错误的AI输出可能创建高频任务。

6. **`TriggerTask`不检查当前是否正在执行**（R5-012）：手动触发直接`go s.executeTask()`，不检查同任务是否已有执行中goroutine，可能导致并发执行。

7. **前端删除无确认反馈的竞态**（R5-013）：`TaskDrawer.vue`中`deleteTask`使用`confirm()`但在某些浏览器环境下可能被忽略，且删除后`loadTasks()`如果失败，UI显示旧数据。

8. **`serveTaskExecutions`时间解析可能失败**（R5-014）：`scheduler.go:238`使用`time.Parse(time.RFC3339, exec.CreatedAt)`，但SQLite的`CURRENT_TIMESTAMP`默认格式是`2006-01-02 15:04:05`，不是RFC3339。这会导致所有执行记录被标记为`isUnread=true`。

9. **前端`fetch`无认证**（R5-015）：`TaskDrawer.vue`/`TaskExecDialog.vue`/`TaskFormDialog.vue`中所有`fetch`调用都不带认证头。虽然可能有cookie机制，但与其他使用`apiGet/apiPost`的地方不一致。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R5-001 | **P0** | 健壮性 | Cron解析器与调度器配置不匹配：`cron.New(cron.WithSeconds())`创建6位cron调度器，但所有`cron.ParseStandard()`解析5位表达式。调度器期望6位但收到5位，第一段被当作秒而非分，导致执行时间完全错误 | `service/scheduler.go:31,81` | 移除`cron.WithSeconds()`改用`cron.New()`，或所有解析改用`cron.Parse()`（6位）。推荐前者，因为前端生成的cron都是5位 |
| R5-002 | P1 | 健壮性 | `executeTask`无超时：`context.WithCancel(context.Background())`意味着AI进程可能无限运行。如果CLI进程挂死，goroutine永远不退出 | `service/scheduler.go:263` | 添加`context.WithTimeout(ctx, 30*time.Minute)`，与聊天流的30分钟超时一致 |
| R5-003 | P2 | 代码质量 | 正则表达式每次调用重新编译：`detectAndCreateScheduleProposal`和`injectTaskIDIntoProposal`在同一请求中分别编译相同的正则，且对同一文本匹配两次 | `handler/chat.go:832,914` | 提取为包级变量`var scheduleProposalRe = regexp.MustCompile(...)`；合并两个函数为一次遍历 |
| R5-004 | P2 | 代码质量 | 前端定时任务组件使用裸`fetch`而非项目封装的`apiGet/apiPost`：3个Vue文件共15处裸`fetch`调用，缺少统一错误处理和认证 | `TaskDrawer.vue:98,113,146,155,166`; `TaskFormDialog.vue:311,317`; `TaskExecDialog.vue:142,161,179` | 迁移到`apiGet`/`apiPost`工具函数 |
| R5-005 | P1 | 代码质量 | 错误处理不一致：`PauseTask`/`RemoveTask`忽略`DB.Exec`错误；`serveTaskExecutions`时间解析失败静默忽略，导致所有记录显示为未读 | `service/scheduler.go:106,118,131`; `handler/scheduler.go:239` | 检查`DB.Exec`返回的`error`和`RowsAffected`；使用与`database.go`相同的双格式时间解析 |
| R5-006 | P3 | 代码质量 | 重复注释：`scheduler.go:138`有孤立的前导注释`// UpdateTask updates...`，与行149的完整注释重复 | `service/scheduler.go:138` | 删除行138的孤立注释 |
| R5-007 | P2 | 健壮性 | `markAllTasksRead`未await：`TaskDrawer.vue:176`处`markAllTasksRead()`是async调用但未await，抽屉可能在标记请求完成前关闭，导致未读状态不一致 | `TaskDrawer.vue:176` | 改为`await markAllTasksRead()` |
| R5-008 | **P0** | 健壮性 | 并发执行时run_count更新覆盖：`executeTask`使用快照`task.RunCount + 1`，如果同一任务两次执行并发，后完成的会覆盖先完成的计数增量（lost update） | `service/scheduler.go:309` | 改用SQL原子操作：`UPDATE scheduled_tasks SET run_count = run_count + 1 WHERE id = ?` |
| R5-009 | P1 | 健壮性 | `executeTask`中两个DB操作不在同一事务：`AddTaskExecution`和`UPDATE scheduled_tasks`分开执行，中间失败导致不一致 | `service/scheduler.go:303-343` | 使用`DB.Begin()`包裹为事务 |
| R5-010 | P1 | 健壮性 | PauseTask/RemoveTask先改内存后改DB：如果`DB.Exec`失败，cron entry已被移除但DB中任务状态未变，重启后任务会重新加载并执行 | `service/scheduler.go:98-119` | 先更新DB，成功后再移除cron entry；或在DB操作失败时回滚cron entry |
| R5-011 | P1 | 安全性 | schedule-proposal无cron频率限制：AI可以输出`* * * * *`创建每分钟执行的任务，可能被滥用导致资源耗尽 | `handler/chat.go:830-909` | 在`detectAndCreateScheduleProposal`中验证cron表达式间隔，拒绝频率过高的表达式（如<5分钟） |
| R5-012 | P1 | 健壮性 | `TriggerTask`不防重入：手动触发直接启动goroutine，不检查同任务是否已在执行中 | `service/scheduler.go:140-147` | 维护`executing` map，在执行中时返回错误或排队 |
| R5-013 | P2 | 健壮性 | 前端删除后`loadTasks`失败导致UI与后端不一致 | `TaskDrawer.vue:163-171` | 在`loadTasks`失败时保持旧列表不变（当前行为），或添加错误toast提示 |
| R5-014 | P1 | 健壮性 | `serveTaskExecutions`时间解析格式不匹配：SQLite `CURRENT_TIMESTAMP`格式为`2006-01-02 15:04:05`，但代码使用`time.RFC3339`解析，导致解析失败、所有执行记录被标记为未读 | `handler/scheduler.go:238` | 使用双格式解析（参照`database.go:248-251`的模式） |
| R5-015 | P2 | 安全性 | 前端定时任务API调用未使用统一认证方式 | TaskDrawer/TaskFormDialog/TaskExecDialog | 迁移到`apiGet/apiPost`确保认证一致性 |

## 改进建议 (Top 3)

1. **修复Cron解析器与调度器配置不匹配 + 并发执行保护**: 当前最严重的两个问题。`cron.WithSeconds()`与`ParseStandard()`不匹配会导致所有定时任务执行时间完全错误。同时，缺少并发执行保护会导致run_count丢失更新和资源泄漏。预期收益: 消除数据不一致和生产事故风险。

2. **添加执行超时和防重入机制**: `executeTask`无超时可能造成goroutine泄漏，`TriggerTask`不防重入可能造成同一任务并发执行。添加30分钟超时（与聊天一致）和执行中状态检查。预期收益: 提高系统可靠性，防止资源泄漏。

3. **统一DB操作的事务性和错误处理**: 将`executeTask`中的多个DB操作包裹在事务中；修复`PauseTask`/`RemoveTask`的内存-DB不一致风险；修复时间解析格式问题。预期收益: 消除数据不一致窗口，提高系统可靠性。

## 亮点

- **`ScheduledExecution`标志设计**: 简洁有效地防止定时任务递归创建，是一个聪明的安全阀门
- **前端cron预设UX**: `TaskFormDialog`的预设/自定义切换和`detectPreset`逆向解析提供了优秀的用户体验
- **`task_executions`独立存储**: 执行结果与聊天历史解耦，查询高效，不污染会话数据
- **`AccumulateBlock`的tool_use边界策略**: 将tool_use作为自然分隔符，避免跨工具调用的文本合并，语义正确
- **schedule-proposal自动注入task_id**: `injectTaskIDIntoProposal`让前端可以直接关联AI提议到已创建的任务，形成完整闭环
- **未读计数子查询**: `GetTasks`和`GetTaskByID`通过子查询计算unread_count，避免了额外的API调用
