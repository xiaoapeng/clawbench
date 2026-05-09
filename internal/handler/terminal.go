package handler

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"clawbench/internal/middleware"
	"clawbench/internal/model"
	"clawbench/internal/service"
	"clawbench/internal/terminal"
)

// terminalMgr is set via SetTerminalManager during startup.
var terminalMgr *terminal.Manager

// SetTerminalManager sets the terminal manager for handlers.
func SetTerminalManager(m *terminal.Manager) {
	terminalMgr = m
}

// TerminalWebSocket handles WebSocket connections for the interactive terminal.
func TerminalWebSocket(w http.ResponseWriter, r *http.Request) {
	if terminalMgr == nil || !terminalMgr.IsEnabled() {
		writeLocalizedErrorf(w, r, http.StatusServiceUnavailable, "TerminalDisabled")
		return
	}

	// Get project path from cookie
	projectPath := middleware.GetProjectFromCookie(r)
	if projectPath == "" {
		writeLocalizedError(w, r, model.Forbidden(nil, "NoProjectSelected"))
		return
	}

	// Get cwd from query parameter (relative path within project)
	cwd := projectPath
	if relCwd := r.URL.Query().Get("cwd"); relCwd != "" {
		absCwd, ok := model.ValidatePath(projectPath, relCwd)
		if !ok {
			writeLocalizedError(w, r, model.Forbidden(nil, "TerminalCwdInvalid"))
			return
		}
		cwd = absCwd
	}

	if err := terminalMgr.HandleWebSocket(w, r, projectPath, cwd); err != nil {
		slog.Error("terminal: websocket handler error", slog.String("error", err.Error()))
		writeLocalizedErrorf(w, r, http.StatusInternalServerError, "TerminalError")
	}
}

// TerminalStatus returns the current terminal session status.
func TerminalStatus(w http.ResponseWriter, r *http.Request) {
	if terminalMgr == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled": false,
		})
		return
	}

	hasSession, cwd, running := terminalMgr.Status()
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":    terminalMgr.IsEnabled(),
		"hasSession": hasSession,
		"cwd":        cwd,
		"running":    running,
	})
}

// TerminalClose closes the current terminal session.
func TerminalClose(w http.ResponseWriter, r *http.Request) {
	if terminalMgr == nil || !terminalMgr.IsEnabled() {
		writeLocalizedErrorf(w, r, http.StatusServiceUnavailable, "TerminalDisabled")
		return
	}

	terminalMgr.CloseSession()
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
	})
}

// TerminalConfigHandler returns the terminal configuration for the frontend.
func TerminalConfigHandler(w http.ResponseWriter, r *http.Request) {
	if terminalMgr == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled": false,
		})
		return
	}

	cfg := terminalMgr.Config()
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": cfg.Enabled,
	})
}

// ServeQuickCommands handles GET (list) and POST (create) for quick commands,
// and PUT /reorder for batch reordering.
func ServeQuickCommands(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cmds, err := service.GetQuickCommands()
		if err != nil {
			slog.Error("failed to get quick commands", slog.String("error", err.Error()))
			writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
			return
		}
		if cmds == nil {
			cmds = []service.QuickCommand{}
		}
		writeJSON(w, http.StatusOK, cmds)

	case http.MethodPost:
		var req struct {
			Label       string `json:"label"`
			Command     string `json:"command"`
			Hidden      bool   `json:"hidden"`
			AutoExecute bool   `json:"auto_execute"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		req.Label = strings.TrimSpace(req.Label)
		req.Command = strings.TrimSpace(req.Command)
		if req.Label == "" || req.Command == "" {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
			return
		}
		if len(req.Label) > 100 || len(req.Command) > 4096 {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
			return
		}
		id, err := service.AddQuickCommand(req.Label, req.Command, req.Hidden, req.AutoExecute)
		if err != nil {
			slog.Error("failed to add quick command", slog.String("error", err.Error()))
			writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"id": id, "label": req.Label, "command": req.Command,
			"hidden": req.Hidden, "auto_execute": req.AutoExecute,
		})

	case http.MethodPut:
		// PUT /api/terminal/quick-commands/reorder
		path := strings.TrimPrefix(r.URL.Path, "/api/terminal/quick-commands")
		if strings.TrimPrefix(path, "/") == "reorder" {
			var req struct {
				IDs []int64 `json:"ids"`
			}
			if !decodeJSON(w, r, &req) {
				return
			}
			if len(req.IDs) == 0 {
				writeJSON(w, http.StatusOK, map[string]any{"success": true})
				return
			}
			if err := service.ReorderQuickCommands(req.IDs); err != nil {
				slog.Error("failed to reorder quick commands", slog.String("error", err.Error()))
				writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"success": true})
			return
		}
		writeLocalizedErrorf(w, r, http.StatusMethodNotAllowed, "MethodNotAllowed")

	default:
		writeLocalizedErrorf(w, r, http.StatusMethodNotAllowed, "MethodNotAllowed")
	}
}

// ServeQuickCommandByID handles PUT (update) and DELETE for a single quick command.
func ServeQuickCommandByID(w http.ResponseWriter, r *http.Request) {
	// Extract ID from path: /api/terminal/quick-commands/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/terminal/quick-commands/")
	idStr := strings.TrimSuffix(path, "/")
	// Handle sub-paths like "reorder" — those should go to ServeQuickCommands
	if idStr == "" || idStr == "reorder" {
		ServeQuickCommands(w, r)
		return
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
		return
	}

	switch r.Method {
	case http.MethodPut:
		var req struct {
			Label       string `json:"label"`
			Command     string `json:"command"`
			Hidden      bool   `json:"hidden"`
			AutoExecute bool   `json:"auto_execute"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		req.Label = strings.TrimSpace(req.Label)
		req.Command = strings.TrimSpace(req.Command)
		if req.Label == "" || req.Command == "" {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
			return
		}
		if len(req.Label) > 100 || len(req.Command) > 4096 {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
			return
		}
		if err := service.UpdateQuickCommand(id, req.Label, req.Command, req.Hidden, req.AutoExecute); err != nil {
			slog.Error("failed to update quick command", slog.String("error", err.Error()))
			writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true})

	case http.MethodDelete:
		if err := service.DeleteQuickCommand(id); err != nil {
			slog.Error("failed to delete quick command", slog.String("error", err.Error()))
			writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true})

	default:
		writeLocalizedErrorf(w, r, http.StatusMethodNotAllowed, "MethodNotAllowed")
	}
}
