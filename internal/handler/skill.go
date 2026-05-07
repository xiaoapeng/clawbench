package handler

import (
	"net/http"
	"strings"

	"clawbench/internal/model"
)

// ServeSkills returns the list of available skills with their summary info.
func ServeSkills(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	// Return list of skills with summary info
	type skillSummary struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Triggers    []string `json:"triggers"`
		Filename    string   `json:"filename"`
	}
	summaries := make([]skillSummary, len(model.Skills))
	for i, s := range model.Skills {
		summaries[i] = skillSummary{
			Name:        s.Name,
			Description: s.Description,
			Triggers:    s.Triggers,
			Filename:    s.Filename,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"skills": summaries,
	})
}

// skillFilenameFromPath extracts and validates the filename from the URL path /api/skills/{filename}.
// Returns empty string if the filename is invalid (contains path traversal or non-.md extension).
func skillFilenameFromPath(path string) string {
	filename := strings.TrimPrefix(path, "/api/skills/")
	// Reject path traversal and sub-paths
	if strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		return ""
	}
	// Must be a .md file
	if !strings.HasSuffix(filename, ".md") {
		return ""
	}
	return filename
}

// ServeSkillFile returns the resolved body content of a specific skill by filename from URL path.
func ServeSkillFile(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	filename := skillFilenameFromPath(r.URL.Path)
	if filename == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid or missing skill filename",
		})
		return
	}
	skill := model.GetSkillByFilename(filename)
	if skill == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "skill not found",
		})
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(skill.Body))
}
