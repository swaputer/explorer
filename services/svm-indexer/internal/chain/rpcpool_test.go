package chain

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
)

type rpcPoolTestService struct {
	chainID uint64
	head    uint64
	failing atomic.Bool
}

func (s *rpcPoolTestService) ChainId() hexutil.Uint64 { return hexutil.Uint64(s.chainID) }

func (s *rpcPoolTestService) BlockNumber() (hexutil.Uint64, error) {
	if s.failing.Load() {
		return 0, errors.New("provider unavailable")
	}
	return hexutil.Uint64(s.head), nil
}

func testRPCServer(t *testing.T, service *rpcPoolTestService) string {
	t.Helper()
	server := rpc.NewServer()
	if err := server.RegisterName("eth", service); err != nil {
		t.Fatalf("register RPC service: %v", err)
	}
	httpServer := httptest.NewServer(server)
	t.Cleanup(httpServer.Close)
	return httpServer.URL
}

func TestHTTPPoolFailsOverAndRecovers(t *testing.T) {
	primary := &rpcPoolTestService{chainID: 84532, head: 100}
	secondary := &rpcPoolTestService{chainID: 84532, head: 101}
	pool, err := NewHTTPPool(context.Background(), []string{
		testRPCServer(t, primary), testRPCServer(t, secondary),
	}, 84532, time.Second, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	t.Cleanup(pool.Close)

	primary.failing.Store(true)
	head, err := pool.BlockNumber(context.Background())
	if err != nil || head != 101 {
		t.Fatalf("fallback head=%d err=%v", head, err)
	}

	secondary.failing.Store(true)
	primary.failing.Store(false)
	primary.head = 102
	head, err = pool.BlockNumber(context.Background())
	if err != nil || head != 102 {
		t.Fatalf("recovered primary head=%d err=%v", head, err)
	}
}

func TestHTTPPoolRejectsWrongChainFallback(t *testing.T) {
	wrong := &rpcPoolTestService{chainID: 1, head: 100}
	pool, err := NewHTTPPool(context.Background(), []string{testRPCServer(t, wrong)}, 84532, time.Second, nil)
	if err == nil {
		pool.Close()
		t.Fatal("expected wrong-chain endpoint to fail")
	}
}
