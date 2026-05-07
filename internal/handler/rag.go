package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"clawbench/internal/model"
	"clawbench/internal/rag"
	"clawbench/internal/service"
)

// RAGSearch handles GET /api/rag/search
// No auth required — only accessible from localhost.
func RAGSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	params := rag.SearchParams{
		Query:            r.URL.Query().Get("q"),
		ProjectPath:      r.URL.Query().Get("project"),
		Backend:          r.URL.Query().Get("backend"),
		Role:             r.URL.Query().Get("role"),
		SessionID:        r.URL.Query().Get("session_id"),
		ExcludeSessionID: r.URL.Query().Get("exclude_session_id"),
		FromTime:         r.URL.Query().Get("from"),
		ToTime:           r.URL.Query().Get("to"),
	}

	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if limit, err := strconv.Atoi(limitStr); err == nil && limit > 0 {
			params.Limit = limit
		}
	}

	if params.Query == "" {
		writeJSON(w, http.StatusOK, rag.SearchResult{Results: []rag.SearchHit{}, Total: 0})
		return
	}

	if ragGlobalStore == nil || ragGlobalEmbedder == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "RAG is not enabled"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, err := rag.RAGSearch(ctx, ragGlobalStore, ragGlobalEmbedder, params, ragDefaultLimit)
	if err != nil {
		http.Error(w, `{"error":"search failed"}`, http.StatusInternalServerError)
		return
	}

	if result.Results == nil {
		result.Results = []rag.SearchHit{}
	}

	writeJSON(w, http.StatusOK, result)
}

// ragGlobalStore and ragGlobalEmbedder are set by SetRAGService during startup.
var (
	ragGlobalStore    *rag.Store
	ragGlobalEmbedder *rag.EmbeddingClient
	ragDefaultLimit   int
)

// SetRAGService configures the RAG handler with store and embedder instances.
func SetRAGService(store *rag.Store, embedder *rag.EmbeddingClient, searchLimit int) {
	ragGlobalStore = store
	ragGlobalEmbedder = embedder
	ragDefaultLimit = searchLimit
}

// RAGMessage handles GET /api/rag/message
// Returns the full message content (including thinking and tool_use blocks)
// for a given message_id from RAG search results.
// No auth required — only accessible from localhost.
func RAGMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id parameter required"})
		return
	}

	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	msg, err := service.GetMessageByID(id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "message not found"})
		return
	}

	writeJSON(w, http.StatusOK, msg)
}

// RAGSession handles GET /api/rag/session
// Returns all messages in a session by session_id.
// No auth required — only accessible from localhost.
func RAGSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session_id parameter required"})
		return
	}

	messages, err := service.GetMessagesBySessionID(sessionID)
	if err != nil {
		http.Error(w, `{"error":"session not found"}`, http.StatusNotFound)
		return
	}

	if messages == nil {
		messages = []model.ChatMessage{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": sessionID,
		"messages":   messages,
		"total":      len(messages),
	})
}
