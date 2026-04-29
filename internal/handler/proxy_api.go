package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"clawbench/internal/model"
	"clawbench/internal/service"
)

// ServeProxyPorts returns the list of registered forwarded ports with health status.
func ServeProxyPorts(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	ports := service.ProxyService.ListPorts()
	writeJSON(w, http.StatusOK, map[string]any{"ports": ports})
}

// ServeProxyPortAction handles GET (list), POST (register) and DELETE (unregister)
// for proxy ports. DELETE uses query parameter: /api/proxy/ports?port=5173
func ServeProxyPortAction(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		ServeProxyPorts(w, r)
	case http.MethodPost:
		registerPort(w, r)
	case http.MethodDelete:
		unregisterPortByQuery(w, r)
	default:
		model.WriteErrorf(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func registerPort(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Port     int    `json:"port"`
		Name     string `json:"name"`
		Protocol string `json:"protocol"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.Port <= 0 || req.Port > 65535 {
		model.WriteErrorf(w, http.StatusBadRequest, fmt.Sprintf("Invalid port number: %d", req.Port))
		return
	}

	if err := service.ProxyService.RegisterPort(req.Port, req.Name, req.Protocol); err != nil {
		model.WriteErrorf(w, http.StatusForbidden, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func unregisterPortByQuery(w http.ResponseWriter, r *http.Request) {
	portStr := r.URL.Query().Get("port")
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		model.WriteErrorf(w, http.StatusBadRequest, "Invalid port number in query")
		return
	}

	if err := service.ProxyService.UnregisterPort(port); err != nil {
		model.WriteErrorf(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ServeProxyDetect returns auto-detected listening ports on the server.
func ServeProxyDetect(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	ports := service.ProxyService.DetectListeningPorts()
	writeJSON(w, http.StatusOK, map[string]any{"ports": ports})
}
