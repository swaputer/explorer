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

func (s *Store) TokensNeedingMetadata(ctx context.Context, limit int) ([]TokenRef, error) {
	rows, err := s.pool.Query(ctx, `SELECT program_id,code_hash FROM src20_tokens
		WHERE chain_id=$1 AND world_id=$2 AND canonical
		  AND (metadata_status='pending' OR (metadata_status='failed' AND metadata_updated_at<now()-interval '5 minutes'))
		ORDER BY deployment_block LIMIT $3`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]TokenRef, 0)
	for rows.Next() {
		var programID, codeHash string
		if err := rows.Scan(&programID, &codeHash); err != nil {
			return nil, err
		}
		result = append(result, TokenRef{ProgramID: common.HexToHash(programID), CodeHash: common.HexToHash(codeHash)})
	}
	return result, rows.Err()
}

func (s *Store) SetTokenMetadata(ctx context.Context, programID common.Hash, metadata TokenMetadata) error {
	var capValue, mintValue any
	if metadata.Cap != nil {
		capValue = metadata.Cap.String()
	}
	if metadata.MintAmount != nil {
		mintValue = metadata.MintAmount.String()
	}
	_, err := s.pool.Exec(ctx, `UPDATE src20_tokens SET
		name=$4,symbol=$5,decimals=$6,cap=$7,mint_amount=$8,
		metadata_status='loaded',metadata_updated_at=now()
	WHERE chain_id=$1 AND world_id=$2 AND program_id=$3 AND canonical`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex()),
		metadata.Name, metadata.Symbol, metadata.Decimals, capValue, mintValue,
	)
	if err != nil {
		return fmt.Errorf("update token metadata: %w", err)
	}
	return nil
}

func (s *Store) MarkTokenMetadataFailed(ctx context.Context, programID common.Hash) error {
	_, err := s.pool.Exec(ctx, `UPDATE src20_tokens SET metadata_status='failed',metadata_updated_at=now()
		WHERE chain_id=$1 AND world_id=$2 AND program_id=$3 AND canonical`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex()))
	return err
}

func (s *Store) ListTokens(ctx context.Context, limit int) ([]TokenSummary, error) {
	rows, err := s.pool.Query(ctx, tokenSelect+`
		WHERE t.chain_id=$1 AND t.world_id=$2 AND t.canonical
		ORDER BY t.deployment_block DESC,t.program_id LIMIT $3`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]TokenSummary, 0)
	for rows.Next() {
		item, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// ListOpenMintTokens returns only contracts whose immutable package is the
// OpenMint SRC20 implementation pinned by the active release and whose complete
// public-mint metadata interface has been read successfully from the Kernel.
type OpenMintTokenCursor struct {
	DeploymentBlock uint64
	ProgramID       string
}

func (s *Store) ListOpenMintTokens(ctx context.Context, limit int, cursor *OpenMintTokenCursor) ([]TokenSummary, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(s.config.OpenMintSRC20CodeHash.Hex())}
	query := tokenSelect + `
		WHERE t.chain_id=$1 AND t.world_id=$2 AND t.canonical AND t.code_hash=$3
		  AND t.metadata_status='loaded' AND t.name<>'' AND t.symbol<>'' AND t.decimals=18
		  AND t.cap IS NOT NULL AND t.cap>0 AND t.mint_amount IS NOT NULL AND t.mint_amount>0
		  AND t.mint_amount<=t.cap`
	if cursor != nil {
		query += ` AND (t.deployment_block<$4 OR (t.deployment_block=$4 AND t.program_id>$5))`
		args = append(args, cursor.DeploymentBlock, cursor.ProgramID)
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY t.deployment_block DESC,t.program_id ASC LIMIT $%d`, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]TokenSummary, 0)
	for rows.Next() {
		item, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) OpenMintToken(ctx context.Context, programID common.Hash) (TokenSummary, error) {
	row := s.pool.QueryRow(ctx, tokenSelect+`
		WHERE t.chain_id=$1 AND t.world_id=$2 AND t.program_id=$3 AND t.canonical AND t.code_hash=$4
		  AND t.metadata_status='loaded' AND t.name<>'' AND t.symbol<>'' AND t.decimals=18
		  AND t.cap IS NOT NULL AND t.cap>0 AND t.mint_amount IS NOT NULL AND t.mint_amount>0
		  AND t.mint_amount<=t.cap`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex()),
		strings.ToLower(s.config.OpenMintSRC20CodeHash.Hex()))
	return scanToken(row)
}

func (s *Store) Token(ctx context.Context, programID common.Hash) (TokenSummary, error) {
	row := s.pool.QueryRow(ctx, tokenSelect+`
		WHERE t.chain_id=$1 AND t.world_id=$2 AND t.program_id=$3 AND t.canonical`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex()))
	return scanToken(row)
}

const tokenSelect = `SELECT
	t.program_id,t.code_hash,t.creator,t.deployment_block,COALESCE(t.name,''),COALESCE(t.symbol,''),COALESCE(t.decimals,18),
	COALESCE(t.cap::text,''),COALESCE(t.mint_amount::text,''),
	COALESCE(t.total_supply::text,(SELECT COALESCE(sum(b.balance),0)::text FROM src20_balances b
		WHERE b.chain_id=t.chain_id AND b.world_id=t.world_id AND b.token_id=t.program_id),'0'),
	(SELECT count(*) FROM src20_balances b WHERE b.chain_id=t.chain_id AND b.world_id=t.world_id AND b.token_id=t.program_id AND b.balance>0),
	t.canonical,t.finalized
FROM src20_tokens t `

type tokenScanner interface{ Scan(dest ...any) error }

func scanToken(row tokenScanner) (TokenSummary, error) {
	var item TokenSummary
	err := row.Scan(&item.ProgramID, &item.CodeHash, &item.Creator, &item.DeploymentBlock, &item.Name, &item.Symbol,
		&item.Decimals, &item.Cap, &item.MintAmount, &item.TotalSupply, &item.HolderCount, &item.Canonical, &item.Finalized)
	return item, err
}

type HolderCursor struct {
	Balance   string
	AccountID string
}

type TransferCursor struct {
	BlockNumber uint64
	ExecutionID int64
	EventIndex  uint
}

func (s *Store) TokenHolders(ctx context.Context, programID common.Hash, limit int, cursor *HolderCursor) ([]TokenHolder, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex())}
	query := `SELECT account_id,balance::text FROM src20_balances
		WHERE chain_id=$1 AND world_id=$2 AND token_id=$3 AND balance>0`
	if cursor != nil {
		query += ` AND (balance < $4::numeric OR (balance = $4::numeric AND account_id > $5))`
		args = append(args, cursor.Balance, cursor.AccountID)
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY balance DESC,account_id ASC LIMIT $%d`, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]TokenHolder, 0)
	for rows.Next() {
		var item TokenHolder
		if err := rows.Scan(&item.AccountID, &item.Balance); err != nil {
			return nil, err
		}
		item.EVMAddress = accountToEVM(item.AccountID)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) AddressBalances(ctx context.Context, accountID common.Hash) ([]AddressBalance, error) {
	rows, err := s.pool.Query(ctx, `SELECT t.program_id,COALESCE(t.name,''),COALESCE(t.symbol,''),COALESCE(t.decimals,18),
		b.balance::text,COALESCE(t.total_supply::text,'0')
	FROM src20_balances b JOIN src20_tokens t
	  ON t.chain_id=b.chain_id AND t.world_id=b.world_id AND t.program_id=b.token_id AND t.canonical
	WHERE b.chain_id=$1 AND b.world_id=$2 AND b.account_id=$3 AND b.balance<>0
	ORDER BY b.balance DESC,t.program_id`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(accountID.Hex()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]AddressBalance, 0)
	for rows.Next() {
		var item AddressBalance
		if err := rows.Scan(&item.ProgramID, &item.Name, &item.Symbol, &item.Decimals, &item.Balance, &item.TotalSupply); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) AddressTransactions(ctx context.Context, accountID common.Hash, limit int, cursor *TransactionCursor) ([]TransactionSummary, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(accountID.Hex())}
	query := `SELECT e.id,e.ethereum_log_index,e.transaction_hash,e.block_number,b.block_time,e.execution_height,e.actor,e.root_target,
		e.executed_bytes,e.canonical,e.finalized
	FROM svm_executions e JOIN chain_blocks b ON b.chain_id=e.chain_id AND b.block_hash=e.block_hash
	WHERE e.chain_id=$1 AND e.world_id=$2 AND e.actor=$3 AND e.canonical`
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

func (s *Store) AddressTransactionCount(ctx context.Context, accountID common.Hash) (uint64, error) {
	var count uint64
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM svm_executions
		WHERE chain_id=$1 AND world_id=$2 AND actor=$3 AND canonical`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(accountID.Hex()),
	).Scan(&count)
	return count, err
}

func (s *Store) TokenTransfers(ctx context.Context, programID common.Hash, limit int, cursor *TransferCursor) ([]TransferDetail, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(programID.Hex())}
	query := `SELECT x.execution_id,x.event_index,x.transaction_hash,x.block_number,b.block_time,x.sender_account,x.recipient_account,
		x.amount::text,x.mint,x.burn,x.finalized
	FROM src20_transfers x JOIN svm_executions e ON e.id=x.execution_id
	JOIN chain_blocks b ON b.chain_id=e.chain_id AND b.block_hash=e.block_hash
	WHERE x.chain_id=$1 AND x.world_id=$2 AND x.token_id=$3 AND x.canonical`
	if cursor != nil {
		query += ` AND (x.block_number < $4 OR (x.block_number = $4 AND (x.execution_id < $5 OR (x.execution_id = $5 AND x.event_index < $6))))`
		args = append(args, cursor.BlockNumber, cursor.ExecutionID, cursor.EventIndex)
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY x.block_number DESC,x.execution_id DESC,x.event_index DESC LIMIT $%d`, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]TransferDetail, 0)
	for rows.Next() {
		var item TransferDetail
		var blockTime time.Time
		if err := rows.Scan(&item.ExecutionID, &item.EventIndex, &item.TransactionHash, &item.BlockNumber, &blockTime, &item.Sender, &item.Recipient,
			&item.Amount, &item.Mint, &item.Burn, &item.Finalized); err != nil {
			return nil, err
		}
		item.BlockTime = blockTime.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}

func accountToEVM(accountID string) string {
	value := common.HexToHash(accountID).Bytes()
	for _, prefix := range value[:12] {
		if prefix != 0 {
			return ""
		}
	}
	address := common.BytesToAddress(value[12:])
	if address == (common.Address{}) {
		return ""
	}
	return address.Hex()
}

func IsNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
