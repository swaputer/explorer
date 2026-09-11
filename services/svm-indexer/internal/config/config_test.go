package config

import (
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestRPCURLsPreservePriorityAndRemoveDuplicates(t *testing.T) {
	t.Setenv("PRIMARY", "wss://primary.example/ws")
	t.Setenv("FALLBACKS", "wss://secondary.example/ws, wss://primary.example/ws,ws://local.example/ws")

	got, err := rpcURLs("PRIMARY", "FALLBACKS", "ws", "wss")
	if err != nil {
		t.Fatalf("rpc URLs: %v", err)
	}
	want := []string{"wss://primary.example/ws", "wss://secondary.example/ws", "ws://local.example/ws"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestRPCURLsRejectInvalidFallback(t *testing.T) {
	t.Setenv("PRIMARY", "https://primary.example")
	t.Setenv("FALLBACKS", "ftp://secondary.example")
	if _, err := rpcURLs("PRIMARY", "FALLBACKS", "http", "https"); err == nil {
		t.Fatal("expected unsupported fallback scheme to fail")
	}
}

func TestOptionalRPCURLsAllowMissingPrimary(t *testing.T) {
	t.Setenv("PRIMARY", "")
	t.Setenv("FALLBACKS", "https://secondary.example")
	got, err := optionalRPCURLs("PRIMARY", "FALLBACKS", "http", "https")
	if err != nil {
		t.Fatalf("optional rpc URLs: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v want []", got)
	}
}

func TestOpenMintSRC20CodeHashIsExact(t *testing.T) {
	expected := common.HexToHash("0xaedd7bd1543d57afaeb94f6b46e28ba4c1ef7cdd2ad4affca011b17056036869")
	configured := Config{OpenMintSRC20CodeHash: expected}
	if !configured.IsOpenMintSRC20CodeHash(expected) {
		t.Fatal("expected the pinned OpenMint SRC20 package to be accepted")
	}
	if configured.IsOpenMintSRC20CodeHash(common.HexToHash("0xaf15e40fe9fc1181a7143abb413562d69e1ab49a655209ac966204646c85c14b")) {
		t.Fatal("accepted a different SRC20 implementation")
	}
	if (Config{}).IsOpenMintSRC20CodeHash(common.Hash{}) {
		t.Fatal("accepted an unconfigured OpenMint package hash")
	}
}
