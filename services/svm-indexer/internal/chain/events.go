package chain

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/swaputer/explorer/services/svm-indexer/internal/receipt"
)

var EventsTopic = crypto.Keccak256Hash([]byte("Events(bytes32,uint64,bytes)"))

type Execution struct {
	EthereumLog     types.Log
	WorldID         common.Hash
	ExecutionHeight uint64
	RawReceipt      []byte
	Receipt         receipt.Receipt
}

func ParseExecution(log types.Log, kernel common.Address) (Execution, error) {
	if log.Address != kernel {
		return Execution{}, errors.New("event emitter does not match configured kernel")
	}
	if len(log.Topics) != 3 || log.Topics[0] != EventsTopic {
		return Execution{}, errors.New("invalid Events topics")
	}
	for _, value := range log.Topics[2].Bytes()[:24] {
		if value != 0 {
			return Execution{}, errors.New("execution height is not uint64")
		}
	}
	height := binary.BigEndian.Uint64(log.Topics[2].Bytes()[24:])
	payload, err := decodeOuterData(log.Data)
	if err != nil {
		return Execution{}, err
	}
	decoded, err := receipt.Decode(payload)
	if err != nil {
		return Execution{}, fmt.Errorf("decode receipt: %w", err)
	}
	return Execution{
		EthereumLog:     log,
		WorldID:         log.Topics[1],
		ExecutionHeight: height,
		RawReceipt:      payload,
		Receipt:         decoded,
	}, nil
}

func decodeOuterData(data []byte) ([]byte, error) {
	if len(data) < 64 {
		return nil, errors.New("Events data is truncated")
	}
	offset := new(big.Int).SetBytes(data[0:32])
	if offset.Cmp(big.NewInt(32)) != 0 {
		return nil, errors.New("Events data has a noncanonical offset")
	}
	lengthWord := new(big.Int).SetBytes(data[32:64])
	if !lengthWord.IsUint64() || lengthWord.Uint64() > 65536 {
		return nil, errors.New("Events payload is too large")
	}
	length := int(lengthWord.Uint64())
	padded := (length + 31) / 32 * 32
	if 64+padded != len(data) {
		return nil, errors.New("Events data has invalid trailing bytes")
	}
	for _, value := range data[64+length:] {
		if value != 0 {
			return nil, errors.New("Events data has nonzero padding")
		}
	}
	payload := make([]byte, length)
	copy(payload, data[64:64+length])
	return payload, nil
}
