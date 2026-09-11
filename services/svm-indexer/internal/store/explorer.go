package store

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type TransactionCursor struct {
	BlockNumber uint64
	LogIndex    uint
	ExecutionID int64
}

func (s *Store) RecentTransactions(ctx context.Context, limit int, cursor *TransactionCursor) ([]TransactionSummary, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex())}
	query := `SELECT e.id,e.ethereum_log_index,e.transaction_hash,e.block_number,b.block_time,e.execution_height,e.actor,e.root_target,
		e.executed_bytes,e.canonical,e.finalized
	FROM svm_executions e JOIN chain_blocks b ON b.chain_id=e.chain_id AND b.block_hash=e.block_hash
	WHERE e.chain_id=$1 AND e.world_id=$2 AND e.canonical`
	if cursor != nil {
		query += ` AND (e.block_number < $3 OR (e.block_number = $3 AND (e.ethereum_log_index < $4 OR (e.ethereum_log_index = $4 AND e.id < $5))))`
		args = append(args, cursor.BlockNumber, cursor.LogIndex, cursor.ExecutionID)
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY e.block_number DESC,e.ethereum_log_index DESC,e.id DESC LIMIT $%d`, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]TransactionSummary, 0)
	for rows.Next() {
		var item TransactionSummary
		var blockTime time.Time
		if err := rows.Scan(&item.ExecutionID, &item.LogIndex, &item.Hash, &item.BlockNumber, &blockTime, &item.ExecutionHeight, &item.Actor, &item.RootTarget,
			&item.ExecutedBytes, &item.Canonical, &item.Finalized); err != nil {
			return nil, err
		}
		item.BlockTime = blockTime.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) LatestEvents(ctx context.Context, limit int) ([]LatestEvent, error) {
	rows, err := s.pool.Query(ctx, `SELECT e.transaction_hash,e.block_number,b.block_time,l.emitter
	FROM svm_events l JOIN svm_executions e ON e.id=l.execution_id
	JOIN chain_blocks b ON b.chain_id=e.chain_id AND b.block_hash=e.block_hash
	WHERE e.chain_id=$1 AND e.world_id=$2 AND e.canonical AND l.canonical AND l.record_kind='application'
	ORDER BY e.block_number DESC,e.ethereum_log_index DESC,l.event_index DESC LIMIT $3`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]LatestEvent, 0)
	for rows.Next() {
		var item LatestEvent
		var blockTime time.Time
		if err := rows.Scan(&item.TransactionHash, &item.BlockNumber, &blockTime, &item.Emitter); err != nil {
			return nil, err
		}
		item.BlockTime = blockTime.UTC().Format(time.RFC3339)
		item.Event = "ApplicationEvent"
		result = append(result, item)
	}
	return result, rows.Err()
}
