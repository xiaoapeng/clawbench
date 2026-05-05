# R6: TTS 语音流程 Review

> 日期: 2026-05-05
> 审查范围: 文本 → 摘要压缩 → TTS引擎 → 音频响应 → 前端播放

## 审查范围

| 文件路径 | 行号范围 | 职责 |
|---------|---------|------|
| `web/src/composables/useAutoSpeech.ts` | 1-285 | 前端TTS状态机、SSE解析、音频播放 |
| `web/src/components/chat/ChatMessageItem.vue` | 60-160 | TTS按钮UI、speak触发 |
| `web/src/components/media/AudioPreview.vue` | 1-117 | 音频预览播放器（文件浏览用，非TTS核心） |
| `internal/handler/tts.go` | 1-245 | TTS HTTP端点、SSE流、缓存调度 |
| `internal/speech/interface.go` | 1-130 | SpeechProvider接口、StripMarkdown |
| `internal/speech/summarizer.go` | 1-224 | Summarizer接口、通用摘要管线、多pass |
| `internal/speech/simple_summarizer.go` | 1-30 | 无AI摘要器（仅strip+truncate） |
| `internal/speech/mmx_summarizer.go` | 1-68 | mmx CLI摘要器 |
| `internal/speech/ai_backend_summarizer.go` | 1-83 | AI后端摘要器（claude/codebuddy等） |
| `internal/speech/ollama_summarizer.go` | 1-132 | Ollama HTTP API摘要器 |
| `internal/speech/minimax.go` | 1-92 | MiniMax TTS引擎（mmx CLI） |
| `internal/speech/edge_tts.go` | 1-96 | Edge TTS引擎（免费） |
| `internal/speech/piper.go` | 1-160 | Piper本地离线TTS引擎 |
| `internal/speech/kokoro.go` | 1-141 | Kokoro ONNX本地TTS引擎 |
| `internal/speech/moss_tts_nano.go` | 1-158 | MOSS-TTS-Nano本地TTS引擎 |
| `internal/service/database.go` | 130-269 | TTS摘要缓存表、读写 |
| `internal/model/config.go` | 35-80 | TTS配置结构体 |
| `cmd/server/main.go` | 141-309 | TTS初始化、引擎/摘要器选择 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**整体评分: 8/10**

**优点:**
- **清晰的分层架构**: handler → summarizer → engine 三层职责明确。handler负责HTTP/SSE协议，summarizer负责文本压缩，engine负责音频合成。
- **接口驱动设计**: `SpeechProvider` 和 `Summarizer` 两个接口定义简洁（各一个方法），实现可自由替换。5个TTS引擎和4个摘要器均通过统一接口接入。
- **genericSummarizer策略模式**: 将多pass摘要、文本预处理、语言提示词组装等通用逻辑抽取为 `genericSummarizer`，各后端只需提供 `summarizePassFunc`。消除了大量重复代码，是优秀的策略模式应用。
- **零配置哲学**: `ApplyDefaults()` 为所有TTS配置提供合理默认值，`edge`引擎+`simple`摘要器开箱即用，无需任何外部依赖。
- **SSE渐进式反馈**: 前端通过SSE接收 phase 事件，实现"摘要中→合成中→播放中"的状态可视化，用户体验好。

**问题:**

1. **SpeechProvider缺少FileExtension()接口** — handler中通过type assertion判断引擎类型来确定音频文件扩展名（tts.go:116-124），违反开闭原则。新增引擎必须修改handler代码。
2. **全局可变状态** — `speechProvider` 和 `summarizer` 是包级var，通过 `SetSpeechProvider`/`SetSummarizer` 设置。注释说明"not goroutine-safe"，但这只是软约束，无编译期保障。
3. **模块级单例与Vue inject/inject模式混用** — `useAutoSpeech` 用模块级ref实现单例，又在ChatPanel中provide/inject。两种共享状态的机制并存，增加认知负担。
4. **AudioPreview.vue与TTS流程无交集** — AudioPreview是文件浏览器中的通用音频播放组件，与TTS语音流完全独立。它使用原生`<audio controls>`，而TTS使用`new Audio()` + imperative API。两套音频播放路径互不关联。
5. **StripMarkdown职责过重** — interface.go中`StripMarkdown`函数包含30+正则表达式和复杂的分阶段处理逻辑，但被归类在"接口定义"文件中。应独立为`strip_markdown.go`。

### ✨ 代码质量 (30%)

**整体评分: 7.5/10**

**优点:**
- **注释质量极高**: 每个文件、类型、常量、关键函数都有详细注释。TTS引擎参数的默认值、含义、CLI对应关系都清晰记录。
- **错误处理规范**: 所有CLI调用都捕获stderr并包装到错误消息中，方便调试。`fmt.Errorf("xxx failed: %w (stderr: %s)")` 是统一模式。
- **日志一致性**: 所有关键步骤都有 `slog.Info/Warn/Error` 日志，包含结构化字段（cache_key, text_len, result_len等），可观测性好。
- **前端状态机清晰**: useAutoSpeech的状态转换 `idle → summarizing → synthesizing → playing → idle` 有文档说明，实现与描述一致。
- **命名规范**: Go端命名遵循Go惯例，前端命名遵循Vue composables惯例，各自风格统一。

**问题:**

1. **魔法数字散布** — `shortTextThreshold=300`, `SimpleMaxSummarizeRunes=1000`, `DefaultMaxSummarizeRunes=10000`, `reSummarizeThreshold=4000`, `ttsFailedCacheTTL=10min`, `ttsSummarizeTimeout=60s`, `ttsSynthesizeTimeout=120s` 等常量分散在各文件中。部分可配置（`MaxSummarizeRunes`, `InlineCodeMaxLen`），部分硬编码，缺乏统一的配置出口。
2. **前端SSE解析脆弱** — useAutoSpeech.ts:136-159 手工解析SSE协议，仅处理 `data:` 前缀，忽略 `event:`/`id:`/`retry:` 字段。while循环内的字符串切片操作 (`sseBuffer.slice`) 在极端情况下（大量未分隔数据）可能产生性能问题。
3. **StripMarkdown正则过多** — interface.go中有20+预编译正则和 `stripResidualMarkdown` 的"兜底"正则。分5个Phase处理，但Phase间可能有交互（如Phase 1删除HTML标签后，Phase 2的某些正则匹配范围变化）。正则的顺序依赖缺乏形式化验证。
4. **handler中的sleep** — tts.go:149-151 使用 `time.Sleep(100ms)` 两次，让前端"看到"中间状态。这种时序控制方式脆弱，依赖网络延迟和前端渲染速度。
5. **AIBackendSummarizer未设置WorkDir** — ai_backend_summarizer.go:45 `WorkDir: ""` 意味着AI后端没有工作目录。某些后端（如claude）在无WorkDir时可能行为异常或报错。

### 🛡️ 健壮性 (40%)

**整体评分: 7/10**

**优点:**
- **缓存设计合理**: 双层缓存（DB摘要 + 文件音频），DB缓存失败条目有TTL过期机制（10分钟），避免永久缓存错误结果。音频文件存在性检查作为最终验证。
- **超时控制完备**: handler层设置60s摘要超时+120s合成超时，Ollama客户端120s超时，前端AbortController支持取消。多层超时防止单点挂死。
- **摘要降级策略**: 摘要失败时降级为 `StripMarkdown(text)`（tts.go:195-196），合成失败时返回错误但保留summary供调试。双层降级保证核心路径不中断。
- **前端音频资源释放**: stopAudio() 清理 AbortController、pause音频、置null引用、重置状态。onended/onerror回调检查 `currentAudioEl === audio` 防止竞态。
- **路径安全**: tts.go:128 使用 `validateAndResolvePath` 防止路径遍历，audioPath基于SHA256哈希生成，用户无法控制输出路径。

**问题（详见问题清单）:**

1. **缓存键不含语言/引擎参数** — SHA256仅基于文本内容，相同文本不同语言/引擎会命中同一缓存。切换引擎后可能返回错误格式的音频文件（如Piper的.wav缓存被MiniMax的.mp3请求命中）。
2. **tts_summaries表无清理机制** — 只有INSERT OR REPLACE，无DELETE或TTL清理。长期运行后数据库膨胀。
3. **AIBackendSummarizer流式读取无超时** — `for event := range ch` (ai_backend_summarizer.go:60) 依赖context cancel，但如果后端持续发送事件（如tool_use），摘要管线可能永远不结束。
4. **Ollama响应体读取无限制** — ollama_summarizer.go:110 `io.ReadAll(resp.Body)` 读取错误响应体时无大小限制。恶意Ollama服务器可发送巨大响应导致OOM。
5. **前端SSE buffer无大小限制** — useAutoSpeech.ts:122 `sseBuffer` 持续追加数据，如果服务端不发送 `\n\n` 分隔符，buffer将无限增长。
6. **stripInlineCode边界条件** — interface.go:123 `match[1 : len(match)-1]` 假设match长度≥2。如果正则匹配到单个反引号（不应发生但无保证），会panic。
7. **loadSummarizeBasePrompt非并发安全** — summarizer.go:162-190 使用 `cachedSummarizeBasePrompt` 变量做缓存，无同步保护。虽然当前只在启动时调用，但类型导出后无约束。
8. **Edge TTS固定.venv路径** — edge_tts.go:15 `edgeTTSCmd = ".venv/bin/edge-tts"` 硬编码.venv相对路径，若部署环境无.venv则失败，且错误消息不明确。
9. **MiniMax Provider不验证输出文件大小** — minimax.go:87-89 只检查文件是否存在（`os.Stat`），不检查大小。CLI可能创建空文件（如API配额耗尽时），此时会返回0字节音频文件给前端。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R6-001 | P1 | 健壮性 | 缓存键仅基于文本SHA256，不含语言和引擎参数。切换TTS引擎后可能命中旧引擎的缓存音频文件（如Piper的.wav vs MiniMax的.mp3），导致播放失败 | tts.go:111-112 | 缓存键应包含引擎名+语言：`sha256(text+engine+language)[:16]` |
| R6-002 | P1 | 健壮性 | MiniMax/Piper/Kokoro/MossNano只验证输出文件存在，不检查文件大小。CLI可能创建空文件（配额耗尽、权限错误等），0字节音频文件会被缓存并返回给前端 | minimax.go:87, edge_tts.go:91, piper.go:142, kokoro.go:123, moss_tts_nano.go:135 | `os.Stat`后检查 `info.Size() > 0` |
| R6-003 | P2 | 架构 | handler通过type assertion判断引擎类型决定文件扩展名，违反开闭原则。新增引擎必须修改handler | tts.go:116-124 | 在SpeechProvider接口添加 `FileExtension() string` 方法 |
| R6-004 | P2 | 健壮性 | tts_summaries表只有INSERT OR REPLACE，无清理/淘汰机制。长期运行后数据库无限膨胀 | database.go:130-135, 264-269 | 添加定期清理（如最近30天未使用的条目）或LRU淘汰 |
| R6-005 | P2 | 健壮性 | Ollama错误响应体用`io.ReadAll`读取无大小限制，恶意服务器可造成OOM | ollama_summarizer.go:110 | 使用 `io.LimitReader(resp.Body, 4096)` |
| R6-006 | P2 | 健壮性 | 前端SSE buffer无大小限制，服务端异常时可无限增长 | useAutoSpeech.ts:122 | 添加buffer大小上限（如1MB），超限后断开并报错 |
| R6-007 | P2 | 代码质量 | handler中`time.Sleep(100ms)`两次，用于"让前端看到中间状态"。这种时序控制依赖假设，在高延迟/慢渲染环境可能失效 | tts.go:149-151 | 考虑将phase显示逻辑改为前端驱动（phase事件仅更新状态，由前端CSS transition控制可见时间） |
| R6-008 | P2 | 架构 | StripMarkdown含20+正则和5阶段处理逻辑，放在interface.go中职责不清 | interface.go:21-129 | 提取为独立的 `strip_markdown.go` |
| R6-009 | P2 | 健壮性 | AIBackendSummarizer `for event := range ch` 可能因后端持续发送非content事件（如tool_use）而永远不返回 | ai_backend_summarizer.go:60-69 | 添加事件计数器，超过阈值后返回错误；或仅处理content/done/error事件，忽略其他 |
| R6-010 | P2 | 代码质量 | 大量阈值/超时常量硬编码，部分可配置部分不可，缺乏统一配置出口 | summarizer.go:26-48, tts.go:24-28 | 将 `shortTextThreshold`, `reSummarizeThreshold`, `ttsSummarizeTimeout`, `ttsSynthesizeTimeout`, `ttsFailedCacheTTL` 纳入config.yaml |
| R6-011 | P3 | 健壮性 | `loadSummarizeBasePrompt`用包级变量缓存，非并发安全。当前安全（启动时单线程调用），但类型导出后无约束 | summarizer.go:162-190 | 使用 `sync.Once` 保证安全初始化 |
| R6-012 | P3 | 健壮性 | `stripInlineCode`中 `match[1:len-1]` 假设match长度≥2，虽然正则保证有反引号，但防御性编程应加检查 | interface.go:123 | 添加 `if len(match) < 2 { return "" }` |
| R6-013 | P3 | 代码质量 | Edge TTS硬编码`.venv/bin/edge-tts`路径，部署环境无.venv时错误不明确 | edge_tts.go:15 | 错误消息中提示安装方式：`pip install edge-tts` |
| R6-014 | P3 | 代码质量 | useAutoSpeech的`_speak`函数含多个`await new Promise(resolve => requestAnimationFrame/setTimeout)`延迟hack，用于让UI"看到"中间状态 | useAutoSpeech.ts:144,149,187 | 这些延迟是workaround，考虑用CSS animation/transition替代 |
| R6-015 | P3 | 代码质量 | ChatMessageItem中`autoSpeech`通过inject获取，无类型声明（TS），缺乏provide方类型校验 | ChatMessageItem.vue:128 | 定义inject key with type: `const autoSpeechKey: InjectionKey<ReturnType<typeof useAutoSpeech>> = Symbol()` |
| R6-016 | P3 | 架构 | AudioPreview.vue使用原生`<audio controls>`，TTS使用`new Audio()`命令式API，两套音频播放路径完全独立无复用 | AudioPreview.vue:11-17, useAutoSpeech.ts:192-214 | 考虑抽象共用的音频播放composable |

## 改进建议 (Top 3)

1. **缓存键加入引擎+语言维度**: 当前缓存键仅基于文本内容，切换引擎/语言后命中错误缓存是P1级别的功能异常。修改为 `sha256(text+engine+language)[:16]` 即可，影响面小但收益大。同步修改 `tts.go` 的缓存键计算和 `database.go` 的表结构（或接受相同文本不同引擎产生不同cache_key的自然结果）。预期收益: 消除引擎切换后的音频格式不匹配问题，提高多语言场景可靠性。

2. **SpeechProvider接口添加FileExtension()方法**: 当前通过3个type assertion判断引擎类型决定扩展名，违反开闭原则且是R6-001的根因之一。添加 `FileExtension() string` 方法后，各引擎自行声明输出格式，handler无需知道具体类型。预期收益: 新增引擎零修改handler，消除type assertion，为缓存键改进提供引擎名信息。

3. **TTS缓存表添加清理机制**: tts_summaries表只有INSERT OR REPLACE，无任何淘汰策略。长期运行的生产实例中，该表将无限增长（每条AI回复至少一行摘要缓存）。建议添加启动时清理30天前条目的逻辑，或在SaveTTSSummary时顺带清理旧记录。预期收益: 防止数据库膨胀，对嵌入式/低存储部署环境尤为重要。

## 亮点

- **genericSummarizer策略模式**: 将多pass摘要、文本预处理、语言提示词组装等通用逻辑抽取为泛化结构，各后端只需实现`summarizePassFunc`。这是本模块最优雅的设计，消除了4种摘要器的代码重复。
- **双层降级策略**: 摘要失败→StripMarkdown原始文本；合成失败→返回错误但保留摘要。两道防线保证TTS功能不因单一环节失败而完全不可用。
- **SSE渐进式反馈**: 前端实时显示"摘要中→合成中→播放中"状态，比传统HTTP请求的loading spinner体验好得多。cache hit时也发送phase事件（加sleep）保持UX一致性，这是对用户体验的细致关注。
- **端口安全的音频文件访问**: TTS音频通过`/api/local-file/`端点提供，有路径校验和认证保护，避免直接暴露文件系统。
- **前端音频资源管理**: `stopAudio()`的清理逻辑完善（abort controller、pause、null引用、回调置空、状态重置），`onended`/`onerror`中的`currentAudioEl === audio`检查防止竞态。
- **Zero-config默认引擎选择**: 默认使用Edge TTS（免费无配额）+ Simple Summarizer（无AI调用），确保首次运行零外部依赖即可使用TTS功能。
