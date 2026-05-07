---
name: rag-search
description: Search historical conversations for past decisions and analyses
condition: rag.enabled
triggers:
  - Searching past conversations or discussions
  - Finding previously handled issues or decisions
  - User mentions "before", "last time", "previously discussed"
  - Needing historical context to understand a current issue
---

## RAG History Memory

You can search all historical conversations to find past discussions, analyses, and solutions.

**When to use:** When the user's question involves past conversation content, previously handled issues, historical decisions, or analysis workflows, proactively search historical memory.

**Search API:**
- Endpoint: GET http://localhost:{{PORT}}/api/rag/search
- Parameters: q (query text, required), limit (number of results, default 5), project (project path), backend (backend name), role (filter by "user" or "assistant"), session_id (limit to this session), exclude_session_id (exclude this session from results), from/to (time range)
- Example: curl "http://localhost:{{PORT}}/api/rag/search?q=SSH+tunnel+keepalive&limit=3&exclude_session_id=abc-123"
- Search results return `chunk_text` (a text excerpt) and `message_id`. The chunk only contains the text portion of a message — thinking blocks and tool calls are excluded from the index.

**Message Detail API:**
- Endpoint: GET http://localhost:{{PORT}}/api/rag/message?id={message_id}
- Returns the complete message including all content blocks (text, thinking, tool_use, warning, error)
- Example: curl "http://localhost:{{PORT}}/api/rag/message?id=42"
- Use this when you need to see the full context around a search hit — especially tool calls and thinking process that were not included in the chunk

**Session API:**
- Endpoint: GET http://localhost:{{PORT}}/api/rag/session?session_id={session_id}
- Returns all messages in a session (complete conversation including user messages, AI responses with thinking and tool_use blocks)
- Example: curl "http://localhost:{{PORT}}/api/rag/session?session_id=abc-123"
- Use this when you need the full conversation flow around a search hit — e.g., to understand the complete problem-solving process, not just one message

**Usage Principles:**
1. Do not search every time — only call when the user explicitly mentions or implies needing historical context
2. Always pass exclude_session_id with the current session ID to avoid returning content already in context
3. Use concise and precise query terms when searching, do not paste the entire question verbatim
4. Each search result has a `role` field ("user" or "assistant") — distinguish whether the content was said by the user or the AI
5. session_title and created_at in search results can help you locate context
6. When a search hit is relevant but the chunk_text is incomplete, fetch the full message using the Message Detail API with its message_id — this reveals tool_use blocks and thinking process
7. For deeper context, use the Session API with session_id to retrieve the entire conversation — this shows the full problem-solving flow including all user messages, AI reasoning, and tool interactions
8. If search returns no results, answer based on your own knowledge without mentioning RAG
