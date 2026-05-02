# Pending Message Queue Design

**Date:** 2026-06-04
**Status:** Draft

## Problem

When AI is streaming output, the input bar is completely disabled — the user cannot type or send new messages until the AI finishes. This blocks the user's workflow, especially when they want to queue up follow-up questions while the AI is still generating.

## Solution

Allow users to type and send messages during AI streaming. These messages enter a **pending queue** rendered inline in the message list. When the AI finishes, the first pending message auto-sends; subsequent messages execute serially, each waiting for the previous AI response to complete. Users can delete pending messages at any time. Stopping the AI preserves the queue but does not auto-execute the next message.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pending message UI location | Embedded in message list | Natural context, visible alongside conversation |
| Execution order | Serial, one at a time | AI can respond to each message individually |
| Stop button behavior | Stop current + keep queue | User retains control over queued messages |
| Post-stop execution | Manual only | Stop means stop; no surprise auto-sends |
| Input bar during streaming | Both stop + send buttons visible | User can stop or queue at any time |
| Visual style | Dashed border + semi-transparent + "waiting" label | Clear distinction from sent messages |
| Persistence | None (in-memory only) | Pending messages are temporary intent; loss is acceptable |

## Data Model

```ts
interface PendingMessage {
  id: string          // crypto.randomUUID()
  content: string     // Message text
  filePaths?: string[] // Attached file paths (server-side paths)
  createdAt: number   // Timestamp
}
```

New reactive state in `ChatPanel.vue`:

```ts
const pendingMessages = ref<PendingMessage[]>([])
```

Pending messages are **not** added to the `messages` array. They are rendered separately in the message list.

## UI Changes

### Input Bar (ChatInputBar.vue)

**Before:** `loading=true` → send button disappears, replaced by stop button; textarea disabled.

**After:**

```
AI streaming:
[Input field ....................] [⏹ Stop] [➤ Send]

AI idle:
[Input field ....................] [➤ Send]
```

- Stop button: `v-if="loading"`, left position in button area
- Send button: **always visible**, no longer `v-else` hidden
- Send button when `loading`: visual hint (e.g., orange color or "queue" badge) indicating the message will be queued
- Textarea: **always editable**, never disabled due to loading
- Attach button: **always enabled**

### Pending Messages in Message List

Rendered after the last assistant message, before the input bar:

```
┌─────────────────────────────┐
│  [assistant message - streaming] │
│  ...generating...                │
└─────────────────────────────┘

┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   ← dashed border
│ 🕐 Waiting                    │   ← label
│ Check the test coverage       │   ← message content
│                           ✕  │   ← delete button
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘

┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│ 🕐 Waiting                    │
│ Refactor this function        │
│                           ✕  │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Style:**
- `border: 1px dashed var(--border-color)`
- `opacity: 0.6`
- Top-right: "waiting" label (small font, secondary color)
- Bottom-right: × delete button (always visible on mobile, hover-visible on desktop)
- Ordered by `createdAt`, FIFO

**Implementation:**
- New `PendingMessageItem.vue` component, or `ChatMessageItem.vue` with a `pending` mode
- Rendered in `ChatMessageList.vue` after the main message list
- Delete triggers `removePendingMessage(id)` from `pendingMessages`

## Core Logic Changes

### ChatPanel.vue

#### New: `enqueueMessage()`

```ts
function enqueueMessage(text: string, filePaths: string[] = []) {
  pendingMessages.value.push({
    id: crypto.randomUUID(),
    content: text,
    filePaths,
    createdAt: Date.now()
  })
  // Clear input (reuse existing cleanup)
}
```

#### Modified: `sendMessage()`

```ts
function sendMessage(text: string, filePaths: string[] = []) {
  if (loading.value) {
    // AI is streaming → enqueue
    enqueueMessage(text, filePaths)
    return
  }
  // Original send logic unchanged...
}
```

#### New: `sendMessageNow()`

Extract the actual send logic from `sendMessage()` into `sendMessageNow()` so it can be called by both the user and the queue consumer without the loading guard:

```ts
function sendMessageNow(text: string, filePaths: string[] = []) {
  // Original sendMessage body (without loading guard)
  // 1. Optimistic user message
  // 2. Clear input
  // 3. Lock input / set loading
  // 4. POST /api/ai/chat
  // 5. Connect stream
}
```

#### Queue Consumer: onStreamEnd Callback

When `useChatStream` finishes (via `done`, `cancelled`, or `error`), it invokes a callback. The callback behavior depends on the end reason:

```ts
onStreamEnd: (reason: 'done' | 'cancelled' | 'error') => {
  if (reason === 'done' && pendingMessages.value.length > 0) {
    const next = pendingMessages.value.shift()!
    nextTick(() => {
      sendMessageNow(next.content, next.filePaths)
    })
  }
  // cancelled or error → do not consume queue
}
```

#### Modified: Stop Button

```ts
function handleCancel() {
  stream.cancelStream()
  // Do NOT clear pendingMessages
  // Do NOT auto-execute next pending message
  // cancelled reason in onStreamEnd prevents queue consumption
}
```

#### New: `removePendingMessage()`

```ts
function removePendingMessage(id: string) {
  const idx = pendingMessages.value.findIndex(m => m.id === id)
  if (idx !== -1) pendingMessages.value.splice(idx, 1)
}
```

### `inputDisabled` Semantic Change

- **Before:** `inputDisabled = true` whenever `loading = true`
- **After:** `inputDisabled` is only `true` during session switching or initial loading. **No longer linked to `loading`.**
- The textarea is controlled by `inputDisabled` (session switch guard), not by `loading`.
- The send/stop button display is controlled by `loading`.

### useChatStream.ts

- Add `reason` parameter to stream-end handling so the callback can distinguish `done` vs `cancelled` vs `error`.
- `done` event → invoke `onStreamEnd('done')`
- `cancelled` event → invoke `onStreamEnd('cancelled')`
- `error` event → invoke `onStreamEnd('error')`
- `forceCleanupStreamingState()` → invoke `onStreamEnd('error')` (already treated as abnormal end)

### useChatSession.ts

- `loadHistory()` and `switchSession()`: when `data.running` is true, still set `loading=true` but **do not set `inputDisabled=true`**.
- New sessions and loaded sessions should have empty `pendingMessages`.

## Edge Cases

### 1. Pending Message Execution Failure

When a pending message auto-sends but the API call fails:
- Remove the message from queue (attempted send)
- Push an error assistant message (reuse existing error handling)
- **Pause queue consumption** — do not auto-execute remaining messages
- User sees the error and can manually continue

### 2. Switching Sessions During Streaming

- `pendingMessages` belongs to the current session context
- On session switch, `pendingMessages` is cleared (no persistence)
- Consistent with "pending messages are temporary" design

### 3. Pending Messages with Attachments

- Files are uploaded to server immediately when attached (existing behavior)
- `PendingMessage.filePaths` stores server-side paths
- Execution sends paths normally — no special handling needed

### 4. Empty Text + Attachments

- Allowed to queue (reuse existing `handleSendClick` logic)
- Quick-send presets also support queuing

### 5. Concurrency Protection

- `sendMessageNow()` checks `loading.value` before executing
- If somehow called while still streaming, the message is pushed back to the front of the queue
- Queue consumption uses `shift()` — no duplicate extraction

### 6. Auto-Scroll

- New pending message added → auto-scroll to bottom (reuse existing scroll logic)
- AI finishes + auto-sends next → auto-scroll to bottom
- Pending message deleted → scroll position unchanged

## Files to Modify

| File | Changes |
|------|---------|
| `ChatPanel.vue` | Add `pendingMessages` state, `enqueueMessage()`, `sendMessageNow()`, `removePendingMessage()`, modify `sendMessage()`, add `onStreamEnd` callback |
| `ChatInputBar.vue` | Always show send button alongside stop button, keep textarea enabled during loading, send button visual hint when queuing |
| `ChatMessageList.vue` | Render pending messages after main message list, auto-scroll on queue changes |
| `PendingMessageItem.vue` (new) | Dashed-border pending message card with delete button |
| `useChatStream.ts` | Add `reason` parameter to stream-end callback, expose `onStreamEnd` option |
| `useChatSession.ts` | Remove `inputDisabled=true` when `loading=true` |

## Out of Scope

- Persistence of pending messages (localStorage, DB) — may revisit if users request it
- Reordering pending messages — FIFO is sufficient for now
- Editing pending messages — delete and re-type is simpler
- Global queue across sessions — pending messages are session-scoped
