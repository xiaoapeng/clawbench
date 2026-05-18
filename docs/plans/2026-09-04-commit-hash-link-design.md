# Commit Hash Link Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect git commit hashes in chat messages, verify them against the repository, and provide clickable links that navigate to the commit detail (files view) in the Git history tab.

**Architecture:** Frontend regex matching (7-40 hex chars with at least one a-f letter) → DOM annotation with clickable buttons → backend batch verification via `POST /api/git/verify-commits` → verified buttons navigate to Git history's files view for that commit. Follows the exact pattern established by `useFilePathAnnotation`.

**Tech Stack:** Go (backend API), Vue 3 + TypeScript (frontend composable), DOM traversal (same as file path annotation)

---

### Task 1: Backend — Add `POST /api/git/verify-commits` endpoint

**Files:**
- Modify: `internal/handler/git.go` (add handler function)
- Modify: `internal/handler/handler.go:246` (register route)

**Step 1: Write the handler function**

In `internal/handler/git.go`, add after the existing handler functions:

```go
// ServeGitVerifyCommits checks which SHAs are valid git commit objects.
// Accepts POST with JSON body {"shas": ["abc1234", ...]}.
// Returns {"results": {"abc1234": "commit", "def5678": null}} where null means
// the SHA is not a valid commit (could be blob/tree/tag or not found).
func ServeGitVerifyCommits(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	projectPath, ok := requireProject(w, r)
	if !ok {
		return
	}
	if !isGitRepo(projectPath) {
		writeJSON(w, http.StatusOK, map[string]interface{}{"results": map[string]interface{}{}})
		return
	}

	var body struct {
		SHAs []string `json:"shas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.SHAs) == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{"results": map[string]interface{}{}})
		return
	}

	results := make(map[string]interface{}, len(body.SHAs))
	for _, sha := range body.SHAs {
		cmd := exec.Command("git", "cat-file", "-t", sha)
		cmd.Dir = projectPath
		output, err := cmd.Output()
		if err != nil {
			results[sha] = nil
		} else {
			objType := strings.TrimSpace(string(output))
			if objType == "commit" {
				results[sha] = "commit"
			} else {
				results[sha] = nil // blob, tree, tag — not a commit
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"results": results})
}
```

Note: `encoding/json` is already imported in this file. If not, add it.

**Step 2: Register the route**

In `internal/handler/handler.go`, add after line 246 (the `working-tree` registration):

```go
register("/api/git/verify-commits", middleware.Auth(ServeGitVerifyCommits))
```

**Step 3: Build and verify**

Run: `cd /home/xulongzhe/projects/clawbench && go build -o clawbench ./cmd/server`
Expected: compiles without errors

**Step 4: Test manually**

Run the server, then:
```bash
curl -X POST http://localhost:20000/api/git/verify-commits \
  -H "Content-Type: application/json" \
  -d '{"shas": ["HEAD", "invalid12345"]}'
```
Expected: `{"results":{"HEAD":"commit","invalid12345":null}}`

**Step 5: Commit**

```bash
git add internal/handler/git.go internal/handler/handler.go
git commit -m "feat: add POST /api/git/verify-commits endpoint"
```

---

### Task 2: Frontend — Add `annotateCommitHashes()` and `verifyCommitHashes()` to `useFilePathAnnotation.ts`

**Files:**
- Modify: `web/src/composables/useFilePathAnnotation.ts`

**Step 1: Add commit hash regex and icon constant**

Add after the `FILE_OPEN_ICON_SVG` constant (line 55):

```typescript
/**
 * SVG icon markup for the commit-open button (git-commit icon).
 * A small circle with a line through it — resembles a commit node.
 */
export const COMMIT_OPEN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>'

/**
 * Regex that matches potential git commit hashes in plain text.
 * Matches 7-40 character hex strings with at least one a-f letter.
 * Word-boundary delimited to avoid matching inside longer strings.
 * Pure-decimal 7-digit numbers (timestamps, byte counts) are excluded
 * because git commit hashes are SHA-1 values that virtually always
 * contain at least one hex letter.
 */
const COMMIT_HASH_RE = /\b([0-9a-f]{7,40})\b/gi
```

**Step 2: Add helper to check if a string looks like a commit hash**

Add after `looksLikeFilePath()` (line 93):

```typescript
/**
 * Check if a string looks like a git commit hash.
 * Must be 7-40 hex chars and contain at least one a-f letter
 * (to exclude pure-decimal strings like timestamps and byte counts).
 */
function looksLikeCommitHash(text: string): boolean {
    if (text.length < 7 || text.length > 40) return false
    if (!/^[0-9a-f]+$/i.test(text)) return false
    return /[a-f]/i.test(text)
}
```

**Step 3: Add `commitOpenButtonHtml()` helper**

Add after `fileOpenButtonHtml()` (line 62):

```typescript
/**
 * Generate HTML for the small commit-open button.
 */
export function commitOpenButtonHtml(sha: string): string {
    return `<button class="chat-commit-open-btn" data-commit-sha="${escapeHtml(sha)}" title="${escapeHtml(gt('chat.attach.openCommit'))}">${COMMIT_OPEN_ICON_SVG}</button>`
}
```

**Step 4: Add `annotateCommitHashes()` function**

Add after the `annotateFilePaths()` function (after line 223). This follows the same DOM-traversal pattern as `annotateFilePaths` Step 2 and Step 3, but simpler — only `<code>` tags and bare text nodes need processing.

```typescript
/**
 * Detect potential git commit hashes in rendered HTML and insert open-commit buttons after them.
 *
 * Processing order:
 *   1. <code> tags whose text content looks like a commit hash → add class + button
 *   2. Text nodes (outside pre/a/code) → regex match hashes → insert span + button
 *
 * Returns the annotated HTML and a list of detected SHAs for the caller to verify asynchronously.
 */
export function annotateCommitHashes(
    html: string,
): { html: string; detectedSHAs: string[] } {
    if (!html) return { html: '', detectedSHAs: [] }

    const detectedSHAs: string[] = []

    const doc = new DOMParser().parseFromString(html, 'text/html')

    // ── Step 1: <code> tags whose content looks like a commit hash ──
    for (const code of doc.querySelectorAll('code')) {
        // Skip <code> inside <pre> blocks
        if (code.closest('pre')) continue
        // Skip <code> already annotated as file path
        if (code.classList.contains('chat-file-path')) continue
        const stripped = (code.textContent || '').trim()
        if (!looksLikeCommitHash(stripped)) continue
        detectedSHAs.push(stripped)
        code.classList.add('chat-commit-hash')
        code.setAttribute('data-commit-sha', stripped)
        code.insertAdjacentHTML('afterend', commitOpenButtonHtml(stripped))
    }

    // ── Step 2: Text nodes (outside pre/a/code) → regex match hashes ──
    const textNodes: Text[] = []
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Text) {
            const parent = node.parentElement
            if (!parent) return NodeFilter.FILTER_REJECT
            // Skip <pre> blocks
            if (parent.closest('pre')) return NodeFilter.FILTER_REJECT
            // Skip text inside <a> tags
            if (parent.tagName === 'A' || parent.closest('a')) return NodeFilter.FILTER_REJECT
            // Skip text inside <code> tags (handled in step 1)
            if (parent.tagName === 'CODE' || parent.closest('code')) return NodeFilter.FILTER_REJECT
            // Skip already-annotated spans
            if (parent.classList.contains('chat-file-path') || parent.classList.contains('chat-commit-hash')) return NodeFilter.FILTER_REJECT
            return NodeFilter.FILTER_ACCEPT
        }
    })
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

    // Process text nodes in reverse order so that DOM insertions
    // don't invalidate later node positions.
    for (let i = textNodes.length - 1; i >= 0; i--) {
        const textNode = textNodes[i]
        const text = textNode.textContent || ''
        COMMIT_HASH_RE.lastIndex = 0
        if (!COMMIT_HASH_RE.test(text)) continue

        // Re-run regex to collect matches
        COMMIT_HASH_RE.lastIndex = 0
        const parts: Array<{ text: string; sha: string | null }> = []
        let lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = COMMIT_HASH_RE.exec(text)) !== null) {
            const shaStr = match[1]
            const isCommit = looksLikeCommitHash(shaStr)
            // Push the text before this match
            if (match.index > lastIndex) {
                parts.push({ text: text.slice(lastIndex, match.index), sha: null })
            }
            parts.push({ text: shaStr, sha: isCommit ? shaStr : null })
            lastIndex = match.index + shaStr.length
        }
        // Push remaining text after last match
        if (lastIndex < text.length) {
            parts.push({ text: text.slice(lastIndex), sha: null })
        }

        // Build replacement nodes
        const parent = textNode.parentNode!
        const frag = doc.createDocumentFragment()
        let hasAnnotation = false
        for (const part of parts) {
            if (part.sha) {
                hasAnnotation = true
                detectedSHAs.push(part.sha)
                const span = doc.createElement('span')
                span.className = 'chat-commit-hash'
                span.setAttribute('data-commit-sha', part.sha)
                span.textContent = part.text
                frag.appendChild(span)
                // Commit-open button
                const btnContainer = doc.createElement('span')
                btnContainer.innerHTML = commitOpenButtonHtml(part.sha)
                while (btnContainer.firstChild) frag.appendChild(btnContainer.firstChild)
            } else {
                frag.appendChild(doc.createTextNode(part.text))
            }
        }

        if (hasAnnotation) {
            parent.replaceChild(frag, textNode)
        }
    }

    return { html: doc.body.innerHTML, detectedSHAs }
}
```

**Step 5: Add `verifyCommitHashes()` function**

Add after `verifyFilePaths()` (after line 284). Follows the same pattern — batch verify, then remove invalid annotations from DOM.

```typescript
// Cache of verified commit SHAs: sha -> true (is commit) | false (not a commit)
const verifiedCommitCache = new Map<string, boolean>()
// In-flight verification requests to avoid duplicates
const commitInFlight = new Map<string, Promise<boolean>>()

async function checkCommitExists(sha: string): Promise<boolean> {
    if (verifiedCommitCache.has(sha)) return verifiedCommitCache.get(sha)!
    if (commitInFlight.has(sha)) return commitInFlight.get(sha)!

    const promise = (async () => {
        try {
            const resp = await fetch('/api/git/verify-commits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shas: [sha] }),
            })
            if (!resp.ok) return true // Network error — assume exists (best effort)
            const data = await resp.json()
            return data.results?.[sha] === 'commit'
        } catch {
            return true // Network error — assume exists (best effort)
        }
    })()

    commitInFlight.set(sha, promise)
    const isCommit = await promise
    verifiedCommitCache.set(sha, isCommit)
    commitInFlight.delete(sha)
    return isCommit
}

/**
 * Check which commit SHAs are valid git commit objects,
 * and hide buttons/annotations for SHAs that aren't.
 */
export async function verifyCommitHashes(shas: string[], containerEl: HTMLElement): Promise<void> {
    const unique = [...new Set(shas)]
    if (unique.length === 0) return

    // Batch verify: send all SHAs in one request
    let results: Map<string, boolean>
    try {
        const resp = await fetch('/api/git/verify-commits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shas: unique }),
        })
        if (!resp.ok) return
        const data = await resp.json()
        results = new Map(Object.entries(data.results || {}).map(([sha, type]) => [sha, type === 'commit']))
        // Update cache
        for (const [sha, isCommit] of results) {
            verifiedCommitCache.set(sha, isCommit)
        }
    } catch {
        return // Network error — leave buttons as-is
    }

    for (const [sha, isCommit] of results) {
        if (!isCommit) {
            containerEl.querySelectorAll(`.chat-commit-open-btn[data-commit-sha="${CSS.escape(sha)}"]`).forEach(btn => {
                btn.remove()
            })
            containerEl.querySelectorAll(`.chat-commit-hash[data-commit-sha="${CSS.escape(sha)}"]`).forEach(span => {
                span.replaceWith(...span.childNodes)
            })
        }
    }
}
```

**Step 6: Update `clearVerifiedCache()` to also clear commit caches**

Modify the existing `clearVerifiedCache()` function (line 289) to also clear commit verification caches:

```typescript
export function clearVerifiedCache(): void {
    verifiedCache.clear()
    inFlight.clear()
    verifiedCommitCache.clear()
    commitInFlight.clear()
}
```

**Step 7: Update the composable return to export new functions**

Update `useFilePathAnnotation()` return (line 298) to include:

```typescript
export function useFilePathAnnotation() {
    return {
        resolveFilePath,
        fileOpenButtonHtml,
        annotateFilePaths,
        verifyFilePaths,
        annotateCommitHashes,
        verifyCommitHashes,
        resolveRelativePath,
        openFilePath,
        clearVerifiedCache,
    }
}
```

**Step 8: Commit**

```bash
git add web/src/composables/useFilePathAnnotation.ts
git commit -m "feat: add annotateCommitHashes and verifyCommitHashes to useFilePathAnnotation"
```

---

### Task 3: Frontend — Integrate commit hash annotation into the rendering pipeline

**Files:**
- Modify: `web/src/composables/useChatRender.ts`

**Step 1: Destructure new functions from `useFilePathAnnotation`**

In `useChatRender`, update the destructuring (line 30) to include the new functions:

```typescript
const { annotateFilePaths, verifyFilePaths, annotateCommitHashes, verifyCommitHashes } = useFilePathAnnotation()
```

**Step 2: Add `data-commit-sha` to DOMPurify allowlist**

In the `DOMPurify.sanitize()` call (line 133), add `data-commit-sha` to `ADD_ATTR`:

```typescript
html = DOMPurify.sanitize(html, { ADD_TAGS: ['math', 'button'], ADD_ATTR: ['data-file-path', 'data-commit-sha', 'data-url', 'data-port', 'data-protocol', 'title'] })
```

**Step 3: Add commit hash annotation to the rendering pipeline**

After the file path verification block (after line 178, before the localhost annotation line 180), insert:

```typescript
      // Annotate commit hashes (7-40 hex chars with at least one a-f letter)
      const { html: commitAnnotatedHtml, detectedSHAs } = annotateCommitHashes(html)
      html = commitAnnotatedHtml
      if (detectedSHAs.length > 0) {
        const uniqueSHAs = [...new Set(detectedSHAs)]
        nextTick(() => {
          const el = document.getElementById('aiChatMessages')
          if (el) verifyCommitHashes(uniqueSHAs, el)
        })
      }
```

**Step 4: Commit**

```bash
git add web/src/composables/useChatRender.ts
git commit -m "feat: integrate commit hash annotation into chat rendering pipeline"
```

---

### Task 4: Frontend — Add `commitNavigateSha` to store and wire click handler

**Files:**
- Modify: `web/src/stores/app.ts`
- Modify: `web/src/components/chat/ChatMessageList.vue`

**Step 1: Add `commitNavigateSha` to the store state**

In `stores/app.ts`, add to the `AppState` interface (after line 84, in the Git section):

```typescript
    // Git navigation
    commitNavigateSha: string | null
```

Add to the `state` reactive object (after line 129):

```typescript
    commitNavigateSha: null,
```

**Step 2: Expose `setCommitNavigate` in the store**

Add a new function after `loadGitBranch()` (after line 181):

```typescript
function setCommitNavigate(sha: string): void {
    state.commitNavigateSha = sha
}
```

Add to the store export (line 434):

```typescript
    setCommitNavigate,
```

**Step 3: Add click handler in ChatMessageList.vue**

In `ChatMessageList.vue`, find the `handleChatClick` function (line 183). Add a new handler block between the file-path button handler (line 215-226) and the `handleDblClick` call (line 227):

```javascript
  // 4. Commit hash open button
  const commitBtn = (event.target).closest('.chat-commit-open-btn')
  if (commitBtn) {
    event.preventDefault()
    event.stopPropagation()
    const sha = commitBtn.getAttribute('data-commit-sha')
    if (sha) {
      store.setCommitNavigate(sha)
      chatUI.closeSheet?.()
    }
    return
  }
```

Also add the import for `store` if not already present. Check existing imports in the file.

**Step 4: Commit**

```bash
git add web/src/stores/app.ts web/src/components/chat/ChatMessageList.vue
git commit -m "feat: add commitNavigateSha to store and click handler in ChatMessageList"
```

---

### Task 5: Frontend — Wire GitHistoryDrawer to respond to `commitNavigateSha`

**Files:**
- Modify: `web/src/components/git/GitHistoryDrawer.vue`
- Modify: `web/src/components/git/GitHistoryContent.vue`
- Modify: `web/src/App.vue`

**Step 1: Add `navigateToCommit` function to GitHistoryDrawer.vue**

In `GitHistoryDrawer.vue`, add a `navigateToCommit` function after `onCommitSelect` (line 406):

```javascript
// Navigate directly to a specific commit's files view
// Used when clicking a commit hash link from chat
function navigateToCommit(sha) {
  selectedSHA.value = sha
  currentView.value = 'files'
  loadCommitFiles(sha).catch(() => {})
}
```

**Step 2: Add watcher for `commitNavigateSha` in GitHistoryDrawer.vue**

Add after the `navigateToCommit` function:

```javascript
// Watch for commit navigation requests from chat (commit hash links)
watch(() => store.state.commitNavigateSha, (sha) => {
  if (!sha) return
  store.state.commitNavigateSha = null // consume
  navigateToCommit(sha)
})
```

**Step 3: Add `navigateToCommit` function to GitHistoryContent.vue**

Open `GitHistoryContent.vue` and add the same `navigateToCommit` function and watcher. This component is used in the History tab, so it also needs to respond.

```javascript
// Navigate directly to a specific commit's files view
function navigateToCommit(sha) {
  selectedSHA.value = sha
  currentView.value = 'files'
  loadCommitFiles(sha).catch(() => {})
}

// Watch for commit navigation requests from chat (commit hash links)
watch(() => store.state.commitNavigateSha, (sha) => {
  if (!sha) return
  store.state.commitNavigateSha = null // consume
  navigateToCommit(sha)
})
```

**Step 4: Add `navigate-to-commit` custom event in App.vue**

In `App.vue`, add a window event listener for `navigate-to-commit` (similar to `open-file-manager`). This ensures that when a commit hash is clicked, the app also switches to the History tab.

Add a handler function after `handleOpenFileManager` (line 573):

```javascript
function handleNavigateToCommit(e) {
    const sha = e?.detail?.sha
    if (sha) {
        store.setCommitNavigate(sha)
    }
    activeTab.value = 'history'
}
```

Register in `onMounted` (after line 615):

```javascript
window.addEventListener('navigate-to-commit', handleNavigateToCommit)
```

Unregister in `onUnmounted` (after line 683):

```javascript
window.removeEventListener('navigate-to-commit', handleNavigateToCommit)
```

**Step 5: Update ChatMessageList click handler to dispatch event**

In `ChatMessageList.vue`, update the commit button click handler (from Task 4, Step 3) to also dispatch the `navigate-to-commit` event:

```javascript
  // 4. Commit hash open button
  const commitBtn = (event.target).closest('.chat-commit-open-btn')
  if (commitBtn) {
    event.preventDefault()
    event.stopPropagation()
    const sha = commitBtn.getAttribute('data-commit-sha')
    if (sha) {
      window.dispatchEvent(new CustomEvent('navigate-to-commit', { detail: { sha } }))
      chatUI.closeSheet?.()
    }
    return
  }
```

This replaces the `store.setCommitNavigate(sha)` call with the custom event, which both sets the navigate state AND switches to the history tab.

**Step 6: Commit**

```bash
git add web/src/components/git/GitHistoryDrawer.vue web/src/components/git/GitHistoryContent.vue web/src/App.vue web/src/components/chat/ChatMessageList.vue
git commit -m "feat: wire GitHistory to respond to commit navigation from chat"
```

---

### Task 6: Frontend — Add CSS styles for commit hash annotations

**Files:**
- Modify: `web/src/assets/main.css` (or wherever `.chat-file-path` styles are defined)

**Step 1: Add CSS for commit hash annotations**

Find where `.chat-file-path` and `.chat-file-open-btn` styles are defined, and add matching styles for commit hashes:

```css
/* Commit hash annotation in chat messages */
.chat-commit-hash {
    font-family: monospace;
    color: var(--color-primary, #0066cc);
    cursor: pointer;
}

.chat-commit-open-btn {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    margin-left: 2px;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-primary, #0066cc);
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.15s;
}

.chat-commit-open-btn:hover {
    opacity: 1;
}
```

Note: Check the exact location of `.chat-file-path` and `.chat-file-open-btn` styles and place these right next to them.

**Step 2: Commit**

```bash
git add web/src/assets/main.css
git commit -m "feat: add CSS styles for commit hash annotations in chat"
```

---

### Task 7: Frontend — Add i18n key for button title

**Files:**
- Modify: `web/src/locales/zh.json`
- Modify: `web/src/locales/en.json`

**Step 1: Add translation key**

In both locale files, under the `chat.attach` section, add:

```json
"openCommit": "打开 Commit 详情"
```

```json
"openCommit": "Open commit details"
```

**Step 2: Commit**

```bash
git add web/src/locales/zh.json web/src/locales/en.json
git commit -m "feat: add i18n key for commit hash open button"
```

---

### Task 8: End-to-end verification

**Step 1: Build the full project**

Run: `cd /home/xulongzhe/projects/clawbench && ./build.sh`
Expected: both Go binary and Vue frontend build without errors

**Step 2: Start the server**

Run: `./server.sh`

**Step 3: Test manually**

1. Open the chat panel
2. Send a message to the AI that includes a commit hash reference (e.g., "show me commit abc1234")
3. After the response renders, verify:
   - The commit hash is highlighted with a different color
   - A small git-commit icon button appears next to the hash
   - If the hash is not a valid commit, the button should disappear after verification
4. Click the commit button
5. Verify:
   - Chat sheet closes
   - The app switches to the History tab
   - The Git history shows the commit's files view for that SHA

**Step 4: Commit**

```bash
git commit --allow-empty -m "chore: commit hash link feature complete - verified end-to-end"
```
