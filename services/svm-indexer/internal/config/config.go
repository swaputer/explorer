package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/joho/godotenv"
)

type Config struct {
	ChainID               uint64
	RPCWSURLs             []string
	RPCHTTPURLs           []string
	RPCRequestTimeout     time.Duration
	ReadinessMaxLag       uint64
	DatabaseURL           string
	KernelAddress         common.Address
	WorldID               common.Hash
	TokenCodeHashes       map[common.Hash]struct{}
	OpenMintSRC20CodeHash common.Hash
	StartBlock            uint64
	Confirmations         uint64
	ReorgDepth            uint64
	BackfillBatch         uint64
	ReconcileInterval     time.Duration
	HTTPAddr              string
	AllowedOrigins        []string
}

func Load() (Config, error) {
	loadLocalEnvironment()
	release, err := loadActiveRelease()
	if err != nil {
		return Config{}, err
	}

	chainID, err := uintValue("SVM_CHAIN_ID", release.Network.ChainID)
	if err != nil || chainID != release.Network.ChainID {
		return Config{}, valueError("SVM_CHAIN_ID", err)
	}
	startBlock, err := uintValue("SVM_START_BLOCK", release.Core.StartBlock)
	if err != nil || startBlock != release.Core.StartBlock {
		return Config{}, valueError("SVM_START_BLOCK", err)
	}
	confirmations, err := uintValue("SVM_CONFIRMATIONS", release.Indexer.Confirmations)
	if err != nil || confirmations != release.Indexer.Confirmations {
		return Config{}, valueError("SVM_CONFIRMATIONS", err)
	}
	reorgDepth, err := uintValue("SVM_REORG_DEPTH", release.Indexer.ReorgDepth)
	if err != nil || reorgDepth != release.Indexer.ReorgDepth {
		return Config{}, valueError("SVM_REORG_DEPTH", err)
	}
	batch, err := uintValue("SVM_BACKFILL_BATCH", release.Indexer.BackfillBatch)
	if err != nil || batch != release.Indexer.BackfillBatch || batch > 10_000 {
		return Config{}, valueError("SVM_BACKFILL_BATCH", err)
	}
	manifestReconcile, err := time.ParseDuration(release.Indexer.ReconcileInterval)
	if err != nil {
		return Config{}, errors.New("active deployment manifest reconcile interval is invalid")
	}
	reconcile, err := durationValue("SVM_RECONCILE_INTERVAL", manifestReconcile)
	if err != nil || reconcile != manifestReconcile || reconcile < time.Second {
		return Config{}, valueError("SVM_RECONCILE_INTERVAL", err)
	}

	wsURLs, err := optionalRPCURLs("SVM_RPC_WS_URL", "SVM_RPC_WS_FALLBACK_URLS", "ws", "wss")
	if err != nil {
		return Config{}, err
	}
	httpURLs, err := rpcURLs("SVM_RPC_HTTP_URL", "SVM_RPC_HTTP_FALLBACK_URLS", "http", "https")
	if err != nil {
		return Config{}, err
	}
	rpcTimeout, err := durationValue("SVM_RPC_REQUEST_TIMEOUT", 30*time.Second)
	if err != nil || rpcTimeout < time.Second {
		return Config{}, valueError("SVM_RPC_REQUEST_TIMEOUT", err)
	}
	readinessMaxLag, err := uintValue("SVM_READINESS_MAX_LAG", max(confirmations, 12))
	if err != nil || readinessMaxLag > 10_000 {
		return Config{}, valueError("SVM_READINESS_MAX_LAG", err)
	}
	databaseURL := strings.TrimSpace(os.Getenv("SVM_DATABASE_URL"))
	if databaseURL == "" {
		return Config{}, errors.New("SVM_DATABASE_URL is required")
	}
	kernelText := release.Core.Kernel
	for name, expected := range map[string]string{
		"SVM_KERNEL_ADDRESS": kernelText,
		"SVM_WORLD_ID":       release.Core.WorldID,
	} {
		if err := requireEnvironmentMatch(name, expected); err != nil {
			return Config{}, err
		}
	}
	worldText := release.Core.WorldID
	worldBytes, worldErr := hexutil.Decode(worldText)
	if worldErr != nil || len(worldBytes) != common.HashLength || common.BytesToHash(worldBytes) == (common.Hash{}) {
		return Config{}, errors.New("SVM_WORLD_ID must be a nonzero bytes32 value")
	}

	allowedOrigins := splitCSV(os.Getenv("SVM_ALLOWED_ORIGINS"))
	if len(allowedOrigins) == 0 {
		return Config{}, errors.New("SVM_ALLOWED_ORIGINS must contain at least one origin")
	}
	tokenHashTexts := []string{
		release.Programs.DefaultSRC20.CodeHash,
		release.Programs.OpenMintSRC20CodeHash,
	}
	if err := requireEnvironmentListMatch("SVM_TOKEN_CODE_HASHES", tokenHashTexts); err != nil {
		return Config{}, err
	}
	tokenCodeHashes := make(map[common.Hash]struct{}, len(tokenHashTexts))
	for _, value := range tokenHashTexts {
		tokenCodeHashes[common.HexToHash(value)] = struct{}{}
	}

	return Config{
		ChainID:               chainID,
		RPCWSURLs:             wsURLs,
		RPCHTTPURLs:           httpURLs,
		RPCRequestTimeout:     rpcTimeout,
		ReadinessMaxLag:       readinessMaxLag,
		DatabaseURL:           databaseURL,
		KernelAddress:         common.HexToAddress(kernelText),
		WorldID:               common.BytesToHash(worldBytes),
		TokenCodeHashes:       tokenCodeHashes,
		OpenMintSRC20CodeHash: common.HexToHash(release.Programs.OpenMintSRC20CodeHash),
		StartBlock:            startBlock,
		Confirmations:         confirmations,
		ReorgDepth:            reorgDepth,
		BackfillBatch:         batch,
		ReconcileInterval:     reconcile,
		HTTPAddr:              stringValue("SVM_HTTP_ADDR", "127.0.0.1:8080"),
		AllowedOrigins:        allowedOrigins,
	}, nil
}

func addressList(name string) ([]common.Address, error) {
	values := splitCSV(os.Getenv(name))
	result := make([]common.Address, 0, len(values))
	for _, value := range values {
		if !common.IsHexAddress(value) {
			return nil, fmt.Errorf("%s contains an invalid address", name)
		}
		result = append(result, common.HexToAddress(value))
	}
	return result, nil
}

func (c Config) IsTokenCodeHash(value common.Hash) bool {
	_, exists := c.TokenCodeHashes[value]
	return exists
}

// IsOpenMintSRC20CodeHash is the trust boundary for the public minter. A
// contract is offered for minting only when its immutable package hash matches
// the OpenMint SRC20 implementation pinned by the active release.
func (c Config) IsOpenMintSRC20CodeHash(value common.Hash) bool {
	return value == c.OpenMintSRC20CodeHash && value != (common.Hash{})
}

func loadLocalEnvironment() {
	for _, path := range []string{".env.local", "services/svm-indexer/.env.local"} {
		if _, err := os.Stat(path); err == nil {
			_ = godotenv.Load(path)
		}
	}
}

func rpcURLs(primaryName, fallbackName string, schemes ...string) ([]string, error) {
	primary := strings.TrimSpace(os.Getenv(primaryName))
	if primary == "" {
		return nil, fmt.Errorf("%s is required", primaryName)
	}
	values := append([]string{primary}, splitCSV(os.Getenv(fallbackName))...)
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Host == "" {
			return nil, fmt.Errorf("%s contains an invalid URL", primaryName)
		}
		supported := false
		for _, scheme := range schemes {
			if parsed.Scheme == scheme {
				supported = true
				break
			}
		}
		if !supported {
			return nil, fmt.Errorf("%s contains an unsupported URL scheme", primaryName)
		}
		if _, exists := seen[raw]; exists {
			continue
		}
		seen[raw] = struct{}{}
		result = append(result, raw)
	}
	return result, nil
}

func optionalRPCURLs(primaryName, fallbackName string, schemes ...string) ([]string, error) {
	primary := strings.TrimSpace(os.Getenv(primaryName))
	if primary == "" {
		return []string{}, nil
	}
	return rpcURLs(primaryName, fallbackName, schemes...)
}

func uintValue(name string, fallback uint64) (uint64, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	return strconv.ParseUint(raw, 10, 64)
}

func durationValue(name string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	return time.ParseDuration(raw)
}

func stringValue(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func splitCSV(raw string) []string {
	values := make([]string, 0)
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}

func hashSet(name string) (map[common.Hash]struct{}, error) {
	result := make(map[common.Hash]struct{})
	for _, value := range splitCSV(os.Getenv(name)) {
		decoded, err := hexutil.Decode(value)
		if err != nil || len(decoded) != common.HashLength {
			return nil, fmt.Errorf("contains an invalid bytes32 value")
		}
		result[common.BytesToHash(decoded)] = struct{}{}
	}
	return result, nil
}

func valueError(name string, cause error) error {
	if cause == nil {
		return fmt.Errorf("%s is outside the supported range", name)
	}
	return fmt.Errorf("%s is invalid: %w", name, cause)
}
