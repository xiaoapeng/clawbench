# R7: SSH/端口转发 Review

> 日期: 2026-05-05
> 审查范围: SSH Server → direct-tcpip → ProxyRegistry → 健康检查 → 前端浏览

## 审查范围

| 文件 | 行号范围 | 职责 |
|------|----------|------|
| `internal/ssh/server.go` | 1-374 | SSH隧道服务端：监听、认证、direct-tcpip通道处理、主机密钥管理 |
| `internal/service/proxy.go` | 1-721 | ProxyRegistry：端口注册/注销、健康检查、自动检测、DB持久化 |
| `internal/model/proxy.go` | 1-17 | ForwardedPort模型、ProxyConfig结构 |
| `internal/model/ssh.go` | 1-8 | SSHConfig结构 |
| `internal/handler/proxy_api.go` | 1-83 | HTTP API：端口CRUD + 自动检测 |
| `internal/handler/ssh_info.go` | 1-74 | HTTP API：SSH连接信息 + 隧道命令生成 |
| `web/src/components/proxy/ProxyPanel.vue` | 1-785 | 前端：端口管理面板（隧道状态、端口列表、添加/检测） |
| `web/src/components/proxy/PortForwardBrowser.vue` | 1-277 | 前端：嵌入式iframe浏览器（URL栏、协议切换） |
| `web/src/components/proxy/ProxyPortItem.vue` | 1-184 | 前端：端口条目组件（状态指示、操作按钮） |
| `web/src/composables/usePortForward.ts` | 1-308 | 前端：端口转发状态管理composable |
| `cmd/server/main.go` | 434-449 | 启动初始化：ProxyRegistry + SSH Server |

## 三维度评估

### 🏗️ 架构设计 (30%)

**整体评价: 7.5/10 — 清晰的层次分离，少量边界模糊**

**优点：**
- SSH Server 与 ProxyRegistry 职责边界清晰：SSH负责通道建立和认证，ProxyRegistry负责端口注册和健康检查，通过 `IsPortAllowed()` 接口解耦
- 前端 composable 模式干净：`usePortForward` 作为模块级单例管理全局状态，组件只做展示
- 前后端分层合理：handler → service → model，无跨层调用
- 配置的 bool-defaults 问题通过 `ParsePresenceMap()` 优雅解决（`defaults.go`）
- DB持久化与内存状态分离，启动时从DB恢复

**问题：**
1. **全局单例模式**（`service.ProxyService` 全局变量）导致测试困难，也无法支持多实例。`sshServerRef` 同理。依赖注入会更灵活。
2. **handler 直接访问全局 service 单例**：`ServeProxyPortAction` 直接调用 `service.ProxyService`，而非通过参数注入，handler 无法独立测试。
3. **`/api/ssh/info` 无需认证**（handler.go:157），虽然注释说端口和指纹不敏感，但该接口泄露了服务器内网IP（`r.Host`）、SSH端口、所有转发端口列表和连接统计。在公网部署场景下这是信息泄露。
4. **前端 `openPortBrowserFn` 回调**通过模块级变量注册（`usePortForward.ts:53`），是一个隐式耦合点，不如通过 props/events 传递。
5. **SSH Server 内嵌了 ProxyRegistry 引用**（`portReg *service.ProxyRegistry`），但仅用于 `IsPortAllowed()`。可以提取为接口减少耦合。

### ✨ 代码质量 (30%)

**整体评价: 7/10 — 实用主义代码，部分区域缺少防御性编程**

**优点：**
- SSH server 代码简洁，`handleDirectTCPIP` 遵循 RFC 4254 Section 7.2 正确解析通道数据
- `isPortInRange()` 支持多种范围格式（"1024-65535"、"3000,5173"、"1024-5000,8080"），解析逻辑清晰
- 跨平台自动检测实现完整：Linux（/proc/net/tcp）、macOS（lsof）、Windows（netstat + tasklist）
- 前端 i18n 国际化完整，所有用户可见字符串都通过 `t()` 函数
- 前端隧道健康状态的三级判定（ok/degraded/disconnected）设计合理

**问题：**
1. **SSH `Port()` 方法解析效率低**（`server.go:138-143`）：`net.SplitHostPort` + `fmt.Sscanf` 两次解析，应直接用 `strconv.Atoi`。
2. **`detectTLS` 使用 `InsecureSkipVerify: true`**（`proxy.go:243`）：虽然是内部探测合理，但缺少注释说明为何安全。
3. **`loadPortsFromDB` 中静默跳过扫描错误**（`proxy.go:673`）：`rows.Scan` 失败时 `continue` 但不记录日志，可能丢失损坏数据的信息。
4. **前端 `PortForwardBrowser` iframe sandbox**（`PortForwardBrowser.vue:31`）：`allow-same-origin` + `allow-scripts` 组合使 sandbox 几乎等同于无 sandbox，但这是功能需求（需要访问 localhost 服务）。
5. **前端 `openPort` 的 URL 拼接**（`usePortForward.ts:285`）：`window.open` 直接拼接用户可控的端口号，但端口号经过后端验证，风险可控。

### 🛡️ 健壮性 (40%)

**整体评价: 6.5/10 — 有几个值得关注的竞态和安全问题**

**优点：**
- SSH server 使用 `sync.Mutex` 保护 `connCount`/`activeChannels`，读写成对
- ProxyRegistry 使用 `sync.RWMutex`，读操作用 `RLock`，写操作用 `Lock`
- SSH 双向 relay 使用 `sync.WaitGroup` 确保两端都完成才返回
- `CloseWrite()` 半关闭处理正确：SSH channel 和 TCPConn 都有对应调用
- 健康检查 goroutine 使用 `context.WithCancel` 可干净退出
- 数据库操作在锁外执行，避免持锁I/O

**问题：**

#### 竞态条件

1. **P1 — `checkAllPorts` 锁粒度不一致**（`proxy.go:268-285`）：先 `RLock` 快照端口列表，释放锁后逐个检查，然后 `Lock` 更新状态。在检查和更新之间，端口可能已被删除（`UnregisterPort`），导致 `r.ports[port]` 查找失败（已有 `ok` 检查保护，不会 panic，但状态更新静默丢失）。更严重的是：如果端口被删除又重新注册为不同值，`checkAllPorts` 可能用旧快照覆盖新注册的信息。

2. **P2 — `RegisterPort` 检查-然后-操作非原子**（`proxy.go:80-116`）：端口存在性检查和注册在同一个 `Lock` 内，但 `savePortToDB` 在锁内执行 I/O。虽然 `INSERT OR REPLACE` 语义安全，但持锁期间 DB 写入会阻塞其他操作。更关键的是：如果 `savePortToDB` 失败，内存中有注册但数据库无记录，重启后丢失。

3. **P2 — SSH `handleConn` 中 `connCount` 与实际连接状态不同步**（`server.go:185-195`）：`connCount++` 在 handshake 成功后，但 `defer connCount--` 在 `handleConn` 返回时。如果 SSH 连接异常（如客户端断开但 goroutine 未退出），计数会暂时不准。`ConnectionStats()` 读取到的 `clientCount` 可能不反映真实状态。

#### 资源泄漏

4. **P1 — SSH 连接无超时/限流**（`server.go:88-101`）：`Accept` 循环无连接速率限制，恶意客户端可以打开大量 SSH 连接耗尽文件描述符。每个连接产生 3 个 goroutine（handleConn + DiscardRequests + channel handler）。

5. **P1 — SSH channel 无超时**（`server.go:275-296`）：`io.Copy` 是阻塞调用，如果 backend 服务响应缓慢或挂起，channel goroutine 会永远阻塞。应设置读写 deadline。

6. **P2 — 健康检查 goroutine 无错误恢复**（`proxy.go:250-265`）：如果 `checkAllPorts` panic，整个 health check goroutine 会退出，且 `context` 不会被取消。虽然 Go 的惯用法是"不要在库代码中 recover"，但一个长期运行的后台任务应有防护。

7. **P2 — `DetectListeningPorts` 无并发控制**（`proxy.go:195-232`）：多个并发 HTTP 请求触发 `DetectListeningPorts`，每次都会执行 `lsof`/`netstat` + 遍历 `/proc` + TLS 探测。在高频调用下可能导致 CPU 尖峰。

#### 安全

8. **P0 — SSH 密码明文比较，无暴力破解防护**（`server.go:67-71`）：`PasswordCallback` 直接 `string(pass) == s.password`，无失败限速、无账户锁定。攻击者可以无限次尝试密码。结合无认证的 `/api/ssh/info`（泄露SSH端口和用户名），攻击面扩大。

9. **P1 — SSH 绑定 `0.0.0.0`**（`server.go:53`）：SSH 服务默认监听所有接口。如果服务器有公网 IP，SSH 隧道服务直接暴露在互联网。应提供 `bind_address` 配置项，默认 `127.0.0.1`。

10. **P1 — `/api/ssh/info` 无需认证暴露端口信息**（`handler.go:157`）：攻击者无需认证即可获取 SSH 端口、用户名、所有转发端口、连接统计。应至少要求认证，或在公网场景下脱敏。

11. **P2 — 主机密钥文件权限未验证**（`server.go:344`）：`os.WriteFile(path, pemData, 0600)` 设置了正确权限，但 `loadHostKey` 读取时不验证文件权限是否为 0600，如果用户手动修改了权限为 world-readable，私钥会泄露。

12. **P2 — `allowed_ports` 空=允许所有**（`proxy.go:622-623`）：`isPortInRange` 中空字符串返回 `true`，意味着如果配置错误（如 `allowed_ports: ""`），所有端口都可转发，包括特权端口。

13. **P3 — `generateHostKey` 临时密钥无保护**（`server.go:360-373`）：临时密钥仅在内存中，每次重启都变。客户端首次连接会收到 host key 变更警告，可能导致中间人攻击被忽视（"cry wolf"问题）。

#### 边界条件

14. **P2 — `isPortInRange` 不验证范围合法性**（`proxy.go:621-654`）：`low > high` 的范围（如 "5000-1000"）不会匹配任何端口，但不会报错。`0-65535` 会允许转发特权端口。

15. **P2 — `checkPortActive` 误判**（`proxy.go:288-296`）：TCP `DialTimeout` 成功只意味着端口在监听，不代表服务正常（如服务正在启动但未就绪）。2秒超时对高负载系统可能不够。

16. **P3 — `PortForwardBrowser` 无 XSS 防护**（`PortForwardBrowser.vue:28-34`）：iframe `src` 直接由 `iframeSrc` computed 生成，虽然端口号经过后端验证，`currentPath` 是用户输入。如果用户在路径输入框中注入 `javascript:` URL（虽然浏览器通常阻止 iframe 的 javascript: src），或更实际的：通过路径导航到恶意页面。`sandbox` 属性限制了部分风险。

17. **P3 — 前端 `tunnelPollTimer` 可能在组件卸载后继续运行**（`usePortForward.ts:222-267`）：`startTunnelPoll` 启动的 `setInterval` 没有在组件卸载时自动清理。如果 `ProxyPanel` 关闭时状态是 unhealthy，timer 会持续运行直到变为 healthy。但由于是模块级变量，生命周期与应用一致，实际影响有限。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R7-001 | P0 | 安全 | SSH密码认证无暴力破解防护，结合无认证的 `/api/ssh/info` 信息泄露，攻击面扩大 | `server.go:67-71`, `handler.go:157` | 增加指数退避的失败计数器，5次失败后锁定IP 5分钟；`/api/ssh/info` 添加认证要求 |
| R7-002 | P1 | 安全 | SSH默认绑定`0.0.0.0`，公网部署时隧道服务直接暴露 | `server.go:53` | 增加 `ssh.bind_address` 配置项，默认 `127.0.0.1`；需公网访问时显式配置 |
| R7-003 | P1 | 竞态 | `checkAllPorts` 快照端口列表后逐个检查，端口可能在检查期间被删除/重新注册 | `proxy.go:268-285` | 在更新时检查端口号的注册时间戳，或改用 channel-based 架构 |
| R7-004 | P1 | 资源泄漏 | SSH连接无限流，恶意客户端可耗尽FD/goroutine | `server.go:88-101` | 添加连接速率限制（如 token bucket），限制并发连接数 |
| R7-005 | P1 | 资源泄漏 | SSH channel的`io.Copy`无超时，backend挂起时goroutine永久阻塞 | `server.go:275-296` | 在 channel 和 backend conn 上设置读写 deadline（如 5 分钟），或使用带超时的 `io.Copy` |
| R7-006 | P1 | 安全 | `/api/ssh/info`无需认证暴露SSH端口、用户名、转发端口列表、连接统计 | `handler.go:157` | 添加 `middleware.Auth()` 包装，或在公网场景下脱敏返回 |
| R7-007 | P2 | 健壮性 | `RegisterPort` 持锁期间执行 `savePortToDB`，DB写入失败时内存与DB不一致 | `proxy.go:91-108` | 将 `savePortToDB` 移到锁外执行；如果保存失败，回滚内存注册并返回错误 |
| R7-008 | P2 | 健壮性 | `loadPortsFromDB` 静默跳过 `rows.Scan` 错误，无日志 | `proxy.go:673` | 添加 `slog.Warn` 记录扫描失败的行 |
| R7-009 | P2 | 安全 | 主机密钥文件加载时不验证权限，可能 world-readable | `server.go:308-325` | 在 `loadHostKey` 中检查文件权限，如果非 0600/0400 则警告 |
| R7-010 | P2 | 边界 | `isPortInRange` 不验证范围合法性（low>high），`allowed_ports` 空值=允许所有 | `proxy.go:621-654` | 空值默认为 "1024-65535"（而非允许所有）；启动时验证范围合法性 |
| R7-011 | P2 | 资源泄漏 | 健康检查goroutine无panic recovery，panic后健康检查永久停止 | `proxy.go:250-265` | 在 `healthCheckLoop` 中添加 `defer recover` + 重启 ticker |
| R7-012 | P2 | 性能 | `DetectListeningPorts` 无并发控制，高频调用导致CPU尖峰 | `proxy.go:195-232` | 添加 `sync.Mutex` 或 singleflight 防止并发调用 |
| R7-013 | P2 | 代码质量 | `Port()` 方法用 `fmt.Sscanf` 解析端口号，冗余且效率低 | `server.go:138-143` | 直接 `strconv.Atoi(portStr)` |
| R7-014 | P3 | 安全 | 临时主机密钥每次重启变更，导致客户端忽视 host key 变更警告 | `server.go:360-373` | 默认启用持久化主机密钥（`<BinDir>/.clawbench/ssh_host_key`） |
| R7-015 | P3 | 健壮性 | `checkPortActive` 仅检查TCP可连接，不验证服务健康 | `proxy.go:288-296` | 考虑对HTTP端口做 HEAD 请求检查，或保持TCP检查但在前端区分"监听"和"健康"状态 |
| R7-016 | P3 | 架构 | 全局单例 `service.ProxyService` 和 `sshServerRef` 导致测试困难和无法多实例 | `service/proxy.go:34`, `handler/ssh_info.go:14` | 通过依赖注入传递，或至少提供 `SetProxyService` 方法用于测试 |
| R7-017 | P3 | 代码质量 | `detectTLS` 的 `InsecureSkipVerify: true` 缺少注释说明安全考量 | `proxy.go:243` | 添加注释：仅用于内部TLS探测，不验证证书因为localhost通常无有效证书 |

## 改进建议 (Top 3)

1. **SSH认证安全加固**: 增加密码尝试限速（指数退避 + IP锁定），`/api/ssh/info` 添加认证要求，SSH默认绑定 `127.0.0.1` — 预期收益: 消除P0安全漏洞，防止暴力破解和信息泄露，公网部署时默认安全

2. **SSH连接资源管理**: 添加连接速率限制（如每秒5个新连接），channel读写超时（5分钟idle deadline），最大并发连接数限制（如100） — 预期收益: 防止资源耗尽攻击和goroutine泄漏，提高长时间运行的稳定性

3. **ProxyRegistry一致性改善**: `savePortToDB` 移到锁外执行（失败时回滚），`DetectListeningPorts` 添加 singleflight 防并发，`isPortInRange` 空值默认 "1024-65535" 而非允许所有 — 预期收益: 消除内存/DB不一致风险，防止CPU尖峰，关闭配置错误时的全端口开放漏洞

## 亮点

- SSH direct-tcpip 处理完全遵循 RFC 4254，双向relay的半关闭处理正确（`CloseWrite`）
- ProxyRegistry 的 DB 持久化 + 启动恢复设计优雅，端口在重启后不丢失
- 前端隧道健康三级状态（ok/degraded/disconnected）+ 自动轮询恢复设计周到，用户体验好
- 跨平台端口自动检测实现完整（Linux/macOS/Windows 三平台），进程名解析细致
- `PortForwardBrowser` 的 URL 栏设计巧妙：协议可点击切换、路径可编辑、支持导航刷新
- 配置的 bool-defaults 问题通过 `ParsePresenceMap` 优雅解决，避免了 Go 零值陷阱
- 前端模块级单例 `usePortForward` 保证了跨组件状态一致性
- 代码注释风格一致，关键设计决策都有注释说明（如 `server.go:231-234` 解释为何SSH隧道不需要IsPortRegistered）
