package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"clawbench/internal/model"
	"clawbench/internal/service"
)

// QueueHandler handles pending message queue operations.
// POST   /api/ai/queue?session_id=xxx  — enqueue a message
// GET    /api/ai/queue?session_id=xxx  — get current queue
// DELETE /api/ai/queue?session_id=xxx[&index=N] — remove item or clear all
func QueueHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		handleQueueEnqueue(w, r)
	case http.MethodGet:
		handleQueueGet(w, r)
	case http.MethodDelete:
		handleQueueDelete(w, r)
	default:
		model.WriteErrorf(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func handleQueueEnqueue(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		model.WriteErrorf(w, http.StatusBadRequest, "session_id required")
		return
	}

	var req struct {
		Message   string   `json:"message"`
		FilePaths []string `json:"filePaths"`
		Files     []string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		model.WriteErrorf(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Message == "" && len(req.Files) == 0 && len(req.FilePaths) == 0 {
		model.WriteErrorf(w, http.StatusBadRequest, "message or files required")
		return
	}

	qMsg := model.QueuedMessage{
		Text:      req.Message,
		FilePaths: req.FilePaths,
		Files:     req.Files,
		CreatedAt: time.Now().Format(time.RFC3339),
	}

	queue := service.EnqueueMessage(sessionID, qMsg)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"queue": queue,
	})
}

func handleQueueGet(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		model.WriteErrorf(w, http.StatusBadRequest, "session_id required")
		return
	}

	queue := service.GetQueue(sessionID)
	if queue == nil {
		queue = []model.QueuedMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"queue": queue,
	})
}

func handleQueueDelete(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		model.WriteErrorf(w, http.StatusBadRequest, "session_id required")
		return
	}

	indexStr := r.URL.Query().Get("index")
	if indexStr == "" {
		// Clear all
		service.ClearQueue(sessionID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	// Remove specific item
	index, err := strconv.Atoi(indexStr)
	if err != nil {
		model.WriteErrorf(w, http.StatusBadRequest, "invalid index")
		return
	}

	queue := service.RemoveQueueItem(sessionID, index)
	if queue == nil {
		queue = []model.QueuedMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"queue": queue,
	})
}
