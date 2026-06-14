/**
 * Pure functions and constants extracted from useChatStream composable.
 * These have no Vue reactivity dependencies and can be tested in isolation.
 */

/**
 * Detect garbage output values that come from intermediate ACP ToolCallUpdate
 * events (e.g., a lone "}" from partial JSON streaming). Real tool output
 * from completed tools is always meaningful — at least a few words long.
 */
function isGarbageOutput(output: string | undefined): boolean {
  if (!output) return false
  const trimmed = output.trim()
  // Single character or just braces/brackets — not meaningful output
  if (trimmed.length <= 1) return true
  // Very short strings that are just JSON delimiters
  if (/^[{}\[\],:]+$/.test(trimmed)) return true
  return false
}

/**
 * Tool names that modify files on disk (canonical PascalCase, guaranteed by backend normalization).
 * Used to trigger file preview refresh after tool completion.
 */
export const FILE_MODIFYING_TOOLS = new Set(['Write', 'Edit'])

/**
 * Find the most recent block of a given type by searching backward.
 * tool_use blocks act as natural boundaries — text/thinking after a tool_use
 * should not be merged with text/thinking before it.
 */
export function findLastBlockOfType(blocks: any[], type: string): any | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === type) return blocks[i]
    // tool_use blocks are natural boundaries — don't merge across them
    if (blocks[i].type === 'tool_use') return undefined
  }
  return undefined
}

/**
 * Clean up streaming state for the current assistant message.
 * Marks all unfinished tool_use blocks as done, removes streaming flag.
 * Returns the streaming message if found (for caller to do further processing).
 */
export function forceCleanupStreamingState(
  messages: any[],
  callbacks: {
    onRenderNeeded: (forceFull?: boolean) => void
    onExtractScheduledTasks?: (msgs: any[]) => void
  }
): any | undefined {
  const streamingMsg = messages.find((m: any) => m.role === 'assistant' && m.streaming)
  if (streamingMsg) {
    delete streamingMsg.streaming
    // Mark all unfinished tool_use blocks as done so spinner stops.
    // Exception: PermissionApproval blocks require user interaction —
    // marking them done without a real result makes the card appear
    // "Approved" when it's actually stuck (no user response received).
    if (streamingMsg.blocks) {
      for (const block of streamingMsg.blocks) {
        if (block.type === 'tool_use' && !block.done && block.name !== 'PermissionApproval') {
          block.done = true
          // Clear garbage output that may have been set by intermediate
          // ACP ToolCallUpdate events (e.g., a lone "}" from partial JSON).
          // Real output arrives via tool_result events which set done=true.
          if (isGarbageOutput(block.output)) {
            block.output = ''
          }
        }
      }
    }
    // Extract scheduled tasks from the just-finished message
    // (this path doesn't go through loadHistory, so we must call it explicitly)
    callbacks.onExtractScheduledTasks?.(messages)

    // If the streaming message received no content at all (e.g. network lost
    // before any SSE event arrived), remove it entirely so the user doesn't
    // see an empty AI reply bubble.
    const hasContent = streamingMsg.content || (streamingMsg.blocks && streamingMsg.blocks.length > 0)
    if (!hasContent) {
      const idx = messages.indexOf(streamingMsg)
      if (idx !== -1) messages.splice(idx, 1)
    }
  }
  callbacks.onRenderNeeded(true)
  return streamingMsg
}

/**
 * Recover a stale streamingMsg reference when guard() fails because the
 * message was removed from the array (e.g. by forceCleanupStreamingState
 * during queue_done, or by loadHistory replacing messages).
 *
 * If the session is still running (isLoading=true), find or create a new
 * streaming assistant message so subsequent SSE events aren't silently dropped.
 *
 * Returns the new streamingMsg, or undefined if recovery is not possible
 * (session changed or not loading).
 */
export function recoverStreamingMsg(
  messages: any[],
  isLoading: boolean,
  currentBackend: string
): any | undefined {
  if (!isLoading) return undefined

  // Try to find an existing streaming message
  const existing = messages.find((m: any) => m.role === 'assistant' && m.streaming)
  if (existing) return existing

  // No streaming message — create one (queue_consume was likely missed)
  const newMsg = {
    role: 'assistant' as const,
    content: '',
    blocks: [] as any[],
    streaming: true,
    createdAt: new Date().toISOString(),
    backend: currentBackend,
  }
  messages.push(newMsg)
  return newMsg
}

/**
 * Prepare the messages array for a queue_consume event.
 * Finalizes any stale streaming message before adding the new user + assistant
 * messages, ensuring correct visual ordering (no AI reply above user message).
 *
 * Returns the new streaming assistant message.
 */
export function prepareQueueConsume(
  messages: any[],
  userContent: string,
  userFiles: string[],
  currentBackend: string,
  callbacks: {
    onRenderNeeded: (forceFull?: boolean) => void
    onExtractScheduledTasks?: (msgs: any[]) => void
  }
): any {
  // Finalize any stale streaming message to prevent wrong ordering
  forceCleanupStreamingState(messages, callbacks)

  // Add user message (deduplicate: skip if a local message with same content exists)
  const existingUserMsg = messages.find(
    (m: any) => m.role === 'user' && m.content === userContent && !m.id
  )
  if (!existingUserMsg) {
    messages.push({
      role: 'user',
      content: userContent,
      blocks: userContent ? [{ type: 'text', text: userContent }] : [],
      files: userFiles.map(p => ({ path: p })),
      createdAt: new Date().toISOString(),
    })
  }

  // Create new streaming assistant placeholder
  const newStreamingMsg = {
    role: 'assistant' as const,
    content: '',
    blocks: [] as any[],
    streaming: true,
    createdAt: new Date().toISOString(),
    backend: currentBackend,
  }
  messages.push(newStreamingMsg)
  return newStreamingMsg
}
