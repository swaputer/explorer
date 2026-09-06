package chain

import (
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

var (
	MarketCreatedTopic  = crypto.Keccak256Hash([]byte("MarketCreated(bytes32,address,bytes32,bytes32,uint256)"))
	OrderCreatedTopic   = crypto.Keccak256Hash([]byte("OrderCreated(uint256,uint8,address,uint128,uint128,uint128,uint128,uint64)"))
	OrderFilledTopic    = crypto.Keccak256Hash([]byte("OrderFilled(uint256,address,address,uint128,uint128,uint256)"))
	OrderCancelledTopic = crypto.Keccak256Hash([]byte("OrderCancelled(uint256,address)"))
)

type MarketEventKind string

const (
	MarketRegistered     MarketEventKind = "market_created"
	MarketOrderCreated   MarketEventKind = "order_created"
	MarketOrderFilled    MarketEventKind = "order_filled"
	MarketOrderCancelled MarketEventKind = "order_cancelled"
)

type MarketEvent struct {
	Kind          MarketEventKind
	EthereumLog   types.Log
	Market        common.Address
	Token         common.Hash
	Escrow        common.Hash
	TokenCodeHash common.Hash
	MarketIndex   *big.Int
	OrderID       *big.Int
	Side          uint8
	Maker         common.Address
	Seller        common.Address
	Buyer         common.Address
	Amount        *big.Int
	UnitPriceWei  *big.Int
	PriceWei      *big.Int
	VMETHAmount   *big.Int
	VMETHSpent    *big.Int
	Expiry        uint64
}

func ParseMarketEvent(item types.Log, factory common.Address, knownMarkets map[common.Address]struct{}) (MarketEvent, bool, error) {
	if len(item.Topics) == 0 {
		return MarketEvent{}, false, nil
	}
	topic := item.Topics[0]
	if topic == MarketCreatedTopic {
		if item.Address != factory {
			return MarketEvent{}, false, nil
		}
		if len(item.Topics) != 4 || len(item.Data) != 64 {
			return MarketEvent{}, true, errors.New("invalid MarketCreated log")
		}
		market := common.BytesToAddress(item.Topics[2].Bytes()[12:])
		return MarketEvent{
			Kind: MarketRegistered, EthereumLog: item, Market: market,
			Token: item.Topics[1], Escrow: item.Topics[3], TokenCodeHash: word(item.Data, 0),
			MarketIndex: uintWord(item.Data, 1),
		}, true, nil
	}
	if _, ok := knownMarkets[item.Address]; !ok {
		return MarketEvent{}, false, nil
	}
	switch topic {
	case OrderCreatedTopic:
		if len(item.Topics) != 4 || len(item.Data) != 160 {
			return MarketEvent{}, true, errors.New("invalid OrderCreated log")
		}
		side := uintWord(item.Topics[2].Bytes(), 0)
		if !side.IsUint64() || side.Uint64() > 1 {
			return MarketEvent{}, true, errors.New("invalid order side")
		}
		expiry := uintWord(item.Data, 4)
		if !expiry.IsUint64() {
			return MarketEvent{}, true, errors.New("invalid order expiry")
		}
		return MarketEvent{
			Kind: MarketOrderCreated, EthereumLog: item, Market: item.Address,
			OrderID: new(big.Int).SetBytes(item.Topics[1].Bytes()), Side: uint8(side.Uint64()),
			Maker: common.BytesToAddress(item.Topics[3].Bytes()[12:]), Amount: uintWord(item.Data, 0),
			UnitPriceWei: uintWord(item.Data, 1), PriceWei: uintWord(item.Data, 2),
			VMETHAmount: uintWord(item.Data, 3), Expiry: expiry.Uint64(),
		}, true, nil
	case OrderFilledTopic:
		if len(item.Topics) != 4 || len(item.Data) != 96 {
			return MarketEvent{}, true, errors.New("invalid OrderFilled log")
		}
		return MarketEvent{
			Kind: MarketOrderFilled, EthereumLog: item, Market: item.Address,
			OrderID: new(big.Int).SetBytes(item.Topics[1].Bytes()),
			Seller:  common.BytesToAddress(item.Topics[2].Bytes()[12:]),
			Buyer:   common.BytesToAddress(item.Topics[3].Bytes()[12:]),
			Amount:  uintWord(item.Data, 0), PriceWei: uintWord(item.Data, 1), VMETHSpent: uintWord(item.Data, 2),
		}, true, nil
	case OrderCancelledTopic:
		if len(item.Topics) != 3 || len(item.Data) != 0 {
			return MarketEvent{}, true, errors.New("invalid OrderCancelled log")
		}
		return MarketEvent{
			Kind: MarketOrderCancelled, EthereumLog: item, Market: item.Address,
			OrderID: new(big.Int).SetBytes(item.Topics[1].Bytes()), Maker: common.BytesToAddress(item.Topics[2].Bytes()[12:]),
		}, true, nil
	default:
		return MarketEvent{}, false, nil
	}
}

func word(data []byte, index int) common.Hash {
	start := index * 32
	return common.BytesToHash(data[start : start+32])
}

func uintWord(data []byte, index int) *big.Int {
	start := index * 32
	return new(big.Int).SetBytes(data[start : start+32])
}
