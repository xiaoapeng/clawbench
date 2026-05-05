# R11: 配置/默认值流程 Review

> 日期: 2026-05-27
> 审查范围: config.yaml → ApplyDefaults → 零配置启动

## 审查范围

| 文件 | 行号 | 职责 |
|------|------|------|
| `cmd/server/main.go` | 1-485 | 启动入口、配置加载、初始化编排 |
| `internal/model/config.go` | 1-104 | Config 结构体定义、全局变量 |
| `internal/model/defaults.go` | 1-151 | ParsePresenceMap、ApplyDefaults |
| `internal/model/agent.go` | 1-117 | Agent 结构体、LoadAgents、prompt 注入 |
| `internal/platform/path.go` | 1-97 | 跨平台路径工具（UserHomeDir、ExpandTilde、ManglePath） |
| `internal/model/proxy.go` | 1-16 | ProxyConfig 结构体 |
| `internal/model/ssh.go` | 1-8 | SSHConfig 结构体 |
| `internal/handler/auth.go` | 1-57 | 认证逻辑（密码哈希验证） |
| `internal/model/defaults_test.go` | 1-346 | defaults 单元测试 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**优点：**
- **Presence Map 模式**：通过 `ParsePresenceMap` 区分"用户显式写 `enabled: false`"与"用户省略该字段"（Go 零值陷阱），设计思路正确且独特，解决了 bool 默认值的核心痛点。
- **零配置启动**：`ApplyDefaults` 为所有字段提供合理默认值，config.yaml 完全可选，符合"green portable"理念。
- **配置搜索优先级**：BinDir/config > CWD/config > BinDir/legacy > CWD/legacy，兼顾便携部署和标准布局。
- **Agent 热插拔**：YAML 文件驱动的 Agent 配置，`{{AVAILABLE_AGENTS}}` 占位符自动注入可用 agent 列表，扩展性好。

**问题：**
- **全局可变状态泛滥**：`config.go` 中有 12 个包级 `var`（BinDir、WatchDir、SessionToken、DevMode、DefaultAgentID、UploadMaxSizeMB 等），通过 `ApplyDefaults` 和 main.go 中的赋值语句设置。这种模式使配置生命周期不透明——何时设置、由谁设置、谁读取全靠隐式约定。
- **main.go 职责过重**（485行）：配置加载 → presence 解析 → ApplyDefaults → 全局变量赋值 → TTS 初始化 → 日志初始化 → Agent 加载 → 密码哈希 → 数据库初始化 → 调度器 → 端口解析 → SSH → HTTP 服务。至少 5 个独立关注点混在一个函数中，缺少分层。
- **Config 与全局状态双重存储**：`cfg.Chat.InitialMessages` 赋值给 `model.ChatInitialMessages`，存在两份同样数据但不同的访问方式，增加不一致风险。
- **TTS 初始化与配置解耦不彻底**：TTS provider 的创建逻辑硬编码在 main.go 的 switch-case 中（~110行），而非通过工厂/注册表模式，每新增一个 TTS engine 都需改 main.go。

### ✨ 代码质量 (30%)

**优点：**
- **代码注释充分**：config.go 每个字段都有注释说明默认值和用途；defaults.go 中 Presence Map 的设计意图有详细注释。
- **错误处理分层**：配置文件不存在（正常，跳过）vs 文件存在但无法读取（异常，退出）的区分清晰（main.go:106-124）。
- **测试覆盖好**：defaults_test.go 有 346 行，覆盖了 Presence Map 的各种边界情况（空配置、部分配置、bool 显式 false、bool 省略、密码自动生成/复用/显式设置）。
- **排序保证确定性**：AgentList 按 ID 排序，不依赖文件系统遍历顺序。

**问题：**
- **`rand.Read` 返回值未检查**（defaults.go:68）：`crypto/rand.Read` 在极端情况下可能返回错误，但当前代码忽略返回值。虽然实际中几乎不会失败，但作为安全相关代码（密码生成）应严谨。
- **`os.WriteFile` 返回值未检查**（defaults.go:71）：如果写入 auto-password 文件失败，密码将无法在重启后复用，但程序不会报错。
- **`os.MkdirAll` 返回值未检查**（defaults.go:70）：同上，目录创建失败不会被发现。
- **重复的密码哈希逻辑**：main.go:383 和 auth.go:37 各自独立实现了 `sha256(Password + "clawbench-salt")`，如果一处修改另一处不同步就会导致认证失败。
- **Config 内嵌匿名 struct**（config.go:11-51）：TLS、Dev、Upload、Chat、Session 全部使用匿名内嵌 struct，导致测试中构造 Config 时需要重复完整的 struct 定义（见 defaults_test.go:171-176），且无法复用。
- **Agent 加载错误静默吞掉**（agent.go:64-70）：读取文件失败、YAML 解析失败、ID 为空全部 `continue`，无任何日志，排查问题困难。

### 🛡️ 健壮性 (40%)

**优点：**
- **auto-password 文件权限 0600**（defaults.go:71）：自动生成的密码文件仅 owner 可读写，安全意识好。
- **显式密码时清理 auto-password 文件**（defaults.go:76）：防止残留的旧密码文件造成混淆。
- **端口验证**：CLI `--port` 参数验证范围 1-65535（main.go:71），PORT 环境变量同样验证（main.go:415）。
- **TLS 配置验证**：启用 TLS 但缺少证书/密钥时明确报错退出（main.go:475-478）。
- **Default Agent 验证**：配置的 default_agent 不存在时降级到第一个 agent，并打印可用列表（main.go:352-361）。

**问题：**

| 严重度 | 问题 |
|--------|------|
| **P1** | **密码明文存储在 auto-password 文件中**（defaults.go:71）：虽然文件权限是 0600，但 auto-password 文件存储的是明文密码。任何能读取该文件的进程（如备份工具、root 用户）都能获取密码。而 `cfg.Password` 本身也是明文存储在内存中。 |
| **P1** | **静态盐值 "clawbench-salt"**（main.go:383, auth.go:37）：SHA-256(password + fixed-salt) 不是安全的密码存储方案。固定盐值使得预计算彩虹表成为可能。应使用 bcrypt/scrypt/argon2 等自适应哈希算法。不过考虑到这是本地自托管工具且密码是自动生成的 UUID，实际风险有限。 |
| **P1** | **JSON 解码未检查错误**（auth.go:36）：`json.NewDecoder(r.Body).Decode(&body)` 的错误返回值被忽略。恶意请求可能导致空 Password 字段，结合 `model.SessionToken == ""` 的空密码绕过逻辑，构成认证风险。 |
| **P2** | **WatchDir 未验证是否为绝对路径**（defaults.go:52-55）：虽然 `ExpandTilde` 处理了 `~`，但如果用户配置了相对路径如 `./data`，`model.WatchDir` 将是相对路径。后续 handler 中的路径遍历检查基于绝对路径，可能导致安全检查失效。 |
| **P2** | **Agent prompt 注入风险**（agent.go:76-80, 100-102）：Agent 的 system_prompt 从 YAML 文件读取，拼接 common prompt 和 `{{AVAILABLE_AGENTS}}` 替换后直接使用。虽然 YAML 文件由管理员控制，但如果 Agent YAML 被恶意修改（如供应链攻击或配置文件被篡改），恶意 prompt 将直接影响 AI 行为。Agent prompt 没有任何大小限制或内容验证。 |
| **P2** | **Auto-password 文件路径依赖 BinDir 全局变量**（defaults.go:58）：`ApplyDefaults` 依赖 `BinDir` 已被设置。如果调用顺序错误（BinDir 未设置），密码文件会写到意外位置。当前 main.go 中 BinDir 在 ApplyDefaults 之前设置，但缺乏显式约束。 |
| **P2** | **presence["tls.enabled"] 未处理**：TLS.Enabled 也是 bool，默认应为 false（当前 Go 零值恰好是 false，所以行为正确），但如果未来需求改为"默认启用 TLS"，将面临和 proxy/ssh 同样的零值陷阱，且没有 presence map 保护。 |
| **P2** | **配置值下限验证不足**：所有 `<= 0` 的检查只能防止零值，但无法防止不合理值（如 `max_size_mb: 1` 或 `port: 1`）。Port 的验证只在 CLI 参数层面（main.go:71），配置文件中的 `port: 0` 或 `port: 99999` 不会被拦截。 |
| **P3** | **config.example.yaml 与 defaults.go 默认值不同步风险**：example 文件中 `summarize_backend: "simple"` 和 `summarize_model: "MiniMax-M2.7"` 是显式写出的，但 defaults.go 默认 summarize_backend 为 "simple" 且不设 summarize_model。如果用户复制 example 改了 summarize_backend 但保留 summarize_model，行为可能与预期不符。 |

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R11-001 | P1 | 健壮性 | JSON 解码未检查错误，空 Password 字段可能绕过认证 | auth.go:36 | 检查 `Decode` 返回值，对空/非法请求返回 400 |
| R11-002 | P1 | 健壮性 | 静态盐值 "clawbench-salt"，SHA-256 不适合密码存储 | main.go:383, auth.go:37 | 提取为共享函数；长期考虑 bcrypt/argon2 |
| R11-003 | P1 | 代码质量 | 密码哈希逻辑重复实现，修改一处易遗漏另一处 | main.go:383, auth.go:37 | 抽取为 `model.HashPassword()` 函数 |
| R11-004 | P2 | 健壮性 | WatchDir 未解析为绝对路径，可能导致路径遍历检查失效 | defaults.go:52-55 | 对 WatchDir 调用 `filepath.Abs()` |
| R11-005 | P2 | 健壮性 | Agent 加载错误全部静默吞掉，无日志输出 | agent.go:64-70 | 添加 `slog.Warn` 记录跳过的文件和原因 |
| R11-006 | P2 | 健壮性 | `rand.Read` 返回值未检查 | defaults.go:68 | 检查 error，失败时 panic 或 log.Fatal |
| R11-007 | P2 | 健壮性 | `os.WriteFile` / `os.MkdirAll` 返回值未检查 | defaults.go:70-71 | 检查错误，至少记录日志 |
| R11-008 | P2 | 健壮性 | `tls.enabled` bool 字段未纳入 Presence Map 保护 | defaults.go:43-151 | 显式处理或添加注释说明零值恰好正确 |
| R11-009 | P2 | 架构设计 | Config 与全局变量双重存储，增加不一致风险 | config.go:83-104, main.go:131-139 | 考虑将 Config 实例作为单例传递，而非复制到全局变量 |
| R11-010 | P2 | 架构设计 | main.go 职责过重（485行），初始化逻辑耦合 | main.go:63-485 | 拆分为 initConfig、initTTS、initLogging 等函数 |
| R11-011 | P2 | 代码质量 | Config 内嵌匿名 struct，测试和复用困难 | config.go:11-51 | 提取为独立命名类型 |
| R11-012 | P2 | 健壮性 | ApplyDefaults 依赖 BinDir 已被设置，缺乏显式约束 | defaults.go:58 | 添加 BinDir 非空检查或改为参数传入 |
| R11-013 | P2 | 健壮性 | Agent prompt 无大小限制或内容验证 | agent.go:76-80 | 添加最大长度检查和基本内容验证 |
| R11-014 | P3 | 代码质量 | TTS provider 初始化硬编码在 main.go switch-case 中 | main.go:200-308 | 提取工厂函数或注册表模式 |
| R11-015 | P3 | 健壮性 | Port 值未在配置层面验证范围 | defaults.go:47-49 | 在 ApplyDefaults 中验证 port 在 1-65535 范围 |
| R11-016 | P3 | 代码质量 | config.example.yaml 与 ApplyDefaults 默认值维护两处 | config.example.yaml, defaults.go | 考虑从代码生成 example 或添加同步测试 |

## 改进建议 (Top 3)

1. **提取密码哈希为共享函数 + 修复 JSON 解码错误处理**: 将 `sha256(Password + "clawbench-salt")` 抽取为 `model.HashPassword(string) string`，在 main.go 和 auth.go 中复用。同时修复 auth.go:36 的 JSON 解码错误检查。预期收益: 消除认证逻辑不一致风险，防止空请求绕过认证。

2. **WatchDir 路径规范化**: 在 ApplyDefaults 中对 WatchDir 调用 `filepath.Abs()`，确保始终为绝对路径。预期收益: 修复相对路径配置导致路径遍历检查可能失效的安全隐患。

3. **main.go 初始化逻辑拆分**: 将 TTS 初始化（~110行）、Agent 加载、全局变量赋值拆分为独立函数，降低 main() 的认知复杂度。预期收益: 提高可读性和可测试性，新增 TTS engine 或配置项时改动范围更小。

## 亮点

- **Presence Map 模式**是处理 Go bool 零值陷阱的优雅方案，设计思路清晰，测试覆盖全面（5 个专项测试覆盖各种组合）。
- **零配置启动**理念贯穿始终，从密码自动生成/复用到所有字段的合理默认值，用户体验友好。
- **auto-password 文件管理**考虑周全：权限 0600、显式密码时清理残留文件、重启后复用，形成完整闭环。
- **配置搜索优先级**的四层 fallback 兼顾了便携部署（BinDir 优先）和标准布局（CWD 次之），以及向后兼容（legacy 路径）。
- **Agent 列表排序**和 `{{AVAILABLE_AGENTS}}` 占位符替换是实用的设计模式，确保 agent 列表始终同步。
