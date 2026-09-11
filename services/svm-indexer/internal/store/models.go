package store

import (
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/swaputer/explorer/services/svm-indexer/internal/chain"
)

type Transaction struct {
	Hash      common.Hash
	BlockHash common.Hash
	Block     uint64
	Index     uint
	Sender    common.Address
	Recipient *common.Address
	Nonce     uint64
	Value     *big.Int
	Input     []byte
	Status    uint64
	GasUsed   uint64
}

type IngestionError struct {
	BlockNumber uint64
	BlockHash   common.Hash
	TxHash      common.Hash
	LogIndex    uint
	Code        string
	Details     map[string]any
	RawLog      types.Log
}

type Batch struct {
	ScannedTo    *types.Header
	Headers      map[uint64]*types.Header
	Transactions map[common.Hash]Transaction
	Executions   []chain.Execution
	Errors       []IngestionError
	FinalizedTo  uint64
}

type Checkpoint struct {
	NextBlock       uint64
	LastBlockNumber *uint64
	LastBlockHash   *common.Hash
}

type Status struct {
	ChainID       uint64  `json:"chainId"`
	KernelAddress string  `json:"kernelAddress"`
	WorldID       string  `json:"worldId"`
	NextBlock     uint64  `json:"nextBlock"`
	CanonicalTip  *uint64 `json:"canonicalTip"`
	FinalizedTip  *uint64 `json:"finalizedTip"`
	Executions    uint64  `json:"executions"`
	Accounts      uint64  `json:"accounts"`
	Events        uint64  `json:"events"`
	Deployments   uint64  `json:"deployments"`
	Errors        uint64  `json:"errors"`
	UpdatedAt     string  `json:"updatedAt"`
}

type TransactionDetail struct {
	Hash        string            `json:"hash"`
	BlockNumber uint64            `json:"blockNumber"`
	BlockHash   string            `json:"blockHash"`
	BlockTime   string            `json:"blockTime"`
	Index       uint              `json:"transactionIndex"`
	Sender      string            `json:"sender"`
	Recipient   string            `json:"recipient,omitempty"`
	Nonce       uint64            `json:"nonce"`
	ValueWei    string            `json:"valueWei"`
	Status      uint64            `json:"status"`
	GasUsed     string            `json:"gasUsed"`
	Input       string            `json:"input"`
	Canonical   bool              `json:"canonical"`
	Finalized   bool              `json:"finalized"`
	Executions  []ExecutionDetail `json:"executions"`
}

type ExecutionDetail struct {
	ID               int64         `json:"id"`
	EthereumLogIndex uint          `json:"ethereumLogIndex"`
	WorldID          string        `json:"worldId"`
	ExecutionHeight  uint64        `json:"executionHeight"`
	Actor            string        `json:"actor"`
	RootTarget       string        `json:"rootTarget"`
	ExecutedBytes    uint64        `json:"executedBytes"`
	TokenBurned      string        `json:"tokenBurned"`
	GrossTokenOut    string        `json:"grossTokenOut"`
	NetTokenOut      string        `json:"netTokenOut"`
	RawReceipt       string        `json:"rawReceipt"`
	ReceiptVersion   uint8         `json:"receiptVersion"`
	ReceiptFlags     uint8         `json:"receiptFlags"`
	Events           []EventDetail `json:"events"`
}

type EventDetail struct {
	Index   int      `json:"index"`
	Emitter string   `json:"emitter"`
	Topics  []string `json:"topics"`
	Data    string   `json:"data"`
	Kind    string   `json:"kind"`
}

type TokenRef struct {
	ProgramID common.Hash
	CodeHash  common.Hash
}

type TokenMetadata struct {
	Name       string
	Symbol     string
	Decimals   uint32
	Cap        *big.Int
	MintAmount *big.Int
}

type TokenSummary struct {
	ProgramID       string `json:"programId"`
	CodeHash        string `json:"codeHash"`
	Creator         string `json:"creator"`
	DeploymentBlock uint64 `json:"deploymentBlock"`
	Name            string `json:"name"`
	Symbol          string `json:"symbol"`
	Decimals        uint32 `json:"decimals"`
	Cap             string `json:"cap,omitempty"`
	MintAmount      string `json:"mintAmount,omitempty"`
	TotalSupply     string `json:"totalSupply"`
	HolderCount     uint64 `json:"holderCount"`
	Canonical       bool   `json:"canonical"`
	Finalized       bool   `json:"finalized"`
}

// ContractSummary is the canonical deployment record exposed by the explorer.
// The explorer intentionally treats every deployment as a generic SVM program.
type ContractSummary struct {
	ProgramID       string `json:"programId"`
	CodeHash        string `json:"codeHash"`
	Creator         string `json:"creator"`
	DeploymentBlock uint64 `json:"deploymentBlock"`
	CreationTxHash  string `json:"creationTransactionHash"`
	Canonical       bool   `json:"canonical"`
	Finalized       bool   `json:"finalized"`
	LogIndex        uint   `json:"-"`
}

type ContractDetail struct {
	ContractSummary
	Token *TokenSummary `json:"token,omitempty"`
}

type TokenHolder struct {
	AccountID  string `json:"accountId"`
	EVMAddress string `json:"evmAddress,omitempty"`
	Balance    string `json:"balance"`
}

type AddressBalance struct {
	ProgramID   string `json:"programId"`
	Name        string `json:"name"`
	Symbol      string `json:"symbol"`
	Decimals    uint32 `json:"decimals"`
	Balance     string `json:"balance"`
	TotalSupply string `json:"totalSupply"`
}

type TransactionSummary struct {
	Hash            string `json:"hash"`
	BlockNumber     uint64 `json:"blockNumber"`
	BlockTime       string `json:"blockTime"`
	ExecutionHeight uint64 `json:"executionHeight"`
	Actor           string `json:"actor"`
	RootTarget      string `json:"rootTarget"`
	ExecutedBytes   uint64 `json:"executedBytes"`
	Canonical       bool   `json:"canonical"`
	Finalized       bool   `json:"finalized"`
	LogIndex        uint   `json:"-"`
	ExecutionID     int64  `json:"-"`
}

type LatestEvent struct {
	TransactionHash string `json:"transactionHash"`
	BlockNumber     uint64 `json:"blockNumber"`
	BlockTime       string `json:"blockTime"`
	Emitter         string `json:"emitter"`
	Event           string `json:"event"`
}

type TransferDetail struct {
	TransactionHash string `json:"transactionHash"`
	BlockNumber     uint64 `json:"blockNumber"`
	BlockTime       string `json:"blockTime"`
	Sender          string `json:"sender"`
	Recipient       string `json:"recipient"`
	Amount          string `json:"amount"`
	Mint            bool   `json:"mint"`
	Burn            bool   `json:"burn"`
	Finalized       bool   `json:"finalized"`
	ExecutionID     int64  `json:"-"`
	EventIndex      uint   `json:"-"`
}
