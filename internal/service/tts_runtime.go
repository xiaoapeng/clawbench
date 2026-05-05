package service

import (
	"context"
	"sync"
)

// TTSEvent represents a single event in the TTS generation pipeline.
type TTSEvent struct {
	Type             string `json:"type"`                       // "phase", "result"
	Phase            string `json:"phase,omitempty"`            // "summarizing", "synthesizing" (for type="phase")
	AudioPath        string `json:"audioPath,omitempty"`        // (for type="result")
	Summary          string `json:"summary,omitempty"`          // (for type="result")
	SynthesizeFailed bool   `json:"synthesizeFailed,omitempty"` // (for type="result")
	SynthesizeError  string `json:"synthesizeError,omitempty"`  // (for type="result")
}

// TTSJob represents an in-flight TTS generation job.
type TTSJob struct {
	ID       string
	StreamCh chan TTSEvent
	Cancel   context.CancelFunc
	Done     chan struct{} // closed when job goroutine finishes
}

// ttsJobs stores active TTS jobs keyed by job ID (cache key).
var ttsJobs sync.Map // map[string]*TTSJob

// RegisterTTSJob creates and registers a new TTS job.
func RegisterTTSJob(id string, cancel context.CancelFunc) *TTSJob {
	job := &TTSJob{
		ID:       id,
		StreamCh: make(chan TTSEvent, 16),
		Cancel:   cancel,
		Done:     make(chan struct{}),
	}
	ttsJobs.Store(id, job)
	return job
}

// GetTTSJob returns the TTS job by ID.
func GetTTSJob(id string) (*TTSJob, bool) {
	val, ok := ttsJobs.Load(id)
	if !ok {
		return nil, false
	}
	job, ok := val.(*TTSJob)
	return job, ok
}

// UnregisterTTSJob removes the TTS job and closes its stream channel.
func UnregisterTTSJob(id string) {
	if val, ok := ttsJobs.LoadAndDelete(id); ok {
		if job, ok := val.(*TTSJob); ok {
			close(job.StreamCh)
		}
	}
}

// SendTTSEvent sends an event to the job's stream channel (non-blocking).
// Returns true if the event was sent successfully.
func SendTTSEvent(id string, event TTSEvent) bool {
	val, ok := ttsJobs.Load(id)
	if !ok {
		return false
	}
	job, ok := val.(*TTSJob)
	if !ok {
		return false
	}
	select {
	case job.StreamCh <- event:
		return true
	default:
		return false
	}
}

// CloseTTSJobDone signals that the job goroutine has finished.
func CloseTTSJobDone(id string) {
	val, ok := ttsJobs.Load(id)
	if !ok {
		return
	}
	job, ok := val.(*TTSJob)
	if !ok {
		return
	}
	select {
	case <-job.Done:
		// Already closed
	default:
		close(job.Done)
	}
}

// CancelTTSJob cancels a running TTS job. Used when the SSE client disconnects.
func CancelTTSJob(id string) {
	val, ok := ttsJobs.Load(id)
	if !ok {
		return
	}
	job, ok := val.(*TTSJob)
	if !ok {
		return
	}
	job.Cancel()
}
