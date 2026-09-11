package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/swaputer/explorer/services/svm-indexer/internal/chain"
	"github.com/swaputer/explorer/services/svm-indexer/internal/config"
	"github.com/swaputer/explorer/services/svm-indexer/internal/receipt"
	"github.com/swaputer/explorer/services/svm-indexer/migrations"
)

var transferTopic = crypto.Keccak256Hash([]byte("Transfer(bytes32,bytes32,uint256)"))

type Store struct {
	pool   *pgxpool.Pool
	config config.Config
}

func Open(ctx context.Context, cfg config.Config) (*Store, error) {
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, errors.New("create PostgreSQL pool")
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("connect to PostgreSQL")
	}
	return &Store{pool: pool, config: cfg}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}
	entries, err := fs.ReadDir(migrations.Files, ".")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		parts := strings.SplitN(entry.Name(), "_", 2)
		version, err := strconv.Atoi(parts[0])
		if err != nil {
			return fmt.Errorf("invalid migration name %s", entry.Name())
		}
		var appliedName string
		err = s.pool.QueryRow(ctx, "SELECT name FROM schema_migrations WHERE version=$1", version).Scan(&appliedName)
		if err == nil {
			if appliedName != entry.Name() {
				return fmt.Errorf("migration %d is already registered as %s", version, appliedName)
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read migration state: %w", err)
		}
		sql, err := fs.ReadFile(migrations.Files, entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(sql)); err == nil {
			_, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version,name) VALUES($1,$2)", version, entry.Name())
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", entry.Name(), err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}

func (s *Store) Checkpoint(ctx context.Context) (Checkpoint, error) {
	var next uint64
	var number *uint64
	var hashText *string
	err := s.pool.QueryRow(ctx, `SELECT next_block,last_scanned_block_number,last_scanned_block_hash
		FROM indexer_checkpoints WHERE chain_id=$1 AND kernel_address=$2 AND world_id=$3`,
		s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()), strings.ToLower(s.config.WorldID.Hex()),
	).Scan(&next, &number, &hashText)
	if errors.Is(err, pgx.ErrNoRows) {
		return Checkpoint{NextBlock: s.config.StartBlock}, nil
	}
	if err != nil {
		return Checkpoint{}, err
	}
	checkpoint := Checkpoint{NextBlock: next, LastBlockNumber: number}
	if hashText != nil {
		hash := common.HexToHash(*hashText)
		checkpoint.LastBlockHash = &hash
	}
	return checkpoint, nil
}

func (s *Store) CommitBatch(ctx context.Context, batch Batch) error {
	if batch.ScannedTo == nil {
		return errors.New("batch scanned-to header is required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	heights := make([]uint64, 0, len(batch.Headers))
	for height := range batch.Headers {
		heights = append(heights, height)
	}
	sort.Slice(heights, func(i, j int) bool { return heights[i] < heights[j] })
	for _, height := range heights {
		header := batch.Headers[height]
		if err := s.upsertBlock(ctx, tx, header, height <= batch.FinalizedTo); err != nil {
			return err
		}
	}

	for _, execution := range batch.Executions {
		transaction, ok := batch.Transactions[execution.EthereumLog.TxHash]
		if !ok {
			return fmt.Errorf("missing transaction %s", execution.EthereumLog.TxHash.Hex())
		}
		transactionID, err := s.upsertTransaction(ctx, tx, transaction, transaction.Block <= batch.FinalizedTo)
		if err != nil {
			return err
		}
		if err := s.upsertExecution(ctx, tx, transactionID, execution, execution.EthereumLog.BlockNumber <= batch.FinalizedTo); err != nil {
			return err
		}
	}
	for _, ingestionError := range batch.Errors {
		if err := s.upsertError(ctx, tx, ingestionError); err != nil {
			return err
		}
	}
	if err := s.markFinalized(ctx, tx, batch.FinalizedTo); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO indexer_checkpoints(
		chain_id,kernel_address,world_id,start_block,next_block,last_scanned_block_number,last_scanned_block_hash,updated_at
	) VALUES($1,$2,$3,$4,$5,$6,$7,now())
	ON CONFLICT(chain_id,kernel_address,world_id) DO UPDATE SET
		next_block=excluded.next_block,
		last_scanned_block_number=excluded.last_scanned_block_number,
		last_scanned_block_hash=excluded.last_scanned_block_hash,
		updated_at=now()`,
		s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()), strings.ToLower(s.config.WorldID.Hex()),
		s.config.StartBlock, batch.ScannedTo.Number.Uint64()+1, batch.ScannedTo.Number.Uint64(), strings.ToLower(batch.ScannedTo.Hash().Hex()),
	)
	if err != nil {
		return fmt.Errorf("update checkpoint: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Store) upsertBlock(ctx context.Context, tx pgx.Tx, header *types.Header, finalized bool) error {
	number := header.Number.Uint64()
	hash := strings.ToLower(header.Hash().Hex())
	if err := s.orphanCanonicalHeight(ctx, tx, number, hash); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO chain_blocks(
		chain_id,block_number,block_hash,parent_hash,block_time,canonical,finalized
	) VALUES($1,$2,$3,$4,$5,true,$6)
	ON CONFLICT(chain_id,block_hash) DO UPDATE SET
		block_number=excluded.block_number,
		parent_hash=excluded.parent_hash,
		block_time=excluded.block_time,
		canonical=true,
		finalized=chain_blocks.finalized OR excluded.finalized,
		orphaned_at=NULL`,
		s.config.ChainID, number, hash, strings.ToLower(header.ParentHash.Hex()), time.Unix(int64(header.Time), 0).UTC(), finalized,
	)
	if err != nil {
		return fmt.Errorf("upsert block %d: %w", number, err)
	}
	return nil
}

func (s *Store) orphanCanonicalHeight(ctx context.Context, tx pgx.Tx, number uint64, keepHash string) error {
	statements := []string{
		`UPDATE src20_balance_deltas SET canonical=false,finalized=false
		 WHERE chain_id=$1 AND block_number=$2 AND canonical
		   AND execution_id IN (SELECT id FROM svm_executions WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical)`,
		`UPDATE src20_transfers SET canonical=false,finalized=false
		 WHERE chain_id=$1 AND block_number=$2 AND canonical
		   AND execution_id IN (SELECT id FROM svm_executions WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical)`,
		`UPDATE src20_tokens SET canonical=false,finalized=false
		 WHERE chain_id=$1 AND deployment_block=$2 AND canonical
		   AND deployment_execution_id IN (SELECT id FROM svm_executions WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical)`,
		`UPDATE svm_deployments d SET canonical=false,finalized=false
		 WHERE d.execution_id IN (SELECT id FROM svm_executions WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical)`,
		`UPDATE svm_events l SET canonical=false,finalized=false
		 WHERE l.execution_id IN (SELECT id FROM svm_executions WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical)`,
		`UPDATE svm_executions SET canonical=false,finalized=false
		 WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical`,
		`UPDATE chain_transactions SET canonical=false,finalized=false
		 WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical`,
		`UPDATE chain_blocks SET canonical=false,finalized=false,orphaned_at=now()
		 WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND canonical`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, s.config.ChainID, number, keepHash); err != nil {
			return fmt.Errorf("orphan canonical block %d: %w", number, err)
		}
	}
	return nil
}

func (s *Store) upsertTransaction(ctx context.Context, tx pgx.Tx, item Transaction, finalized bool) (int64, error) {
	var recipient any
	if item.Recipient != nil {
		recipient = strings.ToLower(item.Recipient.Hex())
	}
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO chain_transactions(
		chain_id,block_number,block_hash,transaction_hash,transaction_index,sender,recipient,nonce,
		value_wei,input,status,gas_used,canonical,finalized
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)
	ON CONFLICT(chain_id,block_hash,transaction_hash) DO UPDATE SET
		transaction_index=excluded.transaction_index,
		sender=excluded.sender,
		recipient=excluded.recipient,
		nonce=excluded.nonce,
		value_wei=excluded.value_wei,
		input=excluded.input,
		status=excluded.status,
		gas_used=excluded.gas_used,
		canonical=true,
		finalized=chain_transactions.finalized OR excluded.finalized
	RETURNING id`,
		s.config.ChainID, item.Block, strings.ToLower(item.BlockHash.Hex()), strings.ToLower(item.Hash.Hex()), item.Index,
		strings.ToLower(item.Sender.Hex()), recipient, item.Nonce, item.Value.String(), item.Input, item.Status, item.GasUsed, finalized,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("upsert transaction %s: %w", item.Hash.Hex(), err)
	}
	return id, nil
}

func (s *Store) upsertExecution(ctx context.Context, tx pgx.Tx, transactionID int64, item chain.Execution, finalized bool) error {
	summary := item.Receipt.WorldExecution
	var executionID int64
	err := tx.QueryRow(ctx, `INSERT INTO svm_executions(
		transaction_id,chain_id,kernel_address,block_number,block_hash,transaction_hash,ethereum_log_index,
		world_id,execution_height,actor,root_target,executed_bytes,token_burned,gross_token_out,net_token_out,
		raw_log_data,raw_receipt_payload,receipt_version,receipt_flags,canonical,finalized
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,$20)
	ON CONFLICT(chain_id,kernel_address,block_hash,transaction_hash,ethereum_log_index) DO UPDATE SET
		transaction_id=excluded.transaction_id,
		world_id=excluded.world_id,
		execution_height=excluded.execution_height,
		actor=excluded.actor,
		root_target=excluded.root_target,
		executed_bytes=excluded.executed_bytes,
		token_burned=excluded.token_burned,
		gross_token_out=excluded.gross_token_out,
		net_token_out=excluded.net_token_out,
		raw_log_data=excluded.raw_log_data,
		raw_receipt_payload=excluded.raw_receipt_payload,
		canonical=true,
		finalized=svm_executions.finalized OR excluded.finalized
	RETURNING id`,
		transactionID, s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()), item.EthereumLog.BlockNumber,
		strings.ToLower(item.EthereumLog.BlockHash.Hex()), strings.ToLower(item.EthereumLog.TxHash.Hex()), item.EthereumLog.Index,
		strings.ToLower(item.WorldID.Hex()), item.ExecutionHeight, strings.ToLower(summary.Actor.Hex()),
		strings.ToLower(summary.RootTarget.Hex()), summary.ExecutedBytes, summary.TokenBurned.String(),
		summary.GrossTokenOut.String(), summary.NetTokenOut.String(), item.EthereumLog.Data, item.RawReceipt,
		item.Receipt.Version, item.Receipt.Flags, finalized,
	).Scan(&executionID)
	if err != nil {
		return fmt.Errorf("upsert SVM execution %d: %w", item.ExecutionHeight, err)
	}

	for index, record := range item.Receipt.Records {
		topics := [4]any{}
		for topicIndex, topic := range record.Topics {
			topics[topicIndex] = strings.ToLower(topic.Hex())
		}
		_, err := tx.Exec(ctx, `INSERT INTO svm_events(
			execution_id,event_index,emitter,topic_count,topic0,topic1,topic2,topic3,raw_data,record_kind,canonical,finalized
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
		ON CONFLICT(execution_id,event_index) DO UPDATE SET
			emitter=excluded.emitter,
			topic_count=excluded.topic_count,
			topic0=excluded.topic0,
			topic1=excluded.topic1,
			topic2=excluded.topic2,
			topic3=excluded.topic3,
			raw_data=excluded.raw_data,
			record_kind=excluded.record_kind,
			canonical=true,
			finalized=svm_events.finalized OR excluded.finalized`,
			executionID, index, strings.ToLower(record.Emitter.Hex()), len(record.Topics), topics[0], topics[1], topics[2], topics[3],
			record.Data, string(record.Kind), finalized,
		)
		if err != nil {
			return fmt.Errorf("upsert SVM log %d: %w", index, err)
		}
		if record.Kind == receipt.MiniContractDeployedRecord {
			deployment := record.Deployment
			_, err = tx.Exec(ctx, `INSERT INTO svm_deployments(
				execution_id,event_index,chain_id,kernel_address,world_id,program_id,creator,code_hash,canonical,finalized
			) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9)
			ON CONFLICT(execution_id,event_index) DO UPDATE SET
				program_id=excluded.program_id,
				creator=excluded.creator,
				code_hash=excluded.code_hash,
				canonical=true,
				finalized=svm_deployments.finalized OR excluded.finalized`,
				executionID, index, s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()),
				strings.ToLower(item.WorldID.Hex()), strings.ToLower(deployment.ContractID.Hex()),
				strings.ToLower(deployment.Creator.Hex()), strings.ToLower(deployment.CodeHash.Hex()), finalized,
			)
			if err != nil {
				return fmt.Errorf("upsert SVM deployment %d: %w", index, err)
			}
			if s.config.IsTokenCodeHash(deployment.CodeHash) {
				_, err = tx.Exec(ctx, `INSERT INTO src20_tokens(
					chain_id,world_id,program_id,code_hash,creator,deployment_execution_id,deployment_block,canonical,finalized
				) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)
				ON CONFLICT(chain_id,world_id,program_id) DO UPDATE SET
					code_hash=excluded.code_hash,
					creator=excluded.creator,
					deployment_execution_id=excluded.deployment_execution_id,
					deployment_block=excluded.deployment_block,
					canonical=true,
					finalized=src20_tokens.finalized OR excluded.finalized`,
					s.config.ChainID, strings.ToLower(item.WorldID.Hex()), strings.ToLower(deployment.ContractID.Hex()),
					strings.ToLower(deployment.CodeHash.Hex()), strings.ToLower(deployment.Creator.Hex()), executionID,
					item.EthereumLog.BlockNumber, finalized,
				)
				if err != nil {
					return fmt.Errorf("project SRC20 deployment %d: %w", index, err)
				}
			}
		}
		if record.Kind == receipt.ApplicationRecord {
			if err := s.projectTransfer(ctx, tx, executionID, index, item, record, finalized); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) projectTransfer(
	ctx context.Context,
	tx pgx.Tx,
	executionID int64,
	logIndex int,
	execution chain.Execution,
	record receipt.Record,
	finalized bool,
) error {
	if len(record.Topics) != 3 || record.Topics[0] != transferTopic || len(record.Data) != 32 {
		return nil
	}
	tokenID := strings.ToLower(record.Emitter.Hex())
	var supported bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM src20_tokens WHERE chain_id=$1 AND world_id=$2 AND program_id=$3 AND canonical
	)`, s.config.ChainID, strings.ToLower(execution.WorldID.Hex()), tokenID).Scan(&supported); err != nil {
		return fmt.Errorf("resolve SRC20 emitter: %w", err)
	}
	if !supported {
		return nil
	}
	sender := record.Topics[1]
	recipient := record.Topics[2]
	amount := new(big.Int).SetBytes(record.Data)
	_, err := tx.Exec(ctx, `INSERT INTO src20_transfers(
		execution_id,event_index,chain_id,world_id,token_id,block_number,transaction_hash,
		sender_account,recipient_account,amount,mint,burn,canonical,finalized
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)
	ON CONFLICT(execution_id,event_index) DO UPDATE SET
		sender_account=excluded.sender_account,
		recipient_account=excluded.recipient_account,
		amount=excluded.amount,
		mint=excluded.mint,
		burn=excluded.burn,
		canonical=true,
		finalized=src20_transfers.finalized OR excluded.finalized`,
		executionID, logIndex, s.config.ChainID, strings.ToLower(execution.WorldID.Hex()), tokenID,
		execution.EthereumLog.BlockNumber, strings.ToLower(execution.EthereumLog.TxHash.Hex()),
		strings.ToLower(sender.Hex()), strings.ToLower(recipient.Hex()), amount.String(), sender == (common.Hash{}),
		recipient == (common.Hash{}), finalized,
	)
	if err != nil {
		return fmt.Errorf("project SRC20 transfer: %w", err)
	}
	if amount.Sign() == 0 {
		return nil
	}
	if sender != (common.Hash{}) {
		if err := s.upsertBalanceDelta(ctx, tx, executionID, logIndex, -1, tokenID, sender, "-"+amount.String(), execution.EthereumLog.BlockNumber, finalized); err != nil {
			return err
		}
	}
	if recipient != (common.Hash{}) {
		if err := s.upsertBalanceDelta(ctx, tx, executionID, logIndex, 1, tokenID, recipient, amount.String(), execution.EthereumLog.BlockNumber, finalized); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE src20_tokens t SET total_supply=COALESCE((
		SELECT sum(b.balance) FROM src20_balances b
		WHERE b.chain_id=t.chain_id AND b.world_id=t.world_id AND b.token_id=t.program_id
	),0) WHERE t.chain_id=$1 AND t.world_id=$2 AND t.program_id=$3 AND t.canonical`,
		s.config.ChainID, strings.ToLower(execution.WorldID.Hex()), tokenID)
	if err != nil {
		return fmt.Errorf("refresh SRC20 total supply: %w", err)
	}
	return nil
}

func (s *Store) upsertBalanceDelta(
	ctx context.Context,
	tx pgx.Tx,
	executionID int64,
	logIndex int,
	direction int,
	tokenID string,
	account common.Hash,
	delta string,
	block uint64,
	finalized bool,
) error {
	_, err := tx.Exec(ctx, `INSERT INTO src20_balance_deltas(
		execution_id,event_index,direction,chain_id,world_id,token_id,account_id,delta,block_number,canonical,finalized
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)
	ON CONFLICT(execution_id,event_index,direction) DO UPDATE SET
		account_id=excluded.account_id,
		delta=excluded.delta,
		canonical=true,
		finalized=src20_balance_deltas.finalized OR excluded.finalized`,
		executionID, logIndex, direction, s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), tokenID,
		strings.ToLower(account.Hex()), delta, block, finalized,
	)
	if err != nil {
		return fmt.Errorf("project SRC20 balance delta: %w", err)
	}
	return nil
}

func (s *Store) upsertError(ctx context.Context, tx pgx.Tx, item IngestionError) error {
	details, _ := json.Marshal(item.Details)
	rawLog, _ := json.Marshal(item.RawLog)
	result, err := tx.Exec(ctx, `INSERT INTO indexer_errors(
		chain_id,kernel_address,block_number,block_hash,transaction_hash,ethereum_log_index,category,error_code,error_details,raw_log
	) VALUES($1,$2,$3,$4,$5,$6,'RECEIPT',$7,$8,$9)
	ON CONFLICT DO NOTHING`,
		s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()), item.BlockNumber,
		strings.ToLower(item.BlockHash.Hex()), strings.ToLower(item.TxHash.Hex()), item.LogIndex, item.Code, string(details), string(rawLog),
	)
	if err != nil {
		return fmt.Errorf("record ingestion error: %w", err)
	}
	if result.RowsAffected() == 0 {
		_, err = tx.Exec(ctx, `UPDATE indexer_errors SET last_seen_at=now(),occurrences=occurrences+1,error_details=$7,raw_log=$8
		 WHERE chain_id=$1 AND kernel_address=$2 AND COALESCE(block_hash,'')=$3 AND COALESCE(transaction_hash,'')=$4
		   AND COALESCE(ethereum_log_index,-1)=$5 AND error_code=$6`,
			s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()), strings.ToLower(item.BlockHash.Hex()),
			strings.ToLower(item.TxHash.Hex()), item.LogIndex, item.Code, string(details), string(rawLog),
		)
		if err != nil {
			return fmt.Errorf("update ingestion error: %w", err)
		}
	}
	return nil
}

func (s *Store) markFinalized(ctx context.Context, tx pgx.Tx, height uint64) error {
	statements := []string{
		`UPDATE chain_blocks SET finalized=true WHERE chain_id=$1 AND canonical AND block_number<=$2`,
		`UPDATE chain_transactions SET finalized=true WHERE chain_id=$1 AND canonical AND block_number<=$2`,
		`UPDATE src20_tokens SET finalized=true WHERE chain_id=$1 AND canonical AND deployment_block<=$2`,
		`UPDATE src20_transfers SET finalized=true WHERE chain_id=$1 AND canonical AND block_number<=$2`,
		`UPDATE src20_balance_deltas SET finalized=true WHERE chain_id=$1 AND canonical AND block_number<=$2`,
		`UPDATE svm_executions SET finalized=true WHERE chain_id=$1 AND canonical AND block_number<=$2`,
		`UPDATE svm_events l SET finalized=true FROM svm_executions e
		 WHERE l.execution_id=e.id AND e.chain_id=$1 AND e.canonical AND e.block_number<=$2`,
		`UPDATE svm_deployments d SET finalized=true FROM svm_executions e
		 WHERE d.execution_id=e.id AND e.chain_id=$1 AND e.canonical AND e.block_number<=$2`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, s.config.ChainID, height); err != nil {
			return fmt.Errorf("mark finalized through %d: %w", height, err)
		}
	}
	return nil
}

func (s *Store) Rewind(ctx context.Context, fromBlock uint64) error {
	if fromBlock < s.config.StartBlock {
		fromBlock = s.config.StartBlock
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	statements := []string{
		`UPDATE src20_balance_deltas SET canonical=false,finalized=false WHERE chain_id=$1 AND block_number>=$2 AND canonical`,
		`UPDATE src20_transfers SET canonical=false,finalized=false WHERE chain_id=$1 AND block_number>=$2 AND canonical`,
		`UPDATE src20_tokens SET canonical=false,finalized=false WHERE chain_id=$1 AND deployment_block>=$2 AND canonical`,
		`UPDATE svm_deployments d SET canonical=false,finalized=false
		 WHERE d.execution_id IN (SELECT id FROM svm_executions WHERE chain_id=$1 AND block_number>=$2 AND canonical)`,
		`UPDATE svm_events l SET canonical=false,finalized=false
		 WHERE l.execution_id IN (SELECT id FROM svm_executions WHERE chain_id=$1 AND block_number>=$2 AND canonical)`,
		`UPDATE svm_executions SET canonical=false,finalized=false WHERE chain_id=$1 AND block_number>=$2 AND canonical`,
		`UPDATE chain_transactions SET canonical=false,finalized=false WHERE chain_id=$1 AND block_number>=$2 AND canonical`,
		`UPDATE chain_blocks SET canonical=false,finalized=false,orphaned_at=now()
		 WHERE chain_id=$1 AND block_number>=$2 AND canonical`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, s.config.ChainID, fromBlock); err != nil {
			return fmt.Errorf("rewind from block %d: %w", fromBlock, err)
		}
	}
	_, err = tx.Exec(ctx, `UPDATE src20_tokens t SET total_supply=COALESCE((
		SELECT sum(b.balance) FROM src20_balances b
		WHERE b.chain_id=t.chain_id AND b.world_id=t.world_id AND b.token_id=t.program_id
	),0) WHERE t.chain_id=$1 AND t.world_id=$2 AND t.canonical`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()))
	if err != nil {
		return fmt.Errorf("refresh SRC20 supplies after rewind: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO indexer_checkpoints(
		chain_id,kernel_address,world_id,start_block,next_block,last_scanned_block_number,last_scanned_block_hash,updated_at
	) VALUES($1,$2,$3,$4,$5,NULL,NULL,now())
	ON CONFLICT(chain_id,kernel_address,world_id) DO UPDATE SET
		next_block=excluded.next_block,last_scanned_block_number=NULL,last_scanned_block_hash=NULL,updated_at=now()`,
		s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()), strings.ToLower(s.config.WorldID.Hex()), s.config.StartBlock, fromBlock,
	)
	if err != nil {
		return fmt.Errorf("rewind checkpoint: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Store) Status(ctx context.Context) (Status, error) {
	var next uint64
	var canonicalTip, finalizedTip *int64
	var executions, accounts, events, deployments, ingestionErrors uint64
	var updated time.Time
	err := s.pool.QueryRow(ctx, `SELECT
		c.next_block,
		(SELECT max(block_number) FROM chain_blocks WHERE chain_id=c.chain_id AND canonical),
		(SELECT max(block_number) FROM chain_blocks WHERE chain_id=c.chain_id AND canonical AND finalized),
		(SELECT count(*) FROM svm_executions WHERE chain_id=c.chain_id AND kernel_address=c.kernel_address AND world_id=c.world_id AND canonical),
		(SELECT count(DISTINCT actor) FROM svm_executions
		 WHERE chain_id=c.chain_id AND kernel_address=c.kernel_address AND world_id=c.world_id AND canonical),
		(SELECT count(*) FROM svm_events l JOIN svm_executions e ON e.id=l.execution_id
		 WHERE e.chain_id=c.chain_id AND e.kernel_address=c.kernel_address AND e.world_id=c.world_id AND l.canonical),
		(SELECT count(*) FROM svm_deployments WHERE chain_id=c.chain_id AND kernel_address=c.kernel_address AND world_id=c.world_id AND canonical),
		(SELECT count(*) FROM indexer_errors WHERE chain_id=c.chain_id AND kernel_address=c.kernel_address),
		c.updated_at
	FROM indexer_checkpoints c WHERE c.chain_id=$1 AND c.kernel_address=$2 AND c.world_id=$3`,
		s.config.ChainID, strings.ToLower(s.config.KernelAddress.Hex()), strings.ToLower(s.config.WorldID.Hex()),
	).Scan(&next, &canonicalTip, &finalizedTip, &executions, &accounts, &events, &deployments, &ingestionErrors, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return Status{
			ChainID: s.config.ChainID, KernelAddress: s.config.KernelAddress.Hex(), WorldID: s.config.WorldID.Hex(),
			NextBlock: s.config.StartBlock, UpdatedAt: time.Time{}.UTC().Format(time.RFC3339),
		}, nil
	}
	if err != nil {
		return Status{}, err
	}
	status := Status{
		ChainID: s.config.ChainID, KernelAddress: s.config.KernelAddress.Hex(), WorldID: s.config.WorldID.Hex(),
		NextBlock: next, Executions: executions, Accounts: accounts, Events: events, Deployments: deployments, Errors: ingestionErrors,
		UpdatedAt: updated.UTC().Format(time.RFC3339),
	}
	if canonicalTip != nil {
		value := uint64(*canonicalTip)
		status.CanonicalTip = &value
	}
	if finalizedTip != nil {
		value := uint64(*finalizedTip)
		status.FinalizedTip = &value
	}
	return status, nil
}

func (s *Store) Transaction(ctx context.Context, hash common.Hash) (TransactionDetail, error) {
	var detail TransactionDetail
	var recipient, value, gas string
	var input []byte
	var blockTime time.Time
	err := s.pool.QueryRow(ctx, `SELECT
		t.transaction_hash,t.block_number,t.block_hash,b.block_time,t.transaction_index,t.sender,
		COALESCE(t.recipient,''),t.nonce,t.value_wei::text,t.status,t.gas_used::text,t.input,t.canonical,t.finalized
	FROM chain_transactions t JOIN chain_blocks b ON b.chain_id=t.chain_id AND b.block_hash=t.block_hash
	WHERE t.chain_id=$1 AND t.transaction_hash=$2
	ORDER BY t.canonical DESC,t.block_number DESC LIMIT 1`,
		s.config.ChainID, strings.ToLower(hash.Hex()),
	).Scan(&detail.Hash, &detail.BlockNumber, &detail.BlockHash, &blockTime, &detail.Index, &detail.Sender,
		&recipient, &detail.Nonce, &value, &detail.Status, &gas, &input, &detail.Canonical, &detail.Finalized)
	if err != nil {
		return TransactionDetail{}, err
	}
	detail.Recipient = recipient
	detail.ValueWei = value
	detail.GasUsed = gas
	detail.Input = hexutil.Encode(input)
	detail.BlockTime = blockTime.UTC().Format(time.RFC3339)
	detail.Executions = make([]ExecutionDetail, 0)

	rows, err := s.pool.Query(ctx, `SELECT id,ethereum_log_index,world_id,execution_height,actor,root_target,
		executed_bytes,token_burned::text,gross_token_out::text,net_token_out::text,raw_receipt_payload,receipt_version,receipt_flags
	FROM svm_executions WHERE chain_id=$1 AND transaction_hash=$2 AND canonical=$3
	ORDER BY ethereum_log_index`, s.config.ChainID, strings.ToLower(hash.Hex()), detail.Canonical)
	if err != nil {
		return TransactionDetail{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var execution ExecutionDetail
		var rawReceipt []byte
		if err := rows.Scan(&execution.ID, &execution.EthereumLogIndex, &execution.WorldID, &execution.ExecutionHeight,
			&execution.Actor, &execution.RootTarget, &execution.ExecutedBytes, &execution.TokenBurned,
			&execution.GrossTokenOut, &execution.NetTokenOut, &rawReceipt, &execution.ReceiptVersion, &execution.ReceiptFlags); err != nil {
			return TransactionDetail{}, err
		}
		execution.RawReceipt = hexutil.Encode(rawReceipt)
		execution.Events, err = s.events(ctx, execution.ID)
		if err != nil {
			return TransactionDetail{}, err
		}
		detail.Executions = append(detail.Executions, execution)
	}
	return detail, rows.Err()
}

func (s *Store) events(ctx context.Context, executionID int64) ([]EventDetail, error) {
	rows, err := s.pool.Query(ctx, `SELECT event_index,emitter,topic0,topic1,topic2,topic3,raw_data,record_kind
		FROM svm_events WHERE execution_id=$1 ORDER BY event_index`, executionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]EventDetail, 0)
	for rows.Next() {
		var item EventDetail
		var topics [4]*string
		var data []byte
		if err := rows.Scan(&item.Index, &item.Emitter, &topics[0], &topics[1], &topics[2], &topics[3], &data, &item.Kind); err != nil {
			return nil, err
		}
		item.Topics = make([]string, 0, 4)
		for _, topic := range topics {
			if topic != nil {
				item.Topics = append(item.Topics, *topic)
			}
		}
		item.Data = hexutil.Encode(data)
		result = append(result, item)
	}
	return result, rows.Err()
}
