# R10: 认证流程 Review

> 日期: 2026-05-05
> 审查范围: 密码 → 中间件 → Session Cookie → Android自动登录

## 审查范围

| 文件 | 行号范围 | 职责 |
|------|----------|------|
| `cmd/server/main.go` | 1-485 | 启动入口：密码哈希、SessionToken设置、服务器启动 |
| `internal/model/config.go` | 1-104 | 配置结构体、全局变量（SessionToken/SessionCookie） |
| `internal/model/defaults.go` | 1-151 | ApplyDefaults：自动密码生成、持久化 |
| `internal/model/errors.go` | 1-90 | 结构化错误类型、Unauthorized构造 |
| `internal/handler/auth.go` | 1-57 | 登录处理器：密码验证、Cookie设置、认证检查 |
| `internal/handler/handler.go` | 1-166 | 路由注册、中间件组装 |
| `internal/handler/static.go` | 1-52 | 首页服务（无认证保护） |
| `internal/handler/project.go` | 1-179 | 项目设置（部分路由无Auth中间件） |
| `internal/middleware/auth.go` | 1-37 | 认证中间件：Cookie校验、项目Cookie提取 |
| `internal/middleware/logger.go` | 1-44 | 请求日志中间件 |
| `internal/middleware/recover.go` | 1-26 | Panic恢复中间件 |
| `internal/middleware/request_id.go` | 1-32 | 请求ID中间件 |
| `web/src/components/LoginView.vue` | 1-155 | 登录页面组件 |
| `web/src/App.vue` | 481-590 | 认证网关：/api/me检查、Android自动登录 |
| `web/src/composables/useAppMode.ts` | 1-39 | Android WebView检测 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**整体评价: 良好 (7/10)**

认证流程的层次划分清晰：前端LoginView → fetch /login → handler校验 → 中间件鉴权，职责链路明确。

**优点：**
- 中间件模式统一鉴权：`middleware.Auth()` 包装所有需认证的路由，一处校验全局生效
- 前端三态设计合理：`isAuthenticated` 为 `null`(加载中) / `false`(未登录) / `true`(已登录)，避免闪烁
- Android自动登录与Web登录共用同一条代码路径，降低了维护成本
- 中间件组装顺序正确：`RecoverPanic → WithRequestID → RequestLogger → Handler`，确保panic不丢失请求追踪
- 零配置理念贯彻到底：无密码时自动生成UUID并持久化，重启不丢失

**问题：**
1. **全局变量耦合**：`model.SessionToken` 是包级全局变量，auth handler和middleware都直接读取。这在单实例部署下没问题，但无法扩展为多实例（每个实例内存不同步）。当前项目定位为单机工具，此问题暂不影响。
2. **认证逻辑重复**：`ServeAuthCheck` 和 `middleware.Auth` 的Cookie校验逻辑完全相同（读取Cookie → 比对SessionToken），违反DRY原则。应提取共享函数。
3. **路由注册中Auth缺失不一致**：`/api/me`、`/api/watch-dir`、`/api/project` 三个路由未包裹 `middleware.Auth()`，但它们暴露了系统配置信息。`/api/project` POST端点甚至允许未认证用户设置项目路径，这是信息泄露+操作漏洞。
4. **前端认证状态无集中管理**：`isAuthenticated` 定义在 App.vue 中，而非composable或store，无法被其他组件直接访问。

### ✨ 代码质量 (30%)

**整体评价: 良好 (7.5/10)**

代码简洁、命名清晰，错误处理使用结构化AppError而非散落的字符串。

**优点：**
- 中间件签名统一 `func(http.HandlerFunc) http.HandlerFunc`，链式调用优雅
- 错误处理使用 `model.Unauthorized()` / `model.Forbidden()` 等构造器，返回一致的JSON格式
- 前端 `useAppMode` 的iframe检测考虑周全：`window !== window.top` + 跨域异常捕获
- 请求日志使用 slog 结构化日志，包含 trace_id、duration、status

**问题：**
1. **硬编码盐值**：`auth.go:37` 使用 `"clawbench-salt"` 硬编码盐。虽然SHA256(password+salt)对于本地工具足够，但盐值应可配置或使用更强的KDF（如bcrypt/scrypt）。
2. **JSON解码未处理错误**：`auth.go:36` `json.NewDecoder(r.Body).Decode(&body)` 忽略了返回的error。恶意请求可能发送畸形JSON，此时body.Password为空字符串，由于空密码hash不等于SessionToken所以不会通过认证——但这是一个依赖隐式行为的防御，不显式。
3. **RequestID可预测**：`request_id.go:13` 使用 `time.Now().UnixNano()` 生成ID，理论上可预测。对于请求追踪目的可接受，但不应作为安全token使用。
4. **密码明文存储在Android SharedPreferences**：`LoginView.vue:48` 调用 `AndroidNative.setSSHPassword(password.value)` 将明文密码传给原生层。这是SSH隧道认证所需，但需确保原生侧使用EncryptedSharedPreferences或Keystore加密存储。
5. **auto-password文件权限良好**：`defaults.go:71` 使用 `0600` 权限写入auto-password文件，仅owner可读写。

### 🛡️ 健壮性 (40%)

**整体评价: 中等偏上 (6.5/10)**

基本安全措施到位（HttpOnly、SameSite=Lax、SHA256哈希），但存在若干需关注的安全问题。

**优点：**
- Cookie安全属性：`HttpOnly: true` 阻止XSS读取、`SameSite: Lax` 防止CSRF GET请求、`Path: "/"` 覆盖全站
- 认证旁路安全：`model.SessionToken == ""` 时所有请求直接放行，不会因空配置导致拒绝服务
- 前端网络异常处理完善：fetch失败时区分服务不可达（Android弹原生对话框）和Web环境（提示刷新）
- Panic恢复中间件确保单个请求异常不会崩溃整个服务
- 自动密码使用 `crypto/rand` 生成，有足够的随机性

**严重问题：**

1. **Session固定攻击风险** (R10-001)：登录成功后设置的新Cookie值是密码的SHA256哈希——这意味着同一密码永远产生相同的SessionToken。如果攻击者知道密码（或密码被重置），旧Cookie永远不会失效。系统缺少"登出"功能来主动使Cookie失效，也没有session轮换机制。

2. **未认证路由信息泄露** (R10-002)：`/api/watch-dir` 无需认证即可获取系统配置（上传限制、聊天配置、session限制等），`/api/project` POST允许未认证用户设置项目路径（可浏览任意目录结构）。虽然系统定位为本地工具，但在SSH隧道暴露场景下这是实际风险。

3. **缺少Secure Cookie标志** (R10-003)：Cookie未设置 `Secure: true`。在TLS模式下这应该启用。当前HTTP模式下无法启用Secure（浏览器会拒绝），但应在TLS启用时自动设置。

4. **登录无速率限制** (R10-004)：`/login` POST端点没有任何速率限制或账户锁定机制。攻击者可无限次暴力尝试密码。对于本地工具风险较低，但在SSH隧道远程访问场景下需关注。

5. **密码比较时序攻击** (R10-005)：`auth.go:20` 和 `middleware/auth.go:18` 使用 `token.Value != model.SessionToken` 字符串比较，非常量时间。虽然SHA256哈希后的token已足够长使时序攻击不现实，但最佳实践应使用 `crypto/subtle.ConstantTimeCompare`。

6. **ServeLogin错误响应泄露** (R10-006)：登录失败返回 `401 + {"ok": false}`，与 `/api/me` 返回的 `401 + {"error":"unauthorized","code":401}` 格式不一致。虽然不是安全漏洞，但响应格式不统一可能被利用来探测端点差异。

7. **Android自动登录密码在网络中明文传输** (R10-007)：`App.vue:507-511` 自动登录时密码以JSON明文通过HTTP POST发送。在SSH隧道场景下这是加密通道，但在局域网HTTP直连时不安全。应确保Android端始终通过SSH隧道连接。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R10-001 | P1 | 健壮性 | Session固定：同密码永远产生相同token，无登出/轮换机制 | auth.go:37-38, middleware/auth.go:18 | 添加登出端点（清除Cookie+服务端session store），或引入per-session随机token |
| R10-002 | P0 | 安全 | `/api/watch-dir`和`/api/project`未包裹Auth中间件，泄露系统配置，允许未认证设置项目路径 | handler.go:113-115 | 为 `/api/watch-dir`、`/api/project` 添加 `middleware.Auth()` 包装 |
| R10-003 | P1 | 安全 | Cookie未设置Secure标志，HTTPS下可被中间人截获 | auth.go:40-47 | 在TLS模式下动态设置 `Secure: true` |
| R10-004 | P2 | 安全 | 登录端点无速率限制，可暴力破解 | auth.go:34-54 | 添加简单速率限制（如每IP 5次/分钟）或指数退避 |
| R10-005 | P3 | 安全 | token比较非常量时间，理论时序攻击面 | auth.go:20, middleware/auth.go:18 | 使用 `subtle.ConstantTimeCompare` |
| R10-006 | P2 | 代码质量 | 登录错误响应格式与其他API不一致 | auth.go:49-53 | 统一使用 `model.WriteError()` 返回错误 |
| R10-007 | P2 | 安全 | Android自动登录密码在HTTP明文中传输 | App.vue:507-511 | 确保Android始终走SSH隧道，或添加TLS强制检查 |
| R10-008 | P2 | 代码质量 | ServeAuthCheck与middleware.Auth的Cookie校验逻辑重复 | auth.go:19-21, middleware/auth.go:17-19 | 提取 `ValidateSession(r *http.Request) bool` 到共享位置 |
| R10-009 | P2 | 代码质量 | JSON解码忽略错误，依赖隐式空字符串防御 | auth.go:36 | 添加错误检查，显式返回400 |
| R10-010 | P3 | 代码质量 | 硬编码盐值"clawbench-salt" | auth.go:37, main.go:383 | 提取为常量或可配置项；长期考虑使用bcrypt |
| R10-011 | P3 | 健壮性 | RequestID基于UnixNano，可预测 | request_id.go:13 | 使用UUID或crypto/rand生成，如不需要不可预测性则可接受 |
| R10-012 | P2 | 安全 | `/api/ssh/info` 无认证，暴露SSH端口和指纹 | handler.go:157 | 评估是否真正非敏感——端口信息可用于服务发现攻击 |
| R10-013 | P3 | 代码质量 | 前端isAuthenticated非集中管理，其他组件无法直接访问 | App.vue:224 | 考虑移入store或composable，供全局使用 |
| R10-014 | P3 | 健壮性 | 自动密码以明文存储在文件系统和日志中 | defaults.go:71, main.go:374-379 | 日志中仅显示密码前4位+掩码，auto-password文件权限已0600但可考虑加密 |

## 改进建议 (Top 3)

1. **修复未认证路由的安全漏洞** (R10-002): 为 `/api/watch-dir` 和 `/api/project` 添加 `middleware.Auth()` 包装 — 预期收益: 消除P0级信息泄露和未授权操作风险，特别是在SSH隧道远程访问场景下

2. **添加Secure Cookie标志和登出功能** (R10-001 + R10-003): 在TLS模式下自动设置 `Secure: true`；添加 `/api/logout` 端点清除Cookie — 预期收益: 防止中间人Cookie劫持，用户可主动终止会话

3. **添加登录速率限制** (R10-004): 使用 `sync.Map` 或内存计数器实现每IP每分钟N次限制 — 预期收益: 防止暴力破解，特别是在远程访问场景下保护弱密码

## 亮点

- **零配置自动密码**设计精巧：`crypto/rand`生成 → `0600`权限持久化 → 跨重启复用 → 日志+stdout双输出 → 用户设置密码时自动清理auto-password文件，整个生命周期考虑周全
- **Android iframe防御**：`useAppMode` 的 `window !== window.top` 检查 + 跨域异常捕获，有效防止PortForwardBrowser内嵌iframe被误判为App模式，这是一个很容易遗漏的边界条件
- **中间件链组装**简洁清晰：`RecoverPanic(WithRequestID(RequestLogger(handler)))` 三层中间件在 `handler.go:105` 一行完成，每个中间件职责单一、可独立测试
- **前端三态认证门控**：`isAuthenticated === null → 隐藏DOM` / `false → LoginView` / `true → 主界面`，避免了未认证时主界面闪烁
- **结构化错误体系**：`model.AppError` 携带HTTP status + message + wrapped error，`WriteError` 自动匹配status码，全局错误响应格式一致
