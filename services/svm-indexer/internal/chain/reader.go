package chain

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"unicode/utf8"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

type ContractCaller interface {
	CallContract(context.Context, ethereum.CallMsg, *big.Int) ([]byte, error)
}

type TokenMetadata struct {
	Name       string
	Symbol     string
	Decimals   uint32
	Cap        *big.Int
	MintAmount *big.Int
}

type Reader struct {
	client  ContractCaller
	kernel  common.Address
	world   common.Hash
	inputs  abi.Arguments
	outputs abi.Arguments
}

func NewReader(client ContractCaller, kernel common.Address, world common.Hash) (*Reader, error) {
	bytes32Type, err := abi.NewType("bytes32", "", nil)
	if err != nil {
		return nil, err
	}
	bytesType, err := abi.NewType("bytes", "", nil)
	if err != nil {
		return nil, err
	}
	uint32Type, err := abi.NewType("uint32", "", nil)
	if err != nil {
		return nil, err
	}
	return &Reader{
		client: client, kernel: kernel, world: world,
		inputs:  abi.Arguments{{Type: bytes32Type}, {Type: bytes32Type}, {Type: bytesType}, {Type: uint32Type}},
		outputs: abi.Arguments{{Type: bytesType}, {Type: uint32Type}},
	}, nil
}

func (r *Reader) TokenMetadata(ctx context.Context, program common.Hash) (TokenMetadata, error) {
	name, err := r.readText(ctx, program, "name()")
	if err != nil {
		return TokenMetadata{}, fmt.Errorf("read name: %w", err)
	}
	symbol, err := r.readText(ctx, program, "symbol()")
	if err != nil {
		return TokenMetadata{}, fmt.Errorf("read symbol: %w", err)
	}
	decimals, err := r.readUint(ctx, program, "decimals()")
	if err != nil || !decimals.IsUint64() || decimals.Uint64() > 255 {
		return TokenMetadata{}, errors.New("read decimals")
	}
	capValue, _ := r.readUint(ctx, program, "cap()")
	mintAmount, _ := r.readUint(ctx, program, "mintAmount()")
	return TokenMetadata{
		Name: name, Symbol: symbol, Decimals: uint32(decimals.Uint64()), Cap: capValue, MintAmount: mintAmount,
	}, nil
}

// OpenMintTokenMetadata validates the complete read side of the public mint
// ABI. The immutable code hash is checked by the caller; these calls ensure the
// deployed instance also exposes coherent constructor state before it can be
// returned by the minter API.
func (r *Reader) OpenMintTokenMetadata(ctx context.Context, program common.Hash) (TokenMetadata, error) {
	metadata, err := r.TokenMetadata(ctx, program)
	if err != nil {
		return TokenMetadata{}, err
	}
	totalSupply, err := r.readUint(ctx, program, "totalSupply()")
	if err != nil {
		return TokenMetadata{}, fmt.Errorf("read totalSupply: %w", err)
	}
	if err := validateOpenMintTokenMetadata(metadata, totalSupply); err != nil {
		return TokenMetadata{}, err
	}
	return metadata, nil
}

func validateOpenMintTokenMetadata(metadata TokenMetadata, totalSupply *big.Int) error {
	if strings.TrimSpace(metadata.Name) == "" || strings.TrimSpace(metadata.Symbol) == "" {
		return errors.New("OpenMint token metadata is empty")
	}
	if metadata.Decimals != 18 {
		return errors.New("OpenMint token decimals must be 18")
	}
	if metadata.Cap == nil || metadata.MintAmount == nil || totalSupply == nil ||
		metadata.Cap.Sign() <= 0 || metadata.MintAmount.Sign() <= 0 ||
		metadata.MintAmount.Cmp(metadata.Cap) > 0 || totalSupply.Sign() < 0 || totalSupply.Cmp(metadata.Cap) > 0 {
		return errors.New("OpenMint token supply parameters are invalid")
	}
	return nil
}

func (r *Reader) readText(ctx context.Context, program common.Hash, signature string) (string, error) {
	output, err := r.staticCall(ctx, program, signature)
	if err != nil {
		return "", err
	}
	if len(output) != 32 {
		return "", fmt.Errorf("%s returned %d bytes", signature, len(output))
	}
	value := strings.TrimRight(string(output), "\x00")
	if !utf8.ValidString(value) {
		return "", fmt.Errorf("%s returned invalid UTF-8", signature)
	}
	return value, nil
}

func (r *Reader) readUint(ctx context.Context, program common.Hash, signature string) (*big.Int, error) {
	output, err := r.staticCall(ctx, program, signature)
	if err != nil {
		return nil, err
	}
	if len(output) != 32 {
		return nil, fmt.Errorf("%s returned %d bytes", signature, len(output))
	}
	return new(big.Int).SetBytes(output), nil
}

func (r *Reader) staticCall(ctx context.Context, program common.Hash, signature string) ([]byte, error) {
	selector := crypto.Keccak256([]byte(signature))[:4]
	packed, err := r.inputs.Pack(r.world, program, selector, uint32(5_000))
	if err != nil {
		return nil, err
	}
	data := append(crypto.Keccak256([]byte("staticCall(bytes32,bytes32,bytes,uint32)"))[:4], packed...)
	result, err := r.client.CallContract(ctx, ethereum.CallMsg{To: &r.kernel, Data: data}, nil)
	if err != nil {
		return nil, err
	}
	values, err := r.outputs.Unpack(result)
	if err != nil || len(values) != 2 {
		return nil, errors.New("decode Kernel staticCall output")
	}
	output, ok := values[0].([]byte)
	if !ok {
		return nil, errors.New("Kernel staticCall returned an invalid byte payload")
	}
	return output, nil
}
