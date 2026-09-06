package chain

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// HTTPPool keeps ordered RPC endpoints and retries read-only requests on the
// next endpoint. All methods exposed here are idempotent chain reads.
type HTTPPool struct {
	mu       sync.Mutex
	urls     []string
	clients  []*ethclient.Client
	current  int
	chainID  uint64
	timeout  time.Duration
	logger   *log.Logger
	closed   bool
	failures uint64
	switches uint64
}

type HTTPPoolSnapshot struct {
	Endpoint      int
	EndpointCount int
	Failures      uint64
	Switches      uint64
}

func NewHTTPPool(ctx context.Context, urls []string, chainID uint64, timeout time.Duration, logger *log.Logger) (*HTTPPool, error) {
	if len(urls) == 0 {
		return nil, errors.New("HTTP RPC endpoint list is empty")
	}
	pool := &HTTPPool{
		urls: append([]string(nil), urls...), clients: make([]*ethclient.Client, len(urls)),
		chainID: chainID, timeout: timeout, logger: logger,
	}
	if _, err := pool.BlockNumber(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("HTTP RPC startup check failed: %w", err)
	}
	return pool, nil
}

func (p *HTTPPool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	p.closed = true
	for index, client := range p.clients {
		if client != nil {
			client.Close()
			p.clients[index] = nil
		}
	}
}

func (p *HTTPPool) EndpointCount() int { return len(p.urls) }

func (p *HTTPPool) Snapshot() HTTPPoolSnapshot {
	p.mu.Lock()
	defer p.mu.Unlock()
	return HTTPPoolSnapshot{
		Endpoint: p.current, EndpointCount: len(p.urls), Failures: p.failures, Switches: p.switches,
	}
}

func (p *HTTPPool) connect(ctx context.Context, index int) (*ethclient.Client, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errors.New("HTTP RPC pool is closed")
	}
	if client := p.clients[index]; client != nil {
		p.mu.Unlock()
		return client, nil
	}
	p.mu.Unlock()

	client, err := ethclient.DialContext(ctx, p.urls[index])
	if err != nil {
		return nil, err
	}
	remoteChainID, err := client.ChainID(ctx)
	if err != nil || !remoteChainID.IsUint64() || remoteChainID.Uint64() != p.chainID {
		client.Close()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("chain ID mismatch: got %s want %d", remoteChainID, p.chainID)
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		client.Close()
		return nil, errors.New("HTTP RPC pool is closed")
	}
	if existing := p.clients[index]; existing != nil {
		client.Close()
		return existing, nil
	}
	p.clients[index] = client
	return client, nil
}

func (p *HTTPPool) invalidate(index int, failed *ethclient.Client) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.clients[index] == failed {
		failed.Close()
		p.clients[index] = nil
	}
}

func (p *HTTPPool) startIndex() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.current
}

func (p *HTTPPool) selectIndex(index int) {
	p.mu.Lock()
	changed := p.current != index
	p.current = index
	if changed {
		p.switches++
	}
	p.mu.Unlock()
	if changed && p.logger != nil {
		p.logger.Printf("HTTP RPC switched to endpoint %d/%d", index+1, len(p.urls))
	}
}

func (p *HTTPPool) recordFailure() {
	p.mu.Lock()
	p.failures++
	p.mu.Unlock()
}

func withHTTPFailover[T any](p *HTTPPool, ctx context.Context, operation func(context.Context, *ethclient.Client) (T, error)) (T, error) {
	var zero T
	var lastErr error
	start := p.startIndex()
	for offset := 0; offset < len(p.urls); offset++ {
		index := (start + offset) % len(p.urls)
		attemptCtx, cancel := context.WithTimeout(ctx, p.timeout)
		client, err := p.connect(attemptCtx, index)
		if err == nil {
			var value T
			value, err = operation(attemptCtx, client)
			if err == nil {
				cancel()
				p.selectIndex(index)
				return value, nil
			}
			p.invalidate(index, client)
		}
		cancel()
		lastErr = err
		p.recordFailure()
		if p.logger != nil {
			p.logger.Printf("HTTP RPC endpoint %d/%d failed; trying next endpoint", index+1, len(p.urls))
		}
	}
	return zero, fmt.Errorf("all HTTP RPC endpoints failed: %w", lastErr)
}

func (p *HTTPPool) BlockNumber(ctx context.Context) (uint64, error) {
	return withHTTPFailover(p, ctx, func(ctx context.Context, client *ethclient.Client) (uint64, error) {
		return client.BlockNumber(ctx)
	})
}

func (p *HTTPPool) CallContract(ctx context.Context, message ethereum.CallMsg, number *big.Int) ([]byte, error) {
	return withHTTPFailover(p, ctx, func(ctx context.Context, client *ethclient.Client) ([]byte, error) {
		return client.CallContract(ctx, message, number)
	})
}

func (p *HTTPPool) FilterLogs(ctx context.Context, query ethereum.FilterQuery) ([]types.Log, error) {
	return withHTTPFailover(p, ctx, func(ctx context.Context, client *ethclient.Client) ([]types.Log, error) {
		return client.FilterLogs(ctx, query)
	})
}

func (p *HTTPPool) HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error) {
	return withHTTPFailover(p, ctx, func(ctx context.Context, client *ethclient.Client) (*types.Header, error) {
		return client.HeaderByNumber(ctx, number)
	})
}

type transactionResult struct {
	transaction *types.Transaction
	pending     bool
}

func (p *HTTPPool) TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error) {
	result, err := withHTTPFailover(p, ctx, func(ctx context.Context, client *ethclient.Client) (transactionResult, error) {
		transaction, pending, err := client.TransactionByHash(ctx, hash)
		return transactionResult{transaction: transaction, pending: pending}, err
	})
	return result.transaction, result.pending, err
}

func (p *HTTPPool) TransactionReceipt(ctx context.Context, hash common.Hash) (*types.Receipt, error) {
	return withHTTPFailover(p, ctx, func(ctx context.Context, client *ethclient.Client) (*types.Receipt, error) {
		return client.TransactionReceipt(ctx, hash)
	})
}
