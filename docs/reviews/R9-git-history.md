# R9: Git 历史流程 Review

> 日期: 2026-05-05
> 审查范围: Git命令 → Diff解析 → 图渲染 → UI交互

## 审查范围

| 文件 | 行数 | 职责 |
|------|------|------|
| `internal/handler/git.go` | 1-516 | Git HTTP API handlers: history, diff, status, init |
| `web/src/utils/gitGraph.ts` | 1-609 | Git graph lane assignment + SVG path computation |
| `web/src/utils/diff.ts` | 1-127 | Unified diff parser + HTML renderer |
| `web/src/components/git/GitHistoryDrawer.vue` | 1-633 | Top-level orchestrator: state, data loading, drill-down |
| `web/src/components/git/GitGraph.vue` | 1-326 | SVG graph rendering, tooltip, collapsed mode |
| `web/src/components/git/GitDiffView.vue` | 1-164 | Diff display with v-html rendering |
| `web/src/components/git/GitCommitList.vue` | 1-458 | Commit list + search + infinite scroll + graph integration |
| `web/src/components/git/GitCommitMeta.vue` | 1-116 | Commit metadata panel with SHA copy |
| `web/src/components/git/GitBreadcrumb.vue` | 1-134 | Drill-down breadcrumb navigation |

## 三维度评估

### 🏗️ 架构设计 (30%)

**优点：**
- 清晰的层次分离：Backend API → Utility (gitGraph/diff) → Component (GitHistoryDrawer → 子组件)，每层职责明确
- GitHistoryDrawer 作为编排层，将数据加载、视图切换、状态管理集中处理，子组件 (GitCommitList, GitDiffView, GitGraph, GitCommitMeta, GitBreadcrumb) 各自职责单一
- gitGraph.ts 的两阶段算法 (lane assignment → connection generation) 设计精良，lane compression 有效减少视觉空间
- drill-down 导航模式 (commits → files → diff) 简洁直观，Breadcrumb 组件可复用

**问题：**
1. **GitHistoryDrawer 承担过多职责** (P2)：数据加载、状态管理、视图切换、diff 渲染调用全部集中在一个组件中。`loadProjectHistory`、`loadFileHistory`、`loadMoreCommits`、`loadCommitFiles`、`loadDiff` 五个异步函数 + `onSearch`、`initGitRepo` + 状态管理 (15+ ref)，已经接近需要拆分的阈值。可抽取 `useGitHistory` composable 分离数据逻辑。

2. **gitGraph.ts 单函数过长** (P2)：`computeGraphData` 约 490 行，包含 lane assignment (4步)、connection generation (3种连接类型)、branch name mapping。虽然注释充分、逻辑清晰，但可拆分为 `assignLanes()`、`generateConnections()`、`buildBranchNames()` 三个子函数提升可读性和可测试性。

3. **diff.ts 的 HTML 字符串拼接** (P2)：`renderDiff` 用字符串拼接构建 HTML 表格，缺乏模板化。虽然功能正确，但维护性和 XSS 防护不如 Vue 模板或虚拟 DOM 方案。当前依赖 `escapeHtml` 和 `highlightLine` 的正确调用来防止注入。

4. **后端 Git handler 缺少 Service 层** (P3)：所有 Git 操作直接在 handler 中通过 `exec.Command` 调用，没有 service 层抽象。如果未来需要缓存、重试、或命令审计，需要重构。

5. **组件间隐式依赖** (P2)：GitHistoryDrawer 和 GitCommitList 通过 `commitSearch` ref 暴露 + `defineExpose` 通信。GitCommitList 暴露 `observeList`/`unobserveList` 给父组件调用，这种命令式 API 不如声明式 props/emits 直观。

### ✨ 代码质量 (30%)

**优点：**
- gitGraph.ts 注释极其详尽，每个阶段和算法决策都有清晰说明
- 后端 parseGitLog/parseDecorateRefs/parseGitStatusPorcelain 解析逻辑健壮，边界条件处理完整
- i18n 全面覆盖，所有用户可见字符串都已国际化
- CSS 变量 + fallback 值一致使用 (`var(--border-color, #dee2e6)`)
- Lane compression 的 greedy interval coloring 算法高效 (O(n log n) sorting + O(n*k) assignment)

**问题：**
1. **SHA 参数未验证格式** (P1)：`ServeGitFileDiff` (L244) 和 `ServeGitCommitFiles` (L273) 直接将用户提供的 `sha` 传入 `exec.Command("git", "show", commit, ...)` 和 `exec.Command("git", "diff-tree", ..., sha)`。虽然 `exec.Command` 的参数数组方式防止了 shell injection，但恶意 SHA 值 (如 `--all`、`--hard`、`HEAD~100`) 仍可能改变 git 命令语义。应验证 SHA 为 40 字符十六进制字符串或已知的短 SHA 格式。

2. **commit 消息中的 `|` 字符可能破坏解析** (P2)：`parseGitLog` 使用 `SplitN(line, "|", 5)`，但 git format `%s` (subject) 中可能包含 `|` 字符。`SplitN` 限制为 5 部分确保了前 4 个字段正确分割，subject 中的 `|` 会被保留在 parts[2] 中。但 author+refs 部分 (parts[4]) 中的 `|` 也会被保留——这在 `author|refs` 格式中不会出问题，因为 `%an%d` 不会产生 `|`。这个设计是正确的，但缺少注释说明这个关键设计决策。

3. **formatDate 硬编码 locale** (P2)：GitCommitMeta L55 硬编码 `toLocaleString('zh-CN', ...)`，但项目已有 i18n 支持。应使用当前 locale。

4. **diff.ts 无类型导出** (P3)：`DiffLine`、`Hunk` 接口是私有的，外部无法使用类型信息。如果其他组件需要访问解析后的 diff 数据结构，需要重新解析。

5. **gitGraph.ts 缺少类型注解** (P3)：所有函数参数和返回值都没有 TypeScript 类型注解，只有 JSDoc 注释。在 TypeScript 项目中应使用接口定义 `Commit`、`GraphNode`、`GraphLine` 等类型。

6. **重复的 formatDate 逻辑** (P3)：GitCommitList 和 GitCommitMeta 各有自己的 `formatDate` 实现，逻辑不同 (一个用 relative time，一个用 locale string)。应统一或明确说明差异原因。

### 🛡️ 健壮性 (40%)

**优点：**
- 路径遍历防护：所有文件路径参数都经过 `validateAndResolvePath` → `model.ValidatePath`，确保 resolved path 在 project root 内
- `exec.Command` 使用参数数组而非 shell 字符串，防止 shell injection
- Diff 渲染中 `escapeHtml` 正确转义 hunk header、prefix，`highlightLine` 失败时 fallback 到 `escapeHtml`
- GitGraph 的 lane 持久化 (persistedShaToLane) 防止 lazy-load 时视觉跳变
- IntersectionObserver 实现无限滚动，自动 disconnect 防止泄漏

**问题：**

1. **XSS 风险：v-html 渲染 diff 内容** (P1)：`GitDiffView.vue:6` 使用 `v-html="html"` 渲染 diff HTML。虽然 `diff.ts` 中对 hunk header 和 prefix 使用了 `escapeHtml`，但 `highlightLine` (L12-18) 调用 `hljs.highlight()` 返回的 HTML 未经二次转义。highlight.js 的输出理论上只包含 `<span class="...">` 标签，但如果 diff 内容包含能被 highlight.js 解析为 HTML 的模式 (如 HTML 文件的 diff)，HLJS 可能产出包含事件属性的 HTML。此外，`renderDiff` 中的 fallback 路径 (L99-103) 对 `clean` 变量使用 `escapeHtml`，但如果 `lines.filter(...)` 逻辑有误导致带 `+`/`-` 前缀的行未被正确处理，可能产生未转义内容。**建议**：对 highlight.js 输出进行 sanitize (如 DOMPurify)，或在 renderDiff 后对整个 HTML 做 post-process 验证。

2. **SHA 参数注入风险** (P1)：如前所述，`sha` 和 `commit` 参数未经格式验证。虽然 `exec.Command` 防止了 shell injection，但以下场景值得注意：
   - `git show <sha> -- <path>`：如果 sha 是 `--all`，git show 可能输出所有对象的 diff，造成 DoS
   - `git diff-tree ... <sha>`：如果 sha 是有效的 ref name 而非 commit hash，可能返回意外结果
   - `commit` 参数 (L381) 完全未验证，直接传入 `gitDiff` 函数

3. **大仓库性能：搜索时全量加载** (P1)：`onSearch` (L341-356) 在搜索时通过循环加载所有 commit (`while (hasMore)`)。对于有数万 commit 的大仓库，这会导致：
   - 大量 API 请求 (每 30 个 commit 一次)
   - 巨大的内存占用 (所有 commit 对象保存在 `commits.value`)
   - UI 卡顿 (大量 DOM 渲染)
   **建议**：后端实现搜索 API (`git log --grep`)，或限制最大加载量。

4. **gitGraph.ts 的大仓库性能** (P2)：`computeGraphData` 的复杂度：
   - Phase 1 (lane assignment): O(n * d) 其中 d 是 first-parent chain 深度，最坏 O(n^2)
   - Phase 2 (connections): O(n * p * n) 其中 p 是 parent 数，nodeGaps 扫描 O(n)
   - Phase D (compression): O(n) + O(L log L) + O(L * C)
   - SHA-to-branch-name 映射 (L529-555)：对每个有 ref 的节点，沿 first-parent chain 回溯，可能 O(n^2)
   在 10K+ commit 的仓库中，这可能造成明显的 UI 冻结。**建议**：对 branch-name mapping 增加深度限制，或在 Web Worker 中计算。

5. **commit 消息中的 `|` 导致解析错误** (P1)：虽然 `SplitN` 限制为 5 部分保护了前 4 个字段，但 date 字段 (parts[3]) 如果包含 `|`，会导致 author+refs 被截断。Git 的 `--date=iso` 格式 (`2026-05-05 14:30:00 +0800`) 不包含 `|`，所以目前安全。但如果未来更改 date format，这个隐式依赖可能导致解析错误。

6. **working tree diff 合并逻辑有缺陷** (P2)：`gitDiff` (L183-215) 在 HEAD/working tree 模式下，简单拼接 staged 和 unstaged diff。如果同一行既 staged 又 unstaged 修改，合并后的 diff 可能显示两次修改，不如 `git diff HEAD` 的完整 diff 准确。**建议**：改用 `git diff HEAD -- <path>` 获取 working tree vs HEAD 的完整 diff。

7. **竞态条件：并发加载可能覆盖状态** (P2)：`loadProjectHistory`、`loadFileHistory`、`loadMoreCommits`、`loadDiff` 都是 async 函数，但没有取消机制。如果用户快速切换 commit，前一个 diff 请求的响应可能在新的 diff 请求之后返回，导致显示错误的 diff。**建议**：使用 AbortController 取消前一次请求。

8. **parseGitStatusPorcelain 的 rename 处理** (P2)：L449-453 对 rename (R) 的处理只提取新文件名，丢弃了旧文件名信息。如果旧路径有特殊字符 (如空格)，`->` 的 split 可能不准确。Git porcelain 格式对 rename 使用 `old -> new`，但带空格的路径会被引号包裹 (如 `"path/old name" -> "path/new name"`)，当前 `strings.Trim(path, "\"")` 只处理了最外层引号。

9. **SVG tooltip 定位可能闪烁** (P3)：GitGraph.vue 的 tooltip 使用 `event.clientX + 8` 定位，但 `tooltipStyle` 是 computed 属性，首次渲染时 `tooltipEl.value` 可能为 null (因为 Teleport 还未挂载)，使用估算尺寸。第二次渲染时才使用实际尺寸，导致位置跳变。

10. **GitCommitList touch handler 使用 let 变量** (P3)：L127-129 的 `touchStartX`/`touchStartY`/`touchStartTime` 使用模块级 `let` 变量而非 ref。虽然功能正确 (不需要响应式)，但如果同一页面有多个 GitCommitList 实例，这些变量会共享状态。

## 问题清单

| ID | 严重度 | 类别 | 描述 | 文件:行号 | 建议 |
|----|--------|------|------|-----------|------|
| R9-001 | P1 | 安全 | SHA/commit 参数未验证格式，可传入 git flag 改变命令语义 | git.go:212,244,273,281,381 | 正则验证 `^[0-9a-f]{7,40}$` 或使用 `git rev-parse` 验证 |
| R9-002 | P1 | 安全 | v-html 渲染 diff HTML，highlight.js 输出未经 sanitize | GitDiffView.vue:6, diff.ts:120 | 使用 DOMPurify 对 hljs 输出做 post-sanitize |
| R9-003 | P1 | 性能 | 搜索时全量加载所有 commit，大仓库 DoS | GitHistoryDrawer.vue:341-356 | 后端实现 `git log --grep` 搜索 API |
| R9-004 | P1 | 健壮性 | commit message 中 `|` 字符的隐式依赖：date format 变更会导致解析失败 | git.go:136,24 | 使用更安全的分隔符 (如 `\x00`) 或 `--format` 的 JSON 输出 |
| R9-005 | P2 | 健壮性 | working tree diff 合并 staged+unstaged 不如 `git diff HEAD` 准确 | git.go:183-210 | 改用 `git diff HEAD -- <path>` 获取完整 diff |
| R9-006 | P2 | 健壮性 | 并发 diff 请求无取消机制，快速切换 commit 可能显示错误 diff | GitHistoryDrawer.vue:435-463 | 使用 AbortController 取消前次请求 |
| R9-007 | P2 | 性能 | computeGraphData 在大仓库中 O(n^2) branch-name mapping | gitGraph.ts:529-555 | 增加回溯深度限制或移至 Web Worker |
| R9-008 | P2 | 架构 | GitHistoryDrawer 职责过多 (15+ ref + 5 async 函数) | GitHistoryDrawer.vue:126-506 | 抽取 `useGitHistory` composable |
| R9-009 | P2 | 代码质量 | gitGraph.ts 缺少 TypeScript 类型注解 | gitGraph.ts:全文 | 为 Commit/GraphNode/GraphLine 等添加 interface |
| R9-010 | P2 | 架构 | computeGraphData 单函数 490 行，难以测试 | gitGraph.ts:103-590 | 拆分为 assignLanes/generateConnections/buildBranchNames |
| R9-011 | P2 | 健壮性 | parseGitStatusPorcelain rename 处理不处理引号包裹的路径 | git.go:449-453 | 使用 `git status --porcelain=z` (NUL 分隔) 或 `git status --porcelain=v2` |
| R9-012 | P2 | 代码质量 | formatDate 硬编码 zh-CN locale，与 i18n 系统不一致 | GitCommitMeta.vue:55 | 使用 i18n locale |
| R9-013 | P3 | 代码质量 | GitCommitList 和 GitCommitMeta 各有独立的 formatDate 实现 | GitCommitList.vue:159, GitCommitMeta.vue:51 | 统一到 format 工具模块 |
| R9-014 | P3 | 健壮性 | SVG tooltip 首次渲染使用估算尺寸，可能位置跳变 | GitGraph.vue:234-236 | 使用 nextTick 或 ResizeObserver 获取实际尺寸 |
| R9-015 | P3 | 代码质量 | diff.ts 的 DiffLine/Hunk 接口未导出 | diff.ts:21-31 | 导出类型供外部使用 |
| R9-016 | P3 | 健壮性 | touch handler 使用模块级 let 变量，多实例共享状态 | GitCommitList.vue:127-129 | 封装到组件实例内或使用 ref |

## 改进建议 (Top 3)

1. **SHA 参数验证 + 安全加固**: 对 `sha`/`commit` 参数添加正则验证 (`^[0-9a-f]{7,40}$`)，对 diff HTML 输出添加 DOMPurify sanitize — 预期收益: 消除命令注入和 XSS 两个安全风险点，无需大量代码改动

2. **后端搜索 API 替代前端全量加载**: 新增 `/api/git/project-history?q=xxx` 端点，使用 `git log --grep` 在服务端过滤，避免大仓库搜索时的全量加载 DoS — 预期收益: 搜索性能从 O(n) 网络请求降到 O(1)，内存占用从 O(n) 降到 O(30)，用户体验大幅提升

3. **拆分 computeGraphData + 添加 TypeScript 类型**: 将 490 行单函数拆为 3 个子函数，为 commit/node/line 数据结构添加 interface — 预期收益: 可单独测试每个阶段，类型安全捕获更多错误，降低认知复杂度

## 亮点

- **Lane compression 算法**: greedy interval coloring 将非重叠分支压缩到同一视觉轨道，优雅地解决了多分支仓库的宽度爆炸问题
- **Lane 持久化**: `persistedShaToLane` 跨 lazy-load 保持 lane 稳定性，避免新加载 commit 导致视觉跳变——这是一个经常被忽略的 UX 细节
- **Working tree 虚拟节点**: 前端合成 `isWT: true` 的工作树节点，与 commit 列表无缝融合，设计巧妙
- **Cascade 路径渲染**: 非相邻 lane 的连接线使用级联式 step-by-step 路径而非跨 lane 直线，视觉清晰度极高
- **搜索触发的全量预加载**: 搜索前自动加载所有 commit 以确保过滤完整——虽然大仓库有性能问题，但小仓库体验很好
- **Touch swipe 切换 graph**: 在移动端通过左右滑动折叠/展开 graph，符合移动端操作习惯
