package indexer

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/big"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/swaputer/explorer/services/svm-indexer/internal/chain"
	"github.com/swaputer/explorer/services/svm-indexer/internal/config"
	"github.com/swaputer/explorer/services/svm-indexer/internal/realtime"
	"github.com/swaputer/explorer/services/svm-indexer/internal/store"
)

type Indexer struct {
	config       config.Config
	store        *store.Store
	http         *chain.HTTPPool
	logger       *log.Logger
	hub          *realtime.Hub
	reader       *chain.Reader
	wsNext       int
	wsConnected  atomic.Bool
	wsEndpoint   atomic.Int64
	wsReconnects atomic.Uint64
	observedHead atomic.Uint64
	lastSyncUnix atomic.Int64
	initialized  atomic.Bool
}

type RuntimeStatus struct {
	Initialized       bool
	WSConnected       bool
	WSEndpoint        int
	WSEndpointCount   int
	WSReconnects      uint64
	ObservedHead      uint64
	LastSync          time.Time
	HTTPEndpoint      int
	HTTPEndpointCount int
	HTTPFailures      uint64
	HTTPSwitches      uint64
}

func New(ctx context.Context, cfg config.Config, database *store.Store, hub *realtime.Hub, logger *log.Logger) (*Indexer, error) {
	httpClient, err := chain.NewHTTPPool(ctx, cfg.RPCHTTPURLs, cfg.ChainID, cfg.RPCRequestTimeout, logger)
	if err != nil {
		return nil, err
	}
	reader, err := chain.NewReader(httpClient, cfg.KernelAddress, cfg.WorldID)
	if err != nil {
		httpClient.Close()
		return nil, fmt.Errorf("create SVM reader: %w", err)
	}
	indexer := &Indexer{config: cfg, store: database, http: httpClient, logger: logger, hub: hub, reader: reader}
	indexer.wsEndpoint.Store(-1)
	return indexer, nil
}

func (i *Indexer) Close() { i.http.Close() }

func (i *Indexer) Run(ctx context.Context) error {
	if len(i.config.RPCWSURLs) == 0 {
		i.logger.Printf("SVM indexer is running in HTTP polling mode")
		return i.runHTTPPollLoop(ctx)
	}

	backoff := time.Second
	for ctx.Err() == nil {
		err := i.runSession(ctx)
		if ctx.Err() != nil {
			return nil
		}
		i.wsReconnects.Add(1)
		if catchUpErr := i.catchUp(ctx); catchUpErr != nil {
			if ctx.Err() != nil {
				return nil
			}
			i.logger.Printf("HTTP catch-up failed while WS is unavailable: %s", i.safeError(catchUpErr))
		}
		i.logger.Printf("WS session ended; HTTP reconciliation attempted; retrying in %s (%s)", backoff, i.safeError(err))
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
	return nil
}

func (i *Indexer) runHTTPPollLoop(ctx context.Context) error {
	if err := i.verifyCheckpoint(ctx); err != nil {
		return err
	}
	ticker := time.NewTicker(i.config.ReconcileInterval)
	defer ticker.Stop()
	for {
		if err := i.catchUp(ctx); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (i *Indexer) runSession(ctx context.Context) error {
	wsClient, subscription, liveLogs, endpoint, err := i.subscribe(ctx)
	if err != nil {
		return err
	}
	defer wsClient.Close()
	defer subscription.Unsubscribe()
	defer func() { i.wsNext = (endpoint + 1) % len(i.config.RPCWSURLs) }()
	i.wsConnected.Store(true)
	i.wsEndpoint.Store(int64(endpoint))
	defer i.wsConnected.Store(false)

	if err := i.verifyCheckpoint(ctx); err != nil {
		return err
	}
	if err := i.catchUp(ctx); err != nil {
		return err
	}
	head := i.observedHead.Load()
	i.logger.Printf("SVM indexer is live at block %d", head)

	ticker := time.NewTicker(i.config.ReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-subscription.Err():
			if err == nil {
				return errors.New("WS event subscription closed")
			}
			return err
		case item := <-liveLogs:
			if item.Removed {
				from := i.config.StartBlock
				if item.BlockNumber > i.config.ReorgDepth {
					from = item.BlockNumber - i.config.ReorgDepth
					if from < i.config.StartBlock {
						from = i.config.StartBlock
					}
				}
				if err := i.store.Rewind(ctx, from); err != nil {
					return fmt.Errorf("rewind removed events: %w", err)
				}
			}
			if err := i.syncTo(ctx, item.BlockNumber); err != nil {
				return err
			}
		case <-ticker.C:
			if err := i.catchUp(ctx); err != nil {
				return err
			}
		}
	}
}

func (i *Indexer) catchUp(ctx context.Context) error {
	head, err := i.http.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("read chain head: %w", err)
	}
	i.observedHead.Store(head)
	if err := i.syncTo(ctx, head); err != nil {
		return err
	}
	i.lastSyncUnix.Store(time.Now().UTC().Unix())
	i.initialized.Store(true)
	return nil
}

func (i *Indexer) RuntimeStatus() RuntimeStatus {
	httpStatus := i.http.Snapshot()
	lastSync := time.Time{}
	if unix := i.lastSyncUnix.Load(); unix > 0 {
		lastSync = time.Unix(unix, 0).UTC()
	}
	return RuntimeStatus{
		Initialized: i.initialized.Load(), WSConnected: i.wsConnected.Load(),
		WSEndpoint: int(i.wsEndpoint.Load()), WSEndpointCount: len(i.config.RPCWSURLs),
		WSReconnects: i.wsReconnects.Load(), ObservedHead: i.observedHead.Load(), LastSync: lastSync,
		HTTPEndpoint: httpStatus.Endpoint, HTTPEndpointCount: httpStatus.EndpointCount,
		HTTPFailures: httpStatus.Failures, HTTPSwitches: httpStatus.Switches,
	}
}

func (i *Indexer) subscribe(ctx context.Context) (*ethclient.Client, ethereum.Subscription, chan types.Log, int, error) {
	for offset := 0; offset < len(i.config.RPCWSURLs); offset++ {
		index := (i.wsNext + offset) % len(i.config.RPCWSURLs)
		setupCtx, cancel := context.WithTimeout(ctx, i.config.RPCRequestTimeout)
		client, err := ethclient.DialContext(setupCtx, i.config.RPCWSURLs[index])
		if err == nil {
			err = i.verifyChain(setupCtx, client, "WS")
		}
		liveLogs := make(chan types.Log, 65_536)
		var subscription ethereum.Subscription
		if err == nil {
			subscription, err = client.SubscribeFilterLogs(setupCtx, i.filterQuery(nil, nil), liveLogs)
		}
		cancel()
		if err == nil {
			if index != i.wsNext {
				i.logger.Printf("WS RPC switched to endpoint %d/%d", index+1, len(i.config.RPCWSURLs))
			}
			i.wsNext = index
			return client, subscription, liveLogs, index, nil
		}
		if client != nil {
			client.Close()
		}
		i.logger.Printf("WS RPC endpoint %d/%d failed; trying next endpoint", index+1, len(i.config.RPCWSURLs))
	}
	return nil, nil, nil, 0, errors.New("all WS RPC endpoints failed")
}

func (i *Indexer) verifyChain(ctx context.Context, client *ethclient.Client, transport string) error {
	chainID, err := client.ChainID(ctx)
	if err != nil {
		return fmt.Errorf("%s RPC chain check failed", transport)
	}
	if !chainID.IsUint64() || chainID.Uint64() != i.config.ChainID {
		return fmt.Errorf("%s RPC chain ID mismatch: got %s want %d", transport, chainID.String(), i.config.ChainID)
	}
	return nil
}

func (i *Indexer) verifyCheckpoint(ctx context.Context) error {
	checkpoint, err := i.store.Checkpoint(ctx)
	if err != nil || checkpoint.LastBlockNumber == nil || checkpoint.LastBlockHash == nil {
		return err
	}
	header, err := i.http.HeaderByNumber(ctx, new(big.Int).SetUint64(*checkpoint.LastBlockNumber))
	if err == nil && header.Hash() == *checkpoint.LastBlockHash {
		return nil
	}
	from := i.config.StartBlock
	if *checkpoint.LastBlockNumber > i.config.ReorgDepth {
		from = *checkpoint.LastBlockNumber - i.config.ReorgDepth + 1
		if from < i.config.StartBlock {
			from = i.config.StartBlock
		}
	}
	i.logger.Printf("checkpoint hash changed; rewinding canonical history from block %d", from)
	return i.store.Rewind(ctx, from)
}

func (i *Indexer) syncTo(ctx context.Context, target uint64) error {
	for {
		checkpoint, err := i.store.Checkpoint(ctx)
		if err != nil {
			return fmt.Errorf("read checkpoint: %w", err)
		}
		if checkpoint.NextBlock > target {
			return nil
		}
		from := checkpoint.NextBlock
		to := from + i.config.BackfillBatch - 1
		if to < from || to > target {
			to = target
		}
		if err := i.syncRange(ctx, from, to, target); err != nil {
			return err
		}
	}
}

func (i *Indexer) syncRange(ctx context.Context, from, to, observedHead uint64) error {
	logs, err := i.http.FilterLogs(ctx, i.filterQuery(new(big.Int).SetUint64(from), new(big.Int).SetUint64(to)))
	if err != nil {
		return fmt.Errorf("fetch EVM events for blocks %d-%d: %w", from, to, err)
	}
	sort.Slice(logs, func(left, right int) bool {
		if logs[left].BlockNumber != logs[right].BlockNumber {
			return logs[left].BlockNumber < logs[right].BlockNumber
		}
		if logs[left].TxIndex != logs[right].TxIndex {
			return logs[left].TxIndex < logs[right].TxIndex
		}
		return logs[left].Index < logs[right].Index
	})

	headers := make(map[uint64]*types.Header)
	scannedTo, err := i.header(ctx, to, headers)
	if err != nil {
		return err
	}
	executions := make([]chain.Execution, 0, len(logs))
	errorsFound := make([]store.IngestionError, 0)
	transactions := make(map[common.Hash]store.Transaction)
	for _, item := range logs {
		if item.Removed {
			continue
		}
		if _, err := i.header(ctx, item.BlockNumber, headers); err != nil {
			return err
		}
		if item.Address != i.config.KernelAddress {
			continue
		}
		execution, executionErr := chain.ParseExecution(item, i.config.KernelAddress)
		if executionErr != nil {
			errorsFound = append(errorsFound, store.IngestionError{
				BlockNumber: item.BlockNumber, BlockHash: item.BlockHash, TxHash: item.TxHash, LogIndex: item.Index,
				Code: "INVALID_EVENTS", Details: map[string]any{"message": executionErr.Error()}, RawLog: item,
			})
			continue
		}
		if execution.WorldID != i.config.WorldID {
			continue
		}
		if _, exists := transactions[item.TxHash]; !exists {
			transaction, err := i.transaction(ctx, item)
			if err != nil {
				return err
			}
			transactions[item.TxHash] = transaction
		}
		executions = append(executions, execution)
	}
	finalized := uint64(0)
	if observedHead > i.config.Confirmations {
		finalized = observedHead - i.config.Confirmations
	}
	if finalized >= i.config.StartBlock {
		if _, err := i.header(ctx, finalized, headers); err != nil {
			return fmt.Errorf("fetch finalization boundary %d: %w", finalized, err)
		}
	}
	if err := i.store.CommitBatch(ctx, store.Batch{
		ScannedTo: scannedTo, Headers: headers, Transactions: transactions, Executions: executions,
		Errors: errorsFound, FinalizedTo: finalized,
	}); err != nil {
		return fmt.Errorf("commit blocks %d-%d: %w", from, to, err)
	}
	i.refreshTokenMetadata(ctx)
	if len(executions) > 0 {
		transactionHashes := make([]string, 0, len(transactions))
		for hash := range transactions {
			transactionHashes = append(transactionHashes, strings.ToLower(hash.Hex()))
		}
		sort.Strings(transactionHashes)
		i.hub.Publish(realtime.Event{
			Cursor: fmt.Sprintf("block:%d", to), Type: "svm.executions", BlockNumber: to,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Data:      map[string]any{"executionCount": len(executions), "transactionHashes": transactionHashes},
		})
	}
	i.logger.Printf("indexed blocks %d-%d: %d executions, %d quarantined Events payloads", from, to, len(executions), len(errorsFound))
	return nil
}

func (i *Indexer) refreshTokenMetadata(ctx context.Context) {
	tokens, err := i.store.TokensNeedingMetadata(ctx, 20)
	if err != nil {
		i.logger.Printf("SRC20 metadata queue unavailable: %s", i.safeError(err))
		return
	}
	for _, token := range tokens {
		var metadata chain.TokenMetadata
		if i.config.IsOpenMintSRC20CodeHash(token.CodeHash) {
			metadata, err = i.reader.OpenMintTokenMetadata(ctx, token.ProgramID)
		} else {
			metadata, err = i.reader.TokenMetadata(ctx, token.ProgramID)
		}
		if err != nil {
			_ = i.store.MarkTokenMetadataFailed(ctx, token.ProgramID)
			i.logger.Printf("SRC20 metadata read failed for %s", token.ProgramID.Hex())
			continue
		}
		err = i.store.SetTokenMetadata(ctx, token.ProgramID, store.TokenMetadata{
			Name: metadata.Name, Symbol: metadata.Symbol, Decimals: metadata.Decimals, Cap: metadata.Cap,
			MintAmount: metadata.MintAmount,
		})
		if err != nil {
			i.logger.Printf("SRC20 metadata write failed for %s: %s", token.ProgramID.Hex(), i.safeError(err))
		}
	}
}

func (i *Indexer) filterQuery(from, to *big.Int) ethereum.FilterQuery {
	return ethereum.FilterQuery{
		FromBlock: from,
		ToBlock:   to,
		Addresses: []common.Address{i.config.KernelAddress},
		Topics: [][]common.Hash{
			{chain.EventsTopic},
		},
	}
}

func (i *Indexer) header(ctx context.Context, number uint64, cache map[uint64]*types.Header) (*types.Header, error) {
	if cached := cache[number]; cached != nil {
		return cached, nil
	}
	header, err := i.http.HeaderByNumber(ctx, new(big.Int).SetUint64(number))
	if err != nil {
		return nil, fmt.Errorf("fetch block %d: %w", number, err)
	}
	cache[number] = header
	return header, nil
}

func (i *Indexer) transaction(ctx context.Context, item types.Log) (store.Transaction, error) {
	tx, pending, err := i.http.TransactionByHash(ctx, item.TxHash)
	if err != nil || pending {
		return store.Transaction{}, fmt.Errorf("fetch transaction %s", item.TxHash.Hex())
	}
	receipt, err := i.http.TransactionReceipt(ctx, item.TxHash)
	if err != nil {
		return store.Transaction{}, fmt.Errorf("fetch transaction receipt %s", item.TxHash.Hex())
	}
	signer := types.LatestSignerForChainID(new(big.Int).SetUint64(i.config.ChainID))
	sender, err := types.Sender(signer, tx)
	if err != nil {
		return store.Transaction{}, fmt.Errorf("recover transaction sender %s: %w", item.TxHash.Hex(), err)
	}
	return store.Transaction{
		Hash: item.TxHash, BlockHash: item.BlockHash, Block: item.BlockNumber, Index: item.TxIndex,
		Sender: sender, Recipient: tx.To(), Nonce: tx.Nonce(), Value: tx.Value(), Input: tx.Data(),
		Status: receipt.Status, GasUsed: receipt.GasUsed,
	}, nil
}

func (i *Indexer) safeError(err error) string {
	if err == nil {
		return "closed"
	}
	message := err.Error()
	for _, endpoint := range i.config.RPCWSURLs {
		message = strings.ReplaceAll(message, endpoint, "[redacted WS RPC]")
	}
	for _, endpoint := range i.config.RPCHTTPURLs {
		message = strings.ReplaceAll(message, endpoint, "[redacted HTTP RPC]")
	}
	return message
}
