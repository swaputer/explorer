package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ActiveMarkets(ctx context.Context, limit int) ([]MarketSummary, error) {
	rows, err := s.pool.Query(ctx, `SELECT
		m.token_id,m.market_address,m.escrow_id,COALESCE(t.name,''),COALESCE(t.symbol,''),COALESCE(t.decimals,18),
		COALESCE(max(o.unit_price_wei) FILTER (WHERE o.side=0),0)::text,
		COALESCE(min(o.unit_price_wei) FILTER (WHERE o.side=1),0)::text,
		count(o.order_id),COALESCE((SELECT max(bt.block_time)::text FROM market_order_fills lf
			JOIN chain_blocks bt ON bt.chain_id=lf.chain_id AND bt.block_number=lf.block_number AND bt.canonical
			WHERE lf.chain_id=m.chain_id AND lf.market_address=m.market_address AND lf.canonical),'')
	FROM src20_markets m
	JOIN src20_tokens t ON t.chain_id=m.chain_id AND t.world_id=m.world_id AND t.program_id=m.token_id AND t.canonical
	JOIN market_orders o ON o.chain_id=m.chain_id AND o.market_address=m.market_address AND o.canonical
		AND o.expiry>extract(epoch from now())::bigint
		AND NOT EXISTS (SELECT 1 FROM market_order_fills f WHERE f.chain_id=o.chain_id AND f.market_address=o.market_address AND f.order_id=o.order_id AND f.canonical)
		AND NOT EXISTS (SELECT 1 FROM market_order_cancellations c WHERE c.chain_id=o.chain_id AND c.market_address=o.market_address AND c.order_id=o.order_id AND c.canonical)
	WHERE m.chain_id=$1 AND m.world_id=$2 AND m.canonical
	GROUP BY m.chain_id,m.token_id,m.market_address,m.escrow_id,t.name,t.symbol,t.decimals
	ORDER BY count(o.order_id) DESC,m.token_id LIMIT $3`, s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]MarketSummary, 0)
	for rows.Next() {
		var item MarketSummary
		if err := rows.Scan(&item.ProgramID, &item.MarketAddress, &item.EscrowID, &item.Name, &item.Symbol, &item.Decimals, &item.BestBidWei, &item.BestAskWei, &item.OpenOrders, &item.LastTradeTime); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) Market(ctx context.Context, program common.Hash) (MarketSummary, error) {
	var item MarketSummary
	err := s.pool.QueryRow(ctx, `SELECT
		m.token_id,m.market_address,m.escrow_id,COALESCE(t.name,''),COALESCE(t.symbol,''),COALESCE(t.decimals,18),
		COALESCE(max(o.unit_price_wei) FILTER (WHERE o.side=0 AND f.order_id IS NULL AND c.order_id IS NULL AND o.expiry>extract(epoch from now())::bigint),0)::text,
		COALESCE(min(o.unit_price_wei) FILTER (WHERE o.side=1 AND f.order_id IS NULL AND c.order_id IS NULL AND o.expiry>extract(epoch from now())::bigint),0)::text,
		count(o.order_id) FILTER (WHERE f.order_id IS NULL AND c.order_id IS NULL AND o.expiry>extract(epoch from now())::bigint)
	FROM src20_markets m
	LEFT JOIN src20_tokens t ON t.chain_id=m.chain_id AND t.world_id=m.world_id AND t.program_id=m.token_id AND t.canonical
	LEFT JOIN market_orders o ON o.chain_id=m.chain_id AND o.market_address=m.market_address AND o.canonical
	LEFT JOIN market_order_fills f ON f.chain_id=o.chain_id AND f.market_address=o.market_address AND f.order_id=o.order_id AND f.canonical
	LEFT JOIN market_order_cancellations c ON c.chain_id=o.chain_id AND c.market_address=o.market_address AND c.order_id=o.order_id AND c.canonical
	WHERE m.chain_id=$1 AND m.world_id=$2 AND m.token_id=$3 AND m.canonical
	GROUP BY m.token_id,m.market_address,m.escrow_id,t.name,t.symbol,t.decimals`,
		s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(program.Hex())).Scan(
		&item.ProgramID, &item.MarketAddress, &item.EscrowID, &item.Name, &item.Symbol, &item.Decimals, &item.BestBidWei, &item.BestAskWei, &item.OpenOrders)
	return item, err
}

type MarketCursor struct {
	BlockNumber uint64
	LogIndex    uint
}

func (s *Store) MarketOrders(ctx context.Context, program common.Hash, status, side, maker string, limit int, cursor *MarketCursor) ([]MarketOrder, error) {
	conditions := []string{"m.chain_id=$1", "m.world_id=$2", "m.token_id=$3", "m.canonical", "o.canonical"}
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(program.Hex())}
	state := `CASE WHEN f.order_id IS NOT NULL THEN 'filled' WHEN c.order_id IS NOT NULL THEN 'cancelled' WHEN o.expiry<=extract(epoch from now())::bigint THEN 'expired' ELSE 'open' END`
	if status != "" {
		args = append(args, status)
		conditions = append(conditions, fmt.Sprintf("%s=$%d", state, len(args)))
	}
	if side != "" {
		value := 0
		if side == "sell" {
			value = 1
		}
		args = append(args, value)
		conditions = append(conditions, fmt.Sprintf("o.side=$%d", len(args)))
	}
	if maker != "" {
		args = append(args, strings.ToLower(maker))
		conditions = append(conditions, fmt.Sprintf("o.maker=$%d", len(args)))
	}
	if cursor != nil {
		args = append(args, cursor.BlockNumber, cursor.LogIndex)
		conditions = append(conditions, fmt.Sprintf("(o.block_number < $%d OR (o.block_number = $%d AND o.ethereum_log_index < $%d))", len(args)-1, len(args)-1, len(args)))
	}
	args = append(args, limit)
	query := `SELECT o.order_id::text,o.token_id,o.market_address,CASE WHEN o.side=0 THEN 'buy' ELSE 'sell' END,` + state + `,
		o.maker,COALESCE(CASE WHEN o.side=0 THEN f.seller ELSE f.buyer END,''),o.amount::text,o.unit_price_wei::text,
		o.price_wei::text,o.vm_eth_amount::text,o.expiry,o.block_number,o.transaction_hash,o.finalized,o.ethereum_log_index
	FROM market_orders o JOIN src20_markets m ON m.chain_id=o.chain_id AND m.market_address=o.market_address
	LEFT JOIN market_order_fills f ON f.chain_id=o.chain_id AND f.market_address=o.market_address AND f.order_id=o.order_id AND f.canonical
	LEFT JOIN market_order_cancellations c ON c.chain_id=o.chain_id AND c.market_address=o.market_address AND c.order_id=o.order_id AND c.canonical
	WHERE ` + strings.Join(conditions, " AND ") + fmt.Sprintf(" ORDER BY o.block_number DESC,o.ethereum_log_index DESC LIMIT $%d", len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]MarketOrder, 0)
	for rows.Next() {
		var item MarketOrder
		if err := rows.Scan(&item.OrderID, &item.ProgramID, &item.MarketAddress, &item.Side, &item.Status, &item.Maker, &item.Taker, &item.Amount, &item.UnitPriceWei, &item.PriceWei, &item.VMETHAmount, &item.Expiry, &item.BlockNumber, &item.TransactionHash, &item.Finalized, &item.LogIndex); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) MarketTrades(ctx context.Context, program common.Hash, limit int, cursor *MarketCursor) ([]MarketTrade, error) {
	args := []any{s.config.ChainID, strings.ToLower(s.config.WorldID.Hex()), strings.ToLower(program.Hex())}
	query := `SELECT o.order_id::text,o.token_id,o.market_address,CASE WHEN o.side=0 THEN 'buy' ELSE 'sell' END,
		f.seller,f.buyer,f.amount::text,f.price_wei::text,o.unit_price_wei::text,f.block_number,b.block_time::text,
		f.transaction_hash,f.finalized,f.ethereum_log_index
	FROM market_order_fills f JOIN market_orders o ON o.chain_id=f.chain_id AND o.market_address=f.market_address AND o.order_id=f.order_id AND o.canonical
	JOIN chain_blocks b ON b.chain_id=f.chain_id AND b.block_number=f.block_number AND b.canonical
	WHERE f.chain_id=$1 AND o.world_id=$2 AND o.token_id=$3 AND f.canonical`
	if cursor != nil {
		query += ` AND (f.block_number < $4 OR (f.block_number = $4 AND f.ethereum_log_index < $5))`
		args = append(args, cursor.BlockNumber, cursor.LogIndex)
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY f.block_number DESC,f.ethereum_log_index DESC LIMIT $%d`, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]MarketTrade, 0)
	for rows.Next() {
		var item MarketTrade
		if err := rows.Scan(&item.OrderID, &item.ProgramID, &item.MarketAddress, &item.Side, &item.Seller, &item.Buyer, &item.Amount, &item.PriceWei, &item.UnitPriceWei, &item.BlockNumber, &item.BlockTime, &item.TransactionHash, &item.Finalized, &item.LogIndex); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func IsMarketNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
