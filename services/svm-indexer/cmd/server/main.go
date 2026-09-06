package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/swaputer/explorer/services/svm-indexer/internal/api"
	"github.com/swaputer/explorer/services/svm-indexer/internal/config"
	"github.com/swaputer/explorer/services/svm-indexer/internal/indexer"
	"github.com/swaputer/explorer/services/svm-indexer/internal/realtime"
	"github.com/swaputer/explorer/services/svm-indexer/internal/store"
)

func main() {
	logger := log.New(os.Stdout, "svm-indexer ", log.LstdFlags|log.LUTC)
	cfg, err := config.Load()
	if err != nil {
		logger.Fatalf("configuration error: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	database, err := store.Open(ctx, cfg)
	if err != nil {
		logger.Fatalf("database startup failed: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		logger.Fatalf("database migration failed: %v", err)
	}

	hub := realtime.NewHub()
	scanner, err := indexer.New(ctx, cfg, database, hub, logger)
	if err != nil {
		logger.Fatalf("indexer startup failed: %v", err)
	}
	defer scanner.Close()

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           api.New(database, hub, cfg, scanner),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		logger.Printf("query API listening on http://%s", cfg.HTTPAddr)
		serverErrors <- httpServer.ListenAndServe()
	}()
	indexerErrors := make(chan error, 1)
	go func() { indexerErrors <- scanner.Run(ctx) }()

	select {
	case <-ctx.Done():
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Printf("HTTP server stopped: %v", err)
		}
	case err := <-indexerErrors:
		if err != nil {
			logger.Printf("indexer stopped: %v", err)
		}
	}
	stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
