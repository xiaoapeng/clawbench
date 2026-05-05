# R12: Android Native Bridge Review

> 日期: 2026-05-05
> 审查范围: WebView检测 → JS Bridge → 原生功能调用

## 审查范围

| 文件 | 行号范围 | 职责 |
|------|----------|------|
| `web/src/composables/useAppMode.ts` | 1-39 | WebView环境检测，单例模式，iframe防护 |
| `web/src/composables/usePortForward.ts` | 1-307 | 端口转发状态管理，SSH隧道健康检查，Bridge调用 |
| `web/src/App.vue` | 190-590 (script) | 应用入口，Bridge初始化/自动登录，端口同步 |
| `web/src/components/LoginView.vue` | 1-156 | 登录表单，密码通过Bridge写入原生层 |
| `web/src/components/proxy/ProxyPanel.vue` | 1-785 | 端口转发UI，隧道状态展示，检测/注册交互 |

## 三维度评估

### 🏗️ 架构设计 (30%)

**优点：**

- **模块级单例模式**：`useAppMode()` 和 `usePortForward()` 都采用模块级 `ref` + `initialized` 守卫，确保全局状态唯一，这是正确的做法。
- **iframe 防护设计**：`useAppMode` 的 `window !== window.top` 检查 + `cross-origin` 异常捕获是精心设计的，解决了 `addJavascriptInterface` 注入所有 frame 的 Android 特有问题。
- **关注点分离**：Bridge 调用集中在 `usePortForward` 和 `useAppMode` 中，`ProxyPanel` 纯 UI 不直接调用 Bridge，`LoginView` 仅调用 Bridge 的密码方法。
- **优雅降级**：Bridge 方法调用普遍使用 `?.` 可选链，不会因 Bridge 不可用而崩溃。

**问题：**

- **Bridge 接口无类型定义**：`AndroidNative` 对象全部通过 `(window as any)` 访问，缺乏 TypeScript 接口定义。调用方无法获得类型检查和智能提示，也无法确保所有调用点使用一致的方法签名。(`useAppMode.ts:27`, `usePortForward.ts:81,89,105,208,282`, `App.vue:489,503,504,515,516`, `LoginView.vue:47,48`)
- **Bridge 调用散落多处**：Bridge 方法分布在 `useAppMode`、`usePortForward`、`App.vue`、`LoginView` 四个文件中，缺少统一的 Bridge 适配层来集中管理原生接口调用。如果 Android 端改了 API 签名，需要搜索全项目修改。
- **回调注册模式脆弱**：`setOpenPortBrowser` 使用模块级变量存储回调，`App.vue` 必须在正确时机调用，但没有机制确保在 `usePortForward` 使用回调前已完成注册。
- **App/Web 模式边界模糊**：`usePortForward` 同时承担了 Web 模式和 App 模式的逻辑，`checkTunnelHealth` 中大量 `if (isAppMode)` 分支，建议拆分为策略模式或独立的方法。

### ✨ 代码质量 (30%)

**优点：**

- **注释质量高**：`useAppMode.ts` 的文档注释精确解释了 iframe 检测的原理和原因；`usePortForward.ts` 的 JSDoc 清晰标注了每个方法的用途。
- **命名清晰**：`getNativeTunnelStatus`、`syncToNative`、`checkTunnelHealth` 等命名能准确传达意图。
- **错误处理合理**：Bridge 调用包裹在 `try/catch` 中，`getNativeTunnelStatus` 返回 `boolean | null` 三态，区分"不可用"和"已断开"。

**问题：**

- **重复的隧道健康判断逻辑**：`checkTunnelHealth` 和 `startTunnelPoll` 的回调中存在大量重复的 `hasPorts/anyActive` 判断逻辑（出现 4 次），代码行 141-148, 172-177, 186-195, 227-236, 247-256, 258-265。应抽取为 `determineTunnelStatus(ports, connected)` 辅助函数。
- **`(window as any)` 散落**：6 个文件中共约 10 处使用 `(window as any).AndroidNative`，类型安全性为零。
- **`isAppMode` 泄漏到 UI 层**：`ProxyPanel.vue` 直接解构 `isAppMode` 来决定 UI 显示，但 `isAppMode` 是运行时检测的一次性值，如果 Bridge 延迟注入（如动态注入场景），UI 不会更新。
- **App.vue 的 `onMounted` 过长**：`onMounted` 函数约 110 行，混合了认证、Bridge 同步、数据加载、会话初始化等多种职责。

### 🛡️ 健壮性 (40%)

**优点：**

- **iframe 安全边界**：正确处理了 `window.top` 的跨域异常，防止 iframe 继承 Bridge 能力。
- **Bridge 不可用时降级**：`openPort` 在 App 模式下如果 Bridge 方法不存在，会 fallback 到 `window.open`。
- **隧道轮询自动停止**：健康恢复后 `stopTunnelPoll()` 清理定时器。

**问题（按严重度排列）：**

- **P1: 密码通过 Bridge 明文传输**：`LoginView.vue:48` 调用 `window.AndroidNative.setSSHPassword(password.value)`，`App.vue:516` 也调用 `setSSHPassword(savedPwd)`。密码以 JS 字符串形式传递到 Java 层，在内存中长时间以明文存在。虽然 `addJavascriptInterface` 的 JS-Java 通道是进程内的（不经过网络），但 SharedPreferences 存储的密码如果未加密则存在风险。
- **P1: 自动登录密码在 JS 内存中可访问**：`App.vue:504` 从 `window.AndroidNative.getPassword()` 获取保存的密码后，以 `savedPwd` 局部变量持有，然后拼入 `fetch` 的 `body`。如果页面被注入恶意脚本（XSS），可直接调用 `AndroidNative.getPassword()` 获取明文密码。
- **P1: Bridge 方法调用无超时保护**：`AndroidNative.isTunnelConnected()`、`AndroidNative.addForwardedPort()` 等同步调用如果 Java 端实现阻塞，会冻结 JS 主线程。WebView 的 `addJavascriptInterface` 调用是同步的，如果 Java 方法执行耗时操作（如磁盘 I/O），UI 会卡死。
- **P2: `syncToNative` 无错误处理**：`usePortForward.ts:101-107` 中 `syncToNative` 对每个端口调用 `addForwardedPort`，但如果某个调用失败，后续端口仍然继续注册，且不会通知调用方。`App.vue:567` 调用 `.catch(() => {})` 完全吞掉了错误。
- **P2: `checkTunnelHealth` 竞态风险**：如果用户快速点击重试按钮，多次 `checkTunnelHealth` 可并发执行。`tunnelChecking` ref 虽然用于 UI 状态，但不阻止并发执行，可能导致状态闪烁。
- **P2: `registerPort` / `unregisterPort` 缺少错误传播**：API 调用失败时异常会被抛到调用方，但 Bridge 调用（`addForwardedPort`/`removeForwardedPort`）失败时异常未处理。如果 API 成功但 Bridge 调用失败，Web 端和原生端状态不一致。
- **P2: `startTunnelPoll` 无请求去重**：轮询回调中的 `loadSSHInfo()` + `loadPorts()` 如果响应慢，下一个 5s 定时器触发时可能产生并发请求。
- **P3: `loadPorts` 的 `silent` 参数不阻止并发**：`silent` 只控制 loading 状态的显示，不阻止并发请求。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R12-001 | P1 | 安全 | `getPassword()` Bridge 方法将明文密码暴露给 JS 环境，XSS 攻击可直接窃取 | `App.vue:504` | Android 端实现 `performLogin()` 方法，密码不离开 Java 层；或在 Java 端加密存储密码 |
| R12-002 | P1 | 安全 | `setSSHPassword()` 明文密码传入原生层，SharedPreferences 可能未加密存储 | `LoginView.vue:48`, `App.vue:516` | Android 端使用 EncryptedSharedPreferences 或 Android Keystore |
| R12-003 | P1 | 健壮性 | Bridge 同步调用无超时保护，Java 端阻塞会冻结 JS 主线程 | `usePortForward.ts:211`, `usePortForward.ts:81` | 在 requestAnimationFrame 或 Promise 中包装，或确保 Java 方法为轻量级 |
| R12-004 | P2 | 架构 | `AndroidNative` 无 TypeScript 接口定义，全项目 `(window as any)` | 多处 | 定义 `AndroidNativeBridge` 接口，扩展 Window 类型，创建 `useNativeBridge` 适配层 |
| R12-005 | P2 | 质量 | 隧道健康判断逻辑重复 4 次 | `usePortForward.ts:141-148,172-177,186-195,227-256` | 抽取 `determineTunnelStatus(ports, connected)` 辅助函数 |
| R12-006 | P2 | 健壮性 | `syncToNative` 部分失败不中断不报告 | `usePortForward.ts:101-107`, `App.vue:567` | 收集失败端口，返回结果对象或至少 console.warn |
| R12-007 | P2 | 健壮性 | `registerPort`/`unregisterPort` API 成功 + Bridge 失败导致状态不一致 | `usePortForward.ts:80-82,89-91` | Bridge 调用失败时 toast 提示用户，或先调 Bridge 再调 API |
| R12-008 | P2 | 健壮性 | `checkTunnelHealth` 可并发执行导致状态闪烁 | `usePortForward.ts:120-200` | 加 `AbortController` 或 `checking` 锁 |
| R12-009 | P2 | 架构 | `usePortForward` 混合 App/Web 逻辑，`checkTunnelHealth` 中 `if (isAppMode)` 多层嵌套 | `usePortForward.ts:135-159` | 策略模式：`NativeTunnelChecker` vs `ServerTunnelChecker` |
| R12-010 | P3 | 架构 | `setOpenPortBrowser` 模块级回调注册，无注册时序保证 | `usePortForward.ts:53-57` | 改为 provide/inject 或在 `usePortForward` 内部通过事件系统 |
| R12-011 | P3 | 质量 | `App.vue` 的 `onMounted` 约 110 行，职责过多 | `App.vue:481-590` | 拆分为 `useAppInit` composable |
| R12-012 | P3 | 健壮性 | `startTunnelPoll` 5s 轮询无请求去重 | `usePortForward.ts:222-267` | 加入 `isPolling` 锁或用递归 setTimeout 替代 setInterval |

## 改进建议 (Top 3)

1. **创建 `AndroidNativeBridge` TypeScript 接口 + 适配层**：定义完整接口（`isNativeApp`, `addForwardedPort`, `removeForwardedPort`, `isTunnelConnected`, `openInBrowser`, `getPassword`, `setSSHPassword`, `showServerDialog`），扩展 `Window` 类型声明，创建 `useNativeBridge()` composable 集中管理所有 Bridge 调用。预期收益：类型安全、调用点集中、API 变更时单点修改、可 mock 测试。

2. **消除密码明文暴露给 JS 层的安全风险**：在 Android 端新增 `performLogin(url)` 方法，JS 端不再通过 `getPassword()` 获取密码，而是让原生层自行完成登录 fetch 请求并返回结果。同时 Android 端使用 EncryptedSharedPreferences 存储密码。预期收益：消除 XSS 窃取密码的攻击面，密码不离开 Java 层。

3. **抽取隧道健康状态判断为纯函数**：将 `checkTunnelHealth` 和 `startTunnelPoll` 中重复的 `hasPorts/anyActive` 判断逻辑抽取为 `determineTunnelStatus(ports, isConnected): TunnelStatus`，并给 `checkTunnelHealth` 加并发锁。预期收益：消除 4 处重复逻辑约 40 行，减少维护负担和状态不一致风险。

## 亮点

- **iframe 安全边界设计**：`window !== window.top` + cross-origin 异常捕获的组合拳是深思熟虑的，文档注释清晰解释了"为什么不用 User-Agent"的决策，这是防 iframe Bridge 泄漏的教科书级实现。
- **三态隧道状态**：`getNativeTunnelStatus` 返回 `boolean | null` 而非 `boolean`，精确区分"不可用"、"已连接"、"已断开"三种语义，使降级路径自然。
- **优雅的 App/Web 模式降级**：从环境检测到功能调用全程可选链，Web 模式下零 Bridge 调用，App 模式下 Bridge 不可用时自动 fallback，不崩溃不报错。
- **隧道状态轮询自停机制**：健康恢复后自动 `stopTunnelPoll()`，避免不必要的网络请求和电池消耗。
