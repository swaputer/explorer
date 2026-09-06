package chain

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func padded(values ...*big.Int) []byte {
	result := make([]byte, 0, len(values)*32)
	for _, value := range values {
		result = append(result, common.LeftPadBytes(value.Bytes(), 32)...)
	}
	return result
}

func TestParseMarketOrderCreated(t *testing.T) {
	factory := common.HexToAddress("0x1000000000000000000000000000000000000001")
	market := common.HexToAddress("0x2000000000000000000000000000000000000002")
	maker := common.HexToAddress("0x3000000000000000000000000000000000000003")
	item := types.Log{Address: market, Topics: []common.Hash{OrderCreatedTopic, common.BigToHash(big.NewInt(9)), common.BigToHash(big.NewInt(1)), common.BytesToHash(maker.Bytes())}, Data: padded(big.NewInt(100), big.NewInt(2), big.NewInt(200), big.NewInt(3), big.NewInt(999))}
	event, recognized, err := ParseMarketEvent(item, factory, map[common.Address]struct{}{market: {}})
	if err != nil || !recognized {
		t.Fatalf("parse failed: recognized=%v err=%v", recognized, err)
	}
	if event.Kind != MarketOrderCreated || event.OrderID.String() != "9" || event.Side != 1 || event.Maker != maker || event.Amount.String() != "100" || event.Expiry != 999 {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestIgnoresOrderFromUnknownMarket(t *testing.T) {
	item := types.Log{Address: common.HexToAddress("0x2000000000000000000000000000000000000002"), Topics: []common.Hash{OrderCancelledTopic, common.Hash{}, common.Hash{}}}
	_, recognized, err := ParseMarketEvent(item, common.Address{}, map[common.Address]struct{}{})
	if err != nil || recognized {
		t.Fatalf("unknown market accepted: recognized=%v err=%v", recognized, err)
	}
}
