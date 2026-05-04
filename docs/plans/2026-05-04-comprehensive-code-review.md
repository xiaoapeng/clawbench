# ClawBench 全面代码 Review 计划

> 创建日期: 2026-05-04
> 执行时间: 2026-05-05 03:00 (凌晨)
> 执行方式: 一次全部，逐行精读，独立文件输出
> 预计耗时: 6-8 小时

## 总体原则

- **每次只看一个流程**，但追踪完整上下游
- **三维度均衡**：架构设计（30%）+ 代码质量（30%）+ Bug/健壮性（40%）
- **逐行精读**：每个文件逐行审读，不跳过任何代码
- **独立文件输出**：每个 review 独立一个 Markdown 文件

## 严重度分级

| 级别 | 含义 | 示例 |
|------|------|------|
| P0 | 数据丢失/安全漏洞/生产崩溃 | SQL注入、goroutine泄漏导致OOM、未校验路径导致任意文件读取 |
| P1 | 功能异常/可靠性问题 | SSE断连后消息丢失、竞态导致重复执行、资源泄漏 |
| P2 | 代码质量/可维护性问题 | 接口边界模糊、重复代码、错误吞没、过度耦合 |
| P3 | 改进建议/风格优化 | 命名改善、注释补充、小重构、性能微优 |

## Review 执行顺序与排期

### 第一梯队：核心链路（预计 1.5-2h）

#### R1: Chat 主流程 ⭐⭐⭐⭐⭐
- **预估耗时**: 45min
- **核心文件** (~35个):
  - 前端入口: `web/src/components/chat/ChatInputBar.vue` (1118行)
  - 编排层: `web/src/components/chat/ChatPanel.vue` (712行)
  - 会话管理: `web/src/composables/useChatSession.ts` (506行)
  - SSE连接: `web/src/composables/useChatStream.ts` (492行)
  - 渲染: `web/src/composables/useChatRender.ts` (326行)
  - 会话身份: `web/src/composables/useSessionIdentity.ts` (212行)
  - 自动语音: `web/src/composables/useAutoSpeech.ts` (285行)
  - 文件上传: `web/src/composables/useFileUpload.ts` (164行)
  - Agent解析: `web/src/composables/useAgents.ts` (53行)
  - 引用提问: `web/src/composables/useQuoteQuestion.ts` (197行)
  - API工具: `web/src/utils/api.ts` (31行)
  - 路由注册: `internal/handler/handler.go` (166行)
  - Chat处理: `internal/handler/chat.go` (1055行)
  - SSE中继: `internal/handler/chat_stream.go` (171行)
  - Session API: `internal/handler/chat_session.go` (148行)
  - 历史API: `internal/handler/chat_history.go` (129行)
  - Agent API: `internal/handler/agent.go` (18行)
  - 队列API: `internal/handler/queue.go` (112行)
  - 运行时: `internal/service/session_runtime.go` (173行)
  - 消息持久化: `internal/service/chat.go` (374行)
  - 数据库: `internal/service/database.go` (270行)
  - 队列服务: `internal/service/queue.go` (109行)
  - 数据模型: `internal/model/chat.go` (51行), `internal/model/agent.go` (116行), `internal/model/errors.go` (90行), `internal/model/config.go` (102行)
  - AI接口: `internal/ai/interface.go` (89行)
  - 工厂: `internal/ai/factory.go` (23行)
  - CLI后端: `internal/ai/cli_backend.go` (224行)
  - 流解析: `internal/ai/stream_parser.go` (329行)
  - 块累加: `internal/ai/accumulate.go` (90行)
  - 消息列表: `web/src/components/chat/ChatMessageList.vue` (459行)
  - 消息项: `web/src/components/chat/ChatMessageItem.vue` (881行)
  - 内容块: `web/src/components/chat/ContentBlocks.vue` (1197行)
  - 元数据弹窗: `web/src/components/chat/ChatMetadataModal.vue` (296行)
  - Markdown渲染: `web/src/composables/useMarkdownRenderer.ts` (176行)
  - 工具详情: `web/src/utils/renderToolDetail.ts` (616行)
- **关注重点**: 消息流转完整性、并发安全、资源生命周期、错误传播链

#### R2: SSE 流式传输 ⭐⭐⭐⭐
- **预估耗时**: 30min
- **核心文件** (~7个):
  - `web/src/composables/useChatStream.ts` (492行)
  - `web/src/composables/useChatRender.ts` (326行)
  - `web/src/composables/useChatSession.ts` (506行) — 连接/断开编排
  - `web/src/composables/useSessionIdentity.ts` (212行) — 运行状态追踪
  - `internal/handler/chat_stream.go` (171行)
  - `internal/service/session_runtime.go` (173行)
  - `internal/ai/accumulate.go` (90行)
  - `internal/ai/interface.go` (89行) — StreamEvent 类型定义
- **关注重点**: 断线重连可靠性、超时处理、事件丢失风险、Block合并边界

#### R3: Auto-Resume 流程 ⭐⭐⭐
- **预估耗时**: 25min
- **核心文件** (~5个):
  - `internal/ai/factory.go` (23行) — AutoResumeBackend 包装
  - `internal/ai/auto_resume.go` (172行) — 核心逻辑
  - `internal/ai/stream_parser.go` (329行) — ExitPlanMode 检测
  - `internal/ai/cli_backend.go` (224行) — context 取消
  - `internal/handler/chat.go` (1055行) — resume_split 处理
- **关注重点**: 两阶段切换的原子性、CLI进程清理、消息持久化一致性

### 第二梯队：状态管理（预计 1h）

#### R4: Session 管理 ⭐⭐⭐
- **预估耗时**: 30min
- **核心文件** (~12个):
  - 前端: `web/src/components/session/SessionDrawer.vue` (490行), `web/src/components/session/SessionSelector.vue` (224行)
  - Composables: `web/src/composables/useSessionIdentity.ts` (212行), `web/src/composables/useSessionManager.ts` (241行), `web/src/composables/useSwipeSession.ts` (156行)
  - API: `internal/handler/chat_session.go` (148行), `internal/handler/chat.go` (1055行 — auto-create/cancel), `internal/handler/chat_history.go` (129行)
  - 服务: `internal/service/chat.go` (374行), `internal/service/session_runtime.go` (173行), `internal/service/database.go` (270行)
  - 模型: `internal/model/chat.go` (51行)
- **关注重点**: 单例一致性、并发session操作安全、取消原因追踪完整性、Session泄漏

#### R5: 定时任务流程 ⭐⭐⭐
- **预估耗时**: 30min
- **核心文件** (~10个):
  - 前端: `web/src/components/task/TaskDrawer.vue` (376行), `web/src/components/task/TaskFormDialog.vue` (617行), `web/src/components/task/TaskExecDialog.vue` (400行)
  - API: `internal/handler/scheduler.go` (250行), `internal/handler/chat.go` (1055行 — schedule-proposal 检测)
  - 服务: `internal/service/scheduler.go` (490行), `internal/service/database.go` (270行)
  - AI: `internal/ai/factory.go` (23行), `internal/ai/cli_backend.go` (224行), `internal/ai/accumulate.go` (90行)
  - 模型: `internal/model/scheduler.go` (25行)
  - 启动: `cmd/server/main.go` (484行)
- **关注重点**: Cron并发执行安全、长任务超时、任务状态一致性、schedule-proposal注入风险

### 第三梯队：独立子系统（预计 1h）

#### R6: TTS 语音流程 ⭐⭐⭐
- **预估耗时**: 35min
- **核心文件** (~15个):
  - 前端: `web/src/composables/useAutoSpeech.ts` (285行), `web/src/components/media/AudioPreview.vue` (117行), `web/src/components/chat/ChatMessageItem.vue` (881行 — TTS按钮)
  - API: `internal/handler/tts.go` (245行)
  - 接口: `internal/speech/interface.go` (129行)
  - 摘要器: `internal/speech/summarizer.go` (223行), `internal/speech/simple_summarizer.go` (30行), `internal/speech/mmx_summarizer.go` (68行), `internal/speech/ai_backend_summarizer.go` (83行), `internal/speech/ollama_summarizer.go` (132行)
  - 引擎: `internal/speech/minimax.go` (92行), `internal/speech/edge_tts.go` (96行), `internal/speech/piper.go` (160行), `internal/speech/kokoro.go` (141行), `internal/speech/moss_tts_nano.go` (158行)
  - 数据库: `internal/service/database.go` (270行 — TTS缓存)
  - 配置: `cmd/server/main.go` (484行 — TTS初始化), `internal/model/config.go` (102行)
- **关注重点**: 摘要链路可靠性、引擎切换一致性、音频资源释放、缓存策略

#### R7: SSH/端口转发 ⭐⭐⭐⭐
- **预估耗时**: 30min
- **核心文件** (~10个):
  - SSH: `internal/ssh/server.go` (373行)
  - 代理: `internal/service/proxy.go` (720行)
  - 模型: `internal/model/proxy.go` (16行), `internal/model/ssh.go` (8行)
  - API: `internal/handler/proxy_api.go` (82行), `internal/handler/ssh_info.go` (74行)
  - 前端: `web/src/components/proxy/ProxyPanel.vue` (784行), `web/src/components/proxy/PortForwardBrowser.vue` (276行), `web/src/components/proxy/ProxyPortItem.vue` (183行), `web/src/composables/usePortForward.ts` (307行)
  - 启动: `cmd/server/main.go` (484行)
- **关注重点**: SSH认证安全、端口验证绕过、健康检查可靠性、资源泄漏（SSH连接/goroutine）

### 第四梯队：辅助功能（预计 2h）

#### R8: 文件管理流程 ⭐⭐
- **预估耗时**: 30min
- **核心文件** (~13个):
  - 前端: `web/src/components/file/FileManager.vue` (746行), `web/src/components/file/FileViewer.vue` (367行), `web/src/components/file/CodePreview.vue` (173行), `web/src/components/file/MarkdownPreview.vue` (162行), `web/src/components/file/FileHeader.vue` (312行), `web/src/components/file/FileDetailsDialog.vue` (203行), `web/src/components/file/DirBreadcrumb.vue` (78行)
  - Composables: `web/src/composables/useFileUpload.ts` (164行)
  - 工具: `web/src/utils/fileType.ts` (99行), `web/src/stores/app.ts` (380行)
  - API: `internal/handler/file.go` (470行), `internal/handler/upload.go` (115行), `internal/handler/file_ops.go` (426行)
  - 模型: `internal/model/file.go` (107行), `internal/model/path.go` (22行)
- **关注重点**: 路径遍历防护、文件操作原子性、上传安全、大文件处理

#### R9: Git 历史流程 ⭐⭐
- **预估耗时**: 30min
- **核心文件** (~9个):
  - 前端: `web/src/components/git/GitHistoryDrawer.vue` (632行), `web/src/components/git/GitGraph.vue` (325行), `web/src/components/git/GitDiffView.vue` (163行), `web/src/components/git/GitCommitList.vue` (457行), `web/src/components/git/GitCommitMeta.vue` (115行), `web/src/components/git/GitBreadcrumb.vue` (133行)
  - 工具: `web/src/utils/gitGraph.ts` (608行), `web/src/utils/diff.ts` (126行)
  - API: `internal/handler/git.go` (515行)
- **关注重点**: Git命令注入防护、大仓库性能、XSS in diff、图渲染边界

#### R10: 认证流程 ⭐⭐
- **预估耗时**: 25min
- **核心文件** (~10个):
  - 前端: `web/src/components/LoginView.vue` (155行), `web/src/App.vue` (748行 — auth gate), `web/src/composables/useAppMode.ts` (39行)
  - API: `internal/handler/auth.go` (57行)
  - 中间件: `internal/middleware/auth.go` (37行), `internal/middleware/logger.go` (44行), `internal/middleware/recover.go` (26行), `internal/middleware/request_id.go` (32行)
  - 启动: `cmd/server/main.go` (484行 — 密码处理)
  - 模型: `internal/model/config.go` (102行)
- **关注重点**: 密码存储安全、Session固定攻击、CSRF、中间件顺序

#### R11: 配置/默认值流程 ⭐⭐
- **预估耗时**: 20min
- **核心文件** (~5个):
  - 启动: `cmd/server/main.go` (484行)
  - 模型: `internal/model/config.go` (102行), `internal/model/defaults.go` (148行), `internal/model/agent.go` (116行)
  - 平台: `internal/platform/path.go` (96行)
- **关注重点**: 配置注入安全、默认值合理性、Presence map正确性、Agent prompt注入

#### R12: Android Native Bridge ⭐⭐⭐
- **预估耗时**: 20min
- **核心文件** (~5个):
  - `web/src/composables/useAppMode.ts` (39行)
  - `web/src/composables/usePortForward.ts` (307行)
  - `web/src/App.vue` (748行)
  - `web/src/components/LoginView.vue` (155行)
  - `web/src/components/proxy/ProxyPanel.vue` (784行)
- **关注重点**: Bridge可用性降级、XSS via Bridge、密码明文传输、App/Web模式边界

## 每个 Review 输出模板

每个 review 输出为独立文件，路径: `docs/reviews/R{n}-{flow-name}.md`

```markdown
# R{n}: {流程名} Review

> 日期: {date}
> 审查范围: {前端入口} → {后端入口} → {核心逻辑} → {数据存储}

## 审查范围

### 前端
- ...

### 后端
- ...

### 数据层
- ...

## 三维度评估

### 🏗️ 架构设计 (30%)
- 层次边界是否清晰
- 职责是否单一
- 接口设计是否合理
- 耦合度评估
- 扩展性评估

### ✨ 代码质量 (30%)
- 设计模式应用
- 代码重复
- 命名/注释
- 错误处理模式
- 类型安全

### 🛡️ 健壮性 (40%)
- 竞态条件
- 资源泄漏（goroutine/连接/文件句柄）
- 边界条件
- 错误传播链
- 安全漏洞

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R{n}-001 | P0/P1/P2/P3 | 架构/质量/健壮性 | ... | ... | ... |

## 改进建议 (Top 3)

1. **{标题}**: {描述} — 预期收益: ...
2. ...
3. ...

## 亮点

- ...
```

## 汇总索引

所有 review 完成后，生成 `docs/reviews/INDEX.md` 包含：
- 各流程的 P0/P1 问题汇总
- 跨流程的共性问题和模式
- 优先修复建议排序
- 架构层面的系统性改进建议

## 依赖关系

```
R1 Chat主流程 ←── R2 SSE流式 ←── R3 Auto-Resume
      ↓                  ↓
R4 Session管理      R5 定时任务
                          ↓
R6 TTS语音          R7 SSH/端口转发
      ↓                  ↓
R8 文件管理         R9 Git历史
      ↓                  ↓
R10 认证流程   R11 配置/默认值   R12 Android Bridge
```
