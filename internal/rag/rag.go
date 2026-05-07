package rag

import (
	"fmt"
	"log/slog"

	"clawbench/internal/model"
)

var (
	// GlobalStore is the singleton DuckDB store instance.
	GlobalStore *Store
	// GlobalIndexer is the singleton indexer instance.
	GlobalIndexer *Indexer
	// GlobalEmbedder is the singleton embedding client instance.
	GlobalEmbedder *EmbeddingClient
	// GlobalCleanupWorker is the singleton cleanup worker instance.
	GlobalCleanupWorker *CleanupWorker
)

// Init initializes the RAG system: DuckDB store, embedding client, and dimension check.
func Init(cfg model.RAGConfig) error {
	// Initialize DuckDB store
	store, err := InitStore()
	if err != nil {
		return fmt.Errorf("init rag store: %w", err)
	}

	// Check embedding dimension compatibility
	const bgeM3Dim = 1024
	existingDim, mismatch, err := store.CheckDimensionMismatch(bgeM3Dim)
	if err != nil {
		slog.Warn("rag: failed to check dimension, continuing", slog.String("err", err.Error()))
	} else if mismatch {
		slog.Warn("rag: embedding dimension mismatch, resetting table",
			slog.Int("existing_dim", existingDim),
			slog.Int("expected_dim", bgeM3Dim),
		)
		if err := store.ResetTable(); err != nil {
			store.Close()
			return fmt.Errorf("reset rag table: %w", err)
		}
	}

	// Initialize embedding client
	embedder := NewEmbeddingClient(cfg.OllamaBaseURL, cfg.OllamaModel)

	GlobalStore = store
	GlobalEmbedder = embedder

	slog.Info("rag initialized",
		slog.String("ollama_url", cfg.OllamaBaseURL),
		slog.String("model", cfg.OllamaModel),
		slog.Int("chunk_size", cfg.ChunkSize),
	)

	return nil
}

// StartIndexer creates and starts the RAG indexer.
func StartIndexer(cfg model.RAGConfig) {
	if GlobalStore == nil || GlobalEmbedder == nil {
		slog.Warn("rag: cannot start indexer, store or embedder not initialized")
		return
	}
	GlobalIndexer = NewIndexer(GlobalStore, GlobalEmbedder, cfg)
	GlobalIndexer.Start()
}

// StartCleanupWorker creates and starts the cleanup worker.
// Starts regardless of whether RAG is enabled — soft-deleted SQLite data
// accumulates even without RAG. When RAG is disabled, store is nil and
// only SQLite cleanup runs.
func StartCleanupWorker(cfg model.RAGConfig) {
	if cfg.RetentionDays <= 0 {
		return
	}
	GlobalCleanupWorker = NewCleanupWorker(GlobalStore, cfg)
	GlobalCleanupWorker.Start()
}

// Shutdown gracefully stops the RAG system.
func Shutdown() {
	if GlobalCleanupWorker != nil {
		GlobalCleanupWorker.Stop()
		GlobalCleanupWorker = nil
	}
	if GlobalIndexer != nil {
		GlobalIndexer.Stop()
		GlobalIndexer = nil
	}
	if GlobalStore != nil {
		GlobalStore.Close()
		GlobalStore = nil
	}
	GlobalEmbedder = nil
	slog.Info("rag shutdown complete")
}
