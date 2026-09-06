package receipt

import (
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

type RecordKind string

const (
	ApplicationRecord          RecordKind = "application"
	WorldExecutionRecord       RecordKind = "world_execution"
	MiniContractDeployedRecord RecordKind = "mini_contract_deployed"
)

type WorldExecution struct {
	Actor         common.Hash
	RootTarget    common.Hash
	ExecutedBytes uint32
	TokenBurned   *big.Int
	GrossTokenOut *big.Int
	NetTokenOut   *big.Int
}

type Deployment struct {
	ContractID common.Hash
	Creator    common.Hash
	CodeHash   common.Hash
}

type Record struct {
	Length         uint32
	Emitter        common.Hash
	Topics         []common.Hash
	Data           []byte
	Kind           RecordKind
	WorldExecution *WorldExecution
	Deployment     *Deployment
}

type Receipt struct {
	Version        uint8
	Flags          uint8
	Records        []Record
	WorldExecution WorldExecution
}
