# 定时任务执行历史：展示正在执行 + 中止支持

## 目标

在定时任务执行历史中展示"正在执行"的任务实例，并支持中止操作。最小化方案——"看得见、能停掉"为先，不展示AI实时输出流。

## 现状问题

| 维度 | 聊天会话 | 定时任务执行 |
|------|---------|------------|
| 运行状态追踪 | ✅ `activeSessions` + `sessionCancels` | ❌ fire-and-forget goroutine |
| 取消机制 | ✅ `POST /api/ai/chat/cancel` | ❌ cancel函数仅在goroutine内部 |
| 运行时可见性 | ✅ SSE实时流 | ❌ 执行完才写入DB |
| 僵尸进程防护 | ✅ `ForceCancelSession` | ❌ 删除任务不会停止执行中的goroutine |

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 实时信息丰富度 | 最小化：只显示状态+时间+中止按钮 | 复杂度可控，先做稳基础 |
| 前端获知运行状态 | 轮询（3s间隔，对话框打开期间） | 复用现有基础设施，开销可控 |
| 运行状态存储 | 内存Map | 重启时goroutine也死，无持久化需求 |
| 执行历史占位 | 前端拼接虚拟项 | DB无侵入，内存Map即真相源 |
| 中止API | 复用 `PUT /api/tasks/{id}` action机制 | 与pause/resume/trigger同风格 |
| 中止目标 | 指定executionID | 精确杀单个实例 |
| 并发执行 | 允许，但同一任务有运行实例时禁止"立即执行" | 避免资源滥用 |

## 后端设计

### 1. 内存Map结构

挂在 `Scheduler` 上：

```go
type RunningExecution struct {
    ID          string        // "exec-" + UUID
    TaskID      string
    CancelFunc  context.CancelFunc
    StartedAt   time.Time
    TriggerType string        // "auto" | "manual"
}

// Scheduler 新增字段
runningExecutions sync.Map  // key: executionID, value: *RunningExecution
```

### 2. executeTask() 改造

```go
func (s *Scheduler) executeTask(task *model.ScheduledTask, projectPath, triggerType string) {
    execID := generateExecutionID()  // "exec-" + UUID
    ctx, cancel := context.WithCancel(context.Background())

    running := &RunningExecution{
        ID:          execID,
        TaskID:      task.ID,
        CancelFunc:  cancel,
        StartedAt:   time.Now(),
        TriggerType: triggerType,
    }
    s.runningExecutions.Store(execID, running)
    defer func() {
        s.runningExecutions.Delete(execID)
        cancel()
    }()

    // chatReq.SessionID = execID  // 用 executionID 标识
    // 其余现有逻辑不变，ExecuteStream(ctx, ...) 接收这个 ctx
    // ...
}
```

**取消传播**：`ctx` 取消 → `ExecuteStream` 内部感知 → CLI 子进程被 kill → 事件通道关闭 → goroutine 自然退出。不需要走 `sessionCancels` 机制。

**取消后不写入 task_executions**（没有产出内容）。虚拟项从 Map 删除后前端下次轮询自然消失。

### 3. 查询接口

**扩展 `GET /api/tasks/{id}`**，追加 `runningExecutions` 数组：

```json
{
  "id": "task-xxx",
  "status": "active",
  "...现有字段...",
  "runningExecutions": [
    {
      "id": "exec-xxx",
      "startedAt": "2026-05-22T10:30:00Z",
      "triggerType": "auto"
    }
  ]
}
```

**扩展 `GET /api/tasks`**（批量列表），追加 `runningCount` 字段（从 Map 中按 taskID 统计），供 TaskDrawer 显示脉冲指示：

```json
{
  "tasks": [
    {
      "id": "task-xxx",
      "status": "active",
      "runningCount": 1,
      "...现有字段..."
    }
  ],
  "hasUnread": true
}
```

### 4. 中止接口

`PUT /api/tasks/{id}` body：

```json
{ "action": "cancel", "executionId": "exec-xxx" }
```

逻辑：
1. 从 `runningExecutions` Map 中取出对应 `RunningExecution`
2. 调用 `CancelFunc()`
3. goroutine 感知 context 取消后自然退出并从 Map 中删除
4. 返回 200
5. executionID 不存在/已结束 → 返回 404

### 5. 触发限制

`action: "trigger"` 时，检查 `runningExecutions` Map 中是否已有该 taskID 的运行实例：
- 有 → 返回 409 Conflict，body: `{"error": "task already has a running execution"}`
- 无 → 正常触发

### 6. 删除正在执行的任务

`DELETE /api/tasks/{id}` 增加逻辑：删除前扫描 `runningExecutions`，对该 taskID 的所有运行实例调 `CancelFunc()`，杀掉 goroutine 后再删除。防止孤儿进程。

### 7. 辅助方法

```go
// 获取指定任务的运行实例（前端展示用，不含 CancelFunc）
func (s *Scheduler) GetRunningExecutions(taskID string) []RunningExecutionView

// 获取所有任务的运行计数（批量列表用）
func (s *Scheduler) GetRunningCounts() map[string]int  // taskID -> count

// 中止指定执行实例
func (s *Scheduler) CancelExecution(executionID string) error

// 中止指定任务的所有执行实例（删除任务时调用）
func (s *Scheduler) CancelAllExecutions(taskID string)
```

## 前端设计

### 1. TaskExecDialog.vue 改造

**新增数据**：

```typescript
interface RunningExec {
  id: string
  startedAt: string
  triggerType: 'auto' | 'manual'
}

const runningExecutions = ref<RunningExec[]>([])
const pollTimer = ref<number | null>(null)
```

**轮询逻辑**：

- 对话框打开：`loadExecutions()` + `loadRunningStatus()`，启动 `setInterval(loadRunningStatus, 3000)`
- 对话框关闭：`clearInterval`，清空 `runningExecutions`
- `loadRunningStatus()`：调 `GET /api/tasks/{id}`，提取 `runningExecutions`
- 触发"立即执行"后：立即调一次 `loadRunningStatus()`

**列表渲染**：在 executions 列表头部拼接虚拟项：

```html
<!-- 正在执行的虚拟项 -->
<div v-for="exec in runningExecutions" :key="exec.id" class="exec-item running">
  <span class="status-dot running" />  <!-- 绿色脉冲动画 -->
  <span class="trigger-badge">{{ exec.triggerType === 'manual' ? '手动' : '自动' }}</span>
  <span class="time">{{ formatRelative(exec.startedAt) }}</span>
  <button class="cancel-btn" @click="cancelExecution(exec.id)">中止</button>
</div>

<!-- 已完成的真实记录（现有逻辑不变） -->
```

**中止操作**：

```typescript
async function cancelExecution(execId: string) {
  // 确认弹窗防误触
  if (!confirm('确定中止此执行？')) return
  await apiPut(`/api/tasks/${taskId}`, { action: 'cancel', executionId: execId })
  await loadRunningStatus()  // 立即刷新
}
```

**"立即执行"按钮**：

```html
<button
  :disabled="runningExecutions.length > 0"
  @click="triggerTask"
>
  {{ runningExecutions.length > 0 ? '执行中...' : '立即执行' }}
</button>
```

trigger 请求返回 409 时，toast 提示"任务正在执行中"。

### 2. TaskDrawer.vue 改造

任务列表中，有运行实例的任务显示脉冲绿点指示：

```html
<span v-if="task.runningCount > 0" class="running-indicator" />
```

`GET /api/tasks` 返回的 `runningCount` 字段驱动。

### 3. UI 细节

- running 项：绿色脉冲圆点 + "执行中" 文字，与已完成项视觉区分
- 中止按钮带确认（防误触）
- running 项不显示摘要和 metadata（还没产出）
- "立即执行"按钮加 1s 防抖

## 边界情况

| 场景 | 处理 |
|------|------|
| 中止已结束的执行 | 后端404，前端静默刷新 |
| 删除正在执行的任务 | 先杀所有运行实例再删除 |
| 暂停正在执行的任务 | 只停cron调度，不中止当前实例 |
| 前端轮询竞态 | 允许并发执行，trigger按钮有运行实例时禁用 |
| 服务器重启 | goroutine全死，Map清空，无需额外处理 |
| 快速连击"立即执行" | 按钮禁用+1s防抖 |

## 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/service/scheduler.go` | 新增 RunningExecution 结构、runningExecutions Map、executeTask 注册/清理、查询/中止辅助方法、trigger 409 校验、删除时杀实例 |
| `internal/handler/scheduler.go` | action:"cancel" 处理、扩展 task 详情/列表响应字段、trigger 409 返回 |
| `internal/model/scheduler.go` | RunningExecutionView 结构、task 响应 JSON tag |
| `web/src/components/task/TaskExecDialog.vue` | 轮询逻辑、虚拟项渲染、中止按钮、立即执行禁用 |
| `web/src/components/task/TaskDrawer.vue` | 运行指示器绿点 |
| `web/src/stores/app.ts` | task 类型增加 runningCount 字段 |
