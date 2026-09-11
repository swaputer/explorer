package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeActiveReleaseFixture(t *testing.T, transform func(string) string) string {
	t.Helper()
	address := "0x" + strings.Repeat("11", 20)
	hash := "0x" + strings.Repeat("22", 32)
	manifest := fmt.Sprintf(`{
  "schemaVersion":"swaputer-active-release/1",
  "release":{"name":"swaputer-v1.2-rc4","protocolVersion":"1.2"},
  "network":{"chainId":84532},
  "upstream":{"uniswapV4":{
    "poolManager":%[1]q,"positionManager":%[1]q,"permit2":%[1]q,"universalRouter":%[1]q,
    "runtimeCodeHashes":{"poolManager":%[2]q,"positionManager":%[2]q,"permit2":%[2]q,"universalRouter":%[2]q},
    "poolFee":3000,"tickSpacing":60
  }},
  "core":{"worldId":%[2]q,"kernel":%[1]q,"startBlock":1},
  "programs":{"defaultSrc20":{"codeHash":%[2]q},"openMintSrc20CodeHash":%[2]q},
  "indexer":{"confirmations":1,"reorgDepth":1,"backfillBatch":1,"reconcileInterval":"1s"},
  "integrity":{"manifestHash":%[2]q}
}`, address, hash)
	if transform != nil {
		manifest = transform(manifest)
	}
	path := filepath.Join(t.TempDir(), "active-release.json")
	if err := os.WriteFile(path, []byte(manifest), 0o600); err != nil {
		t.Fatalf("write active release fixture: %v", err)
	}
	return path
}

func TestLoadActiveRelease(t *testing.T) {
	t.Setenv("SVM_DEPLOYMENT_MANIFEST", writeActiveReleaseFixture(t, nil))
	release, err := loadActiveRelease()
	if err != nil {
		t.Fatalf("load active release: %v", err)
	}
	if release.Release.Name != "swaputer-v1.2-rc4" {
		t.Fatalf("unexpected release %q", release.Release.Name)
	}
	if release.Upstream.UniswapV4.PoolFee != 3_000 || release.Upstream.UniswapV4.TickSpacing != 60 {
		t.Fatal("unexpected Uniswap v4 pool parameters")
	}
}

func TestUnsupportedUniswapPoolParametersFailClosed(t *testing.T) {
	path := writeActiveReleaseFixture(t, func(manifest string) string {
		return strings.Replace(manifest, `"poolFee":3000`, `"poolFee":500`, 1)
	})
	t.Setenv("SVM_DEPLOYMENT_MANIFEST", path)
	if _, err := loadActiveRelease(); err == nil || !strings.Contains(err.Error(), "pool parameters") {
		t.Fatalf("expected unsupported pool parameters to be rejected, got %v", err)
	}
}

func TestEnvironmentMismatchFailsClosed(t *testing.T) {
	t.Setenv("SVM_KERNEL_ADDRESS", "0x0000000000000000000000000000000000000001")
	if err := requireEnvironmentMatch("SVM_KERNEL_ADDRESS", "0xA751dAFFD61C2d259414573EfCD743cfB24ed10b"); err == nil {
		t.Fatal("expected stale environment binding to be rejected")
	}
}
