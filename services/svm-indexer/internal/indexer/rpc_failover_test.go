package indexer

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"

	"github.com/swaputer/explorer/services/svm-indexer/internal/config"
)

type wsRPCService struct {
	chainFailures atomic.Int32
}

func (s *wsRPCService) ChainId() (hexutil.Uint64, error) {
	if s.chainFailures.Add(-1) >= 0 {
		return 0, errors.New("temporary chain check failure")
	}
	return hexutil.Uint64(84532), nil
}

func (s *wsRPCService) Logs(ctx context.Context, _ map[string]any) (*rpc.Subscription, error) {
	notifier, ok := rpc.NotifierFromContext(ctx)
	if !ok {
		return nil, errors.New("subscriptions unavailable")
	}
	return notifier.CreateSubscription(), nil
}

func testWSEndpoint(t *testing.T, service *wsRPCService) string {
	t.Helper()
	server := rpc.NewServer()
	if err := server.RegisterName("eth", service); err != nil {
		t.Fatalf("register WS RPC: %v", err)
	}
	httpServer := httptest.NewServer(server.WebsocketHandler([]string{"*"}))
	t.Cleanup(httpServer.Close)
	return "ws" + strings.TrimPrefix(httpServer.URL, "http")
}

func TestWSSubscriptionFailsOverThenReturnsToRecoveredPrimary(t *testing.T) {
	primary := &wsRPCService{}
	primary.chainFailures.Store(1)
	secondary := &wsRPCService{}
	indexer := &Indexer{
		config: config.Config{
			ChainID: 84532, RPCRequestTimeout: time.Second,
			RPCWSURLs: []string{testWSEndpoint(t, primary), testWSEndpoint(t, secondary)},
		},
		logger: log.New(io.Discard, "", 0),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, subscription, _, endpoint, err := indexer.subscribe(ctx)
	if err != nil {
		t.Fatalf("fallback subscription: %v", err)
	}
	if endpoint != 1 {
		t.Fatalf("fallback endpoint=%d want 1", endpoint)
	}
	subscription.Unsubscribe()
	client.Close()

	indexer.wsNext = (endpoint + 1) % len(indexer.config.RPCWSURLs)
	client, subscription, _, endpoint, err = indexer.subscribe(ctx)
	if err != nil {
		t.Fatalf("recovered primary subscription: %v", err)
	}
	defer client.Close()
	defer subscription.Unsubscribe()
	if endpoint != 0 {
		t.Fatalf("recovered endpoint=%d want 0", endpoint)
	}
}
