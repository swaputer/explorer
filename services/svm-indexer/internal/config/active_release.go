package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
)

type activeRelease struct {
	SchemaVersion string `json:"schemaVersion"`
	Release       struct {
		Name            string `json:"name"`
		ProtocolVersion string `json:"protocolVersion"`
	} `json:"release"`
	Network struct {
		ChainID uint64 `json:"chainId"`
	} `json:"network"`
	Upstream struct {
		UniswapV4 struct {
			PoolManager       string `json:"poolManager"`
			PositionManager   string `json:"positionManager"`
			Permit2           string `json:"permit2"`
			UniversalRouter   string `json:"universalRouter"`
			RuntimeCodeHashes struct {
				PoolManager     string `json:"poolManager"`
				PositionManager string `json:"positionManager"`
				Permit2         string `json:"permit2"`
				UniversalRouter string `json:"universalRouter"`
			} `json:"runtimeCodeHashes"`
			PoolFee     uint64 `json:"poolFee"`
			TickSpacing int64  `json:"tickSpacing"`
		} `json:"uniswapV4"`
	} `json:"upstream"`
	Core struct {
		WorldID    string `json:"worldId"`
		Kernel     string `json:"kernel"`
		StartBlock uint64 `json:"startBlock"`
	} `json:"core"`
	Programs struct {
		DefaultSRC20 struct {
			CodeHash string `json:"codeHash"`
		} `json:"defaultSrc20"`
		OpenMintSRC20CodeHash string `json:"openMintSrc20CodeHash"`
		SETH                  struct {
			CodeHash string `json:"codeHash"`
		} `json:"seth"`
	} `json:"programs"`
	Applications struct {
		MarketFactory   string `json:"marketFactory"`
		ReferenceMarket string `json:"referenceMarket"`
		AuctionExample  *struct {
			Factory        string `json:"factory"`
			EscrowCodeHash string `json:"escrowCodeHash"`
			Indexed        bool   `json:"indexed"`
		} `json:"auctionExample,omitempty"`
	} `json:"applications"`
	Indexer struct {
		Confirmations     uint64 `json:"confirmations"`
		ReorgDepth        uint64 `json:"reorgDepth"`
		BackfillBatch     uint64 `json:"backfillBatch"`
		ReconcileInterval string `json:"reconcileInterval"`
	} `json:"indexer"`
	Integrity struct {
		ManifestHash string `json:"manifestHash"`
	} `json:"integrity"`
}

func loadActiveRelease() (activeRelease, error) {
	configured := strings.TrimSpace(os.Getenv("SVM_DEPLOYMENT_MANIFEST"))
	candidates := []string{}
	if configured != "" {
		candidates = append(candidates, configured)
		if !filepath.IsAbs(configured) {
			candidates = append(candidates, filepath.Join("../..", configured))
		}
	} else {
		candidate, err := findUp("deployments/active/base-sepolia.json")
		if err != nil {
			return activeRelease{}, err
		}
		candidates = append(candidates, candidate)
	}

	var data []byte
	var selected string
	for _, candidate := range candidates {
		value, err := os.ReadFile(candidate)
		if err == nil {
			data = value
			selected = candidate
			break
		}
		if !errors.Is(err, os.ErrNotExist) {
			return activeRelease{}, fmt.Errorf("read active deployment manifest: %w", err)
		}
	}
	if selected == "" {
		return activeRelease{}, errors.New("active deployment manifest was not found")
	}

	var release activeRelease
	if err := json.Unmarshal(data, &release); err != nil {
		return activeRelease{}, errors.New("active deployment manifest is invalid JSON")
	}
	if release.SchemaVersion != "swaputer-active-release/1" || release.Release.Name != "swaputer-v1.2-rc4" || release.Release.ProtocolVersion != "1.2" {
		return activeRelease{}, errors.New("active deployment manifest release is unsupported")
	}
	if release.Network.ChainID == 0 || release.Core.StartBlock == 0 || release.Indexer.Confirmations == 0 || release.Indexer.ReorgDepth == 0 || release.Indexer.BackfillBatch == 0 {
		return activeRelease{}, errors.New("active deployment manifest contains invalid numeric configuration")
	}
	addresses := []string{
		release.Core.Kernel,
		release.Applications.MarketFactory,
		release.Applications.ReferenceMarket,
		release.Upstream.UniswapV4.PoolManager,
		release.Upstream.UniswapV4.PositionManager,
		release.Upstream.UniswapV4.Permit2,
		release.Upstream.UniswapV4.UniversalRouter,
	}
	for _, value := range addresses {
		if !common.IsHexAddress(value) || common.HexToAddress(value) == (common.Address{}) {
			return activeRelease{}, errors.New("active deployment manifest contains an invalid address")
		}
	}
	if release.Upstream.UniswapV4.PoolFee != 3_000 || release.Upstream.UniswapV4.TickSpacing != 60 {
		return activeRelease{}, errors.New("active deployment manifest contains unsupported Uniswap v4 pool parameters")
	}
	if release.Applications.AuctionExample != nil {
		auction := release.Applications.AuctionExample
		if !common.IsHexAddress(auction.Factory) || common.HexToAddress(auction.Factory) == (common.Address{}) {
			return activeRelease{}, errors.New("active deployment manifest contains an invalid auction example address")
		}
		decoded, err := hexutil.Decode(auction.EscrowCodeHash)
		if err != nil || len(decoded) != common.HashLength || common.BytesToHash(decoded) == (common.Hash{}) {
			return activeRelease{}, errors.New("active deployment manifest contains an invalid auction example hash")
		}
		if auction.Indexed {
			return activeRelease{}, errors.New("auction example must not be indexed")
		}
	}
	for _, value := range []string{
		release.Upstream.UniswapV4.RuntimeCodeHashes.PoolManager,
		release.Upstream.UniswapV4.RuntimeCodeHashes.PositionManager,
		release.Upstream.UniswapV4.RuntimeCodeHashes.Permit2,
		release.Upstream.UniswapV4.RuntimeCodeHashes.UniversalRouter,
	} {
		decoded, err := hexutil.Decode(value)
		if err != nil || len(decoded) != common.HashLength || common.BytesToHash(decoded) == (common.Hash{}) {
			return activeRelease{}, errors.New("active deployment manifest contains an invalid Uniswap v4 runtime code hash")
		}
	}
	for _, value := range []string{
		release.Core.WorldID,
		release.Programs.DefaultSRC20.CodeHash,
		release.Programs.OpenMintSRC20CodeHash,
		release.Programs.SETH.CodeHash,
		release.Integrity.ManifestHash,
	} {
		decoded, err := hexutil.Decode(value)
		if err != nil || len(decoded) != common.HashLength || common.BytesToHash(decoded) == (common.Hash{}) {
			return activeRelease{}, errors.New("active deployment manifest contains an invalid hash")
		}
	}
	return release, nil
}

func findUp(relative string) (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", errors.New("working directory is unavailable")
	}
	for {
		candidate := filepath.Join(directory, relative)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", errors.New("active deployment manifest was not found")
		}
		directory = parent
	}
}

func requireEnvironmentMatch(name, expected string) error {
	configured := strings.TrimSpace(os.Getenv(name))
	if configured != "" && !strings.EqualFold(configured, expected) {
		return fmt.Errorf("%s conflicts with the active deployment manifest", name)
	}
	return nil
}

func requireEnvironmentListMatch(name string, expected []string) error {
	configured := splitCSV(os.Getenv(name))
	if len(configured) == 0 {
		return nil
	}
	if len(configured) != len(expected) {
		return fmt.Errorf("%s conflicts with the active deployment manifest", name)
	}
	for index := range expected {
		if !strings.EqualFold(configured[index], expected[index]) {
			return fmt.Errorf("%s conflicts with the active deployment manifest", name)
		}
	}
	return nil
}
