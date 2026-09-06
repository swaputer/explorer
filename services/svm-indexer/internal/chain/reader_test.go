package chain

import (
	"math/big"
	"testing"
)

func TestValidateOpenMintTokenMetadata(t *testing.T) {
	valid := TokenMetadata{
		Name: "Swaputer", Symbol: "SWP", Decimals: 18,
		Cap: big.NewInt(1_000), MintAmount: big.NewInt(10),
	}
	if err := validateOpenMintTokenMetadata(valid, big.NewInt(500)); err != nil {
		t.Fatalf("valid OpenMint metadata was rejected: %v", err)
	}

	tests := []struct {
		name     string
		metadata TokenMetadata
		supply   *big.Int
	}{
		{name: "empty name", metadata: TokenMetadata{Name: "", Symbol: "SWP", Decimals: 18, Cap: big.NewInt(1_000), MintAmount: big.NewInt(10)}, supply: big.NewInt(0)},
		{name: "wrong decimals", metadata: TokenMetadata{Name: "Swaputer", Symbol: "SWP", Decimals: 8, Cap: big.NewInt(1_000), MintAmount: big.NewInt(10)}, supply: big.NewInt(0)},
		{name: "missing cap", metadata: TokenMetadata{Name: "Swaputer", Symbol: "SWP", Decimals: 18, MintAmount: big.NewInt(10)}, supply: big.NewInt(0)},
		{name: "zero mint", metadata: TokenMetadata{Name: "Swaputer", Symbol: "SWP", Decimals: 18, Cap: big.NewInt(1_000), MintAmount: big.NewInt(0)}, supply: big.NewInt(0)},
		{name: "mint above cap", metadata: TokenMetadata{Name: "Swaputer", Symbol: "SWP", Decimals: 18, Cap: big.NewInt(10), MintAmount: big.NewInt(11)}, supply: big.NewInt(0)},
		{name: "supply above cap", metadata: valid, supply: big.NewInt(1_001)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateOpenMintTokenMetadata(test.metadata, test.supply); err == nil {
				t.Fatal("invalid OpenMint metadata was accepted")
			}
		})
	}
}
