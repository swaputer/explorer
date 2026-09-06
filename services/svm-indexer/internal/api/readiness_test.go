package api

import (
	"testing"
	"time"

	"github.com/swaputer/explorer/services/svm-indexer/internal/indexer"
	"github.com/swaputer/explorer/services/svm-indexer/internal/store"
)

func uintPointer(value uint64) *uint64 { return &value }

func TestReadinessAcceptsHTTPAuthoritativeSyncWithoutWS(t *testing.T) {
	now := time.Now().UTC()
	result := evaluateReadiness(
		store.Status{CanonicalTip: uintPointer(100)},
		indexer.RuntimeStatus{Initialized: true, ObservedHead: 101, LastSync: now, WSConnected: false},
		2, time.Minute, now,
	)
	if !result.Ready {
		t.Fatalf("expected ready result, got %s", result.Reason)
	}
}

func TestReadinessRejectsLagAndStaleCheckpoint(t *testing.T) {
	now := time.Now().UTC()
	lagging := evaluateReadiness(
		store.Status{CanonicalTip: uintPointer(90)},
		indexer.RuntimeStatus{Initialized: true, ObservedHead: 100, LastSync: now},
		2, time.Minute, now,
	)
	if lagging.Reason != "INDEXER_LAGGING" {
		t.Fatalf("lagging reason=%s", lagging.Reason)
	}
	stale := evaluateReadiness(
		store.Status{CanonicalTip: uintPointer(100)},
		indexer.RuntimeStatus{Initialized: true, ObservedHead: 100, LastSync: now.Add(-2 * time.Minute)},
		2, time.Minute, now,
	)
	if stale.Reason != "INDEXER_STALE" {
		t.Fatalf("stale reason=%s", stale.Reason)
	}
}
