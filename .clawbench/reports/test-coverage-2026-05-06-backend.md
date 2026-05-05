# Go Backend Test Coverage Report - 2026-05-06

## 摘要
- 总包数: 10 (internal/ 9 + cmd/server/ 1)
- 已覆盖: 9 (深覆盖: 5, 浅覆盖: 4)
- 未覆盖: 1 (cmd/server)
- 本次新增: 2 包 (service/tts_runtime, speech/ai_backend_summarizer + speech/mmx_summarizer)
- 本次深化: 4 包 (service/session_runtime, speech/edge_tts, model/path, speech/mmx_summarizer)
- 测试结果: 9 PASS / 0 FAIL / 0 SKIP

## 本次变更
| 包 | 变更类型 | 新增测试数 | 覆盖重点 | 状态 |
|---|---------|-----------|---------|------|
| service/tts_runtime | 新增 | 15 | RegisterTTSJob, GetTTSJob, UnregisterTTSJob, SendTTSEvent, CloseTTSJobDone, CancelTTSJob + 错误路径/满通道/幂等性 | PASS |
| service/session_runtime | 深化 | 19 | RegisterSessionCancel, GetAndClearCancelReason(user/disconnect), CancelSession(完整流程), ForceCancelSession, SendSessionEvent(满通道), TrySetSessionRunning(竞态), 并发安全 | PASS |
| speech/ai_backend_summarizer | 新增 | 11 | mock AIBackend, doSummarizePass(Success/Error/EmptyOutput/Whitespace/StreamError/Cancel), Summarize(短文本/长文本), ModelOverride | PASS |
| speech/mmx_summarizer | 新增 | 9 | NewMMXSummarizer, 短文本绕过, CLI不可用, context取消, 长文本集成(有CLI), ReSummarization管道, PassError管道 | PASS |
| speech/edge_tts | 深化 | 2 | RateArgs参数处理(+0%/empty/+20%/-10%), DifferentVoices | PASS |
| model/path | 深化 | 9 | 多重穿越, dot路径, dot-slash, 混合穿越与合法路径, 深层嵌套, 特殊字符, 绝对relPath行为 | PASS |

## 失败详情
无

## 包覆盖详情

### 深覆盖 (5)
- **internal/ai** — 170 tests, 流式解析/AutoResume/工厂模式全覆盖
- **internal/middleware** — 26 tests, 认证/恢复/日志/请求ID全覆盖
- **internal/i18n** — 11 tests, 多语言/fallback/全key对齐
- **internal/platform** — 7 tests, 路径工具全覆盖
- **internal/ssh** — 19 tests, 认证/端口转发/暴力破解防护

### 浅覆盖 → 本次深化 (4)
- **internal/service** — 217→251 tests, tts_runtime和session_runtime已补齐，chat.go部分函数仍缺
- **internal/speech** — 105→127 tests, ai_backend_summarizer和mmx_summarizer已补齐，edge_tts已深化
- **internal/model** — 60→69 tests, path.go边界已深化，file.go实际已深覆盖
- **internal/handler** — 258 tests, executeStreamRun/buildChatRequest仍缺(需集成测试环境)

### 未覆盖 (1)
- **cmd/server** — 程序入口，无测试文件(低优先级)

## 覆盖缺口（仍需关注）
1. **handler/chat.go**: `executeStreamRun`/`buildChatRequest`/`detectAndCreateScheduleProposals` 仍无单元测试 — 需要集成测试环境(test server + mock backend)
2. **handler/file_ops.go**: 7个handler仅happy path，缺路径穿越/权限/边界测试
3. **service/chat.go**: `GetChatHistoryPaged`/`SaveRawResponse`/`GetSessionCount` 未测试
4. **handler/project.go**: 仅2个测试
5. **handler/static.go**: ServeIndex/ServeProjectDialog 几乎无测试

## 新增文件清单
- `internal/service/tts_runtime_test.go` — 259行, 15个测试
- `internal/service/session_runtime_test.go` — 323行, 19个测试
- `internal/speech/ai_backend_summarizer_test.go` — 214行, 11个测试
- `internal/speech/mmx_summarizer_test.go` — 143行, 9个测试
- 修改: `internal/speech/edge_tts_test.go` +59行, 2个测试
- 修改: `internal/model/path_test.go` +71行, 9个测试

## 统计
- 新增代码: 1069行
- 新增测试: 56个
- 覆盖函数: 22个导出函数从无测试→有测试
- 全量测试通过率: 100% (9/9 PASS)
