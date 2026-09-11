package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"
)

type ContractCursor struct {
	BlockNumber uint64
	LogIndex    uint
	ProgramID   string
}

// ListContracts returns every canonical SVM program deployment without trying
// to infer or classify its application-level interface.
func (s *Store) ListContracts(ctx context.Context, limit int, cursor *ContractCursor) ([]ContractSummary, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex())}
	query := `SELECT ` + contractSelectColumns + `,e.ethereum_log_index
FROM svm_deployments d
JOIN svm_executions e ON e.id=d.execution_id
WHERE d.chain_id=$1 AND d.world_id=$2 AND d.canonical`
	if cursor != nil {
		query += ` AND (e.block_number < $3 OR (e.block_number = $3 AND (e.ethereum_log_index < $4 OR (e.ethereum_log_index = $4 AND d.program_id > $5))))`
		args = append(args, cursor.BlockNumber, cursor.LogIndex, cursor.ProgramID)
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY e.block_number DESC,e.ethereum_log_index DESC,d.program_id ASC LIMIT $%d`, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ContractSummary, 0)
	for rows.Next() {
		var item ContractSummary
		if err := rows.Scan(&item.ProgramID, &item.CodeHash, &item.Creator, &item.DeploymentBlock, &item.CreationTxHash,
			&item.Canonical, &item.Finalized, &item.LogIndex); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) Contract(ctx context.Context, programID common.Hash) (ContractDetail, error) {
	row := s.pool.QueryRow(ctx, contractSelect+`
		AND d.program_id=$3
		ORDER BY e.block_number DESC,e.ethereum_log_index DESC LIMIT 1`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex()))
	contract, err := scanContract(row)
	if err != nil {
		return ContractDetail{}, err
	}
	detail := ContractDetail{ContractSummary: contract}
	token, tokenErr := s.Token(ctx, programID)
	if tokenErr == nil {
		detail.Token = &token
	} else if !errors.Is(tokenErr, pgx.ErrNoRows) {
		return ContractDetail{}, tokenErr
	}
	return detail, nil
}

// ContractTransactions lists direct calls and executions that emitted an Event
// from the contract. The latter makes token activity discoverable even when the
// observed call passed through another Mini Contract.
func (s *Store) ContractTransactions(ctx context.Context, programID common.Hash, limit int, cursor *TransactionCursor) ([]TransactionSummary, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex())}
	query := `SELECT e.id,e.ethereum_log_index,e.transaction_hash,e.block_number,b.block_time,e.execution_height,e.actor,e.root_target,
		e.executed_bytes,e.canonical,e.finalized
	FROM svm_executions e JOIN chain_blocks b ON b.chain_id=e.chain_id AND b.block_hash=e.block_hash
	WHERE e.chain_id=$1 AND e.world_id=$2 AND e.canonical AND (
		e.root_target=$3 OR EXISTS (
			SELECT 1 FROM svm_events l
			WHERE l.execution_id=e.id AND l.canonical AND l.record_kind='application' AND l.emitter=$3
		)
	)`
	if cursor != nil {
		query += ` AND (e.block_number < $4 OR (e.block_number = $4 AND (e.ethereum_log_index < $5 OR (e.ethereum_log_index = $5 AND e.id < $6))))`
		args = append(args, cursor.BlockNumber, cursor.LogIndex, cursor.ExecutionID)
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY e.block_number DESC,e.ethereum_log_index DESC,e.id DESC LIMIT $%d`, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]TransactionSummary, 0)
	for rows.Next() {
		var item TransactionSummary
		var blockTime time.Time
		if err := rows.Scan(&item.ExecutionID, &item.LogIndex, &item.Hash, &item.BlockNumber, &blockTime, &item.ExecutionHeight, &item.Actor, &item.RootTarget,
			&item.ExecutedBytes, &item.Canonical, &item.Finalized); err != nil {
			return nil, err
		}
		item.BlockTime = blockTime.UTC().Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

const contractSelectColumns = `d.program_id,d.code_hash,d.creator,e.block_number,e.transaction_hash,d.canonical,d.finalized`

const contractSelect = `SELECT ` + contractSelectColumns + `
FROM svm_deployments d
JOIN svm_executions e ON e.id=d.execution_id
WHERE d.chain_id=$1 AND d.world_id=$2 AND d.canonical`

type contractScanner interface{ Scan(dest ...any) error }

func scanContract(row contractScanner) (ContractSummary, error) {
	var item ContractSummary
	err := row.Scan(&item.ProgramID, &item.CodeHash, &item.Creator, &item.DeploymentBlock, &item.CreationTxHash,
		&item.Canonical, &item.Finalized)
	return item, err
}
