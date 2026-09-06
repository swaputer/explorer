import { AbiCoder, TypedDataEncoder, concat, id, keccak256 } from "ethers";
import { describe, expect, it } from "vitest";
import { BASE_SEPOLIA, SWAPVM } from "../config";
import {
  buildMintAction,
  buildMintPayload,
  buildCallAction,
  buildTransferAction,
  buildTransferPayload,
  VM_ACTION_TYPES
} from "./swapvm";

const ACTOR = "0x590a77Ec892bB78206bcad2444B62d1bC31A2D03";
const ACTOR_ID = "0x000000000000000000000000590a77ec892bb78206bcad2444b62d1bc31a2d03";
const abi = AbiCoder.defaultAbiCoder();

describe("current Swaputer mint action", () => {
  it("encodes the deployed mint(bytes32) selector and one AccountId word", () => {
    const payload = buildMintPayload(ACTOR_ID);
    expect(payload.slice(0, 10)).toBe("0xadf2cead");
    expect(payload.length).toBe(2 + 4 * 2 + 32 * 2);
    expect(payload.slice(10)).toBe(ACTOR_ID.slice(2));
  });

  it("matches the Solidity v1.2 EIP-712 digest byte-for-byte", () => {
    const { payload, typedAction } = buildMintAction(ACTOR, ACTOR_ID, 9n, 2_000_000_000n);
    const domain = {
      name: "Swaputer",
      version: SWAPVM.protocolVersion,
      chainId: BASE_SEPOLIA.chainId,
      verifyingContract: SWAPVM.kernel,
      salt: SWAPVM.worldId
    };
    const ethersDigest = TypedDataEncoder.hash(domain, VM_ACTION_TYPES, typedAction);
    const domainSeparator = keccak256(abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address", "bytes32"],
      [
        id("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"),
        id("Swaputer"),
        id(SWAPVM.protocolVersion),
        BASE_SEPOLIA.chainId,
        SWAPVM.kernel,
        SWAPVM.worldId
      ]
    ));
    const structHash = keccak256(abi.encode(
      [
        "bytes32", "uint8", "bytes32", "address", "bytes32", "bytes32", "uint32", "uint128",
        "uint128", "uint160", "address", "address", "address", "uint64", "uint64"
      ],
      [
        id("VMAction(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes32 payloadHash,uint32 byteGasLimit,uint128 minNetTokenOut,uint128 exactEthAmountIn,uint160 sqrtPriceLimitX96,address recipient,address router,address authorizedExecutor,uint64 nonce,uint64 deadline)"),
        typedAction.op,
        typedAction.worldId,
        typedAction.actor,
        typedAction.targetOrCodeHash,
        keccak256(payload),
        typedAction.byteGasLimit,
        typedAction.minNetTokenOut,
        typedAction.exactEthAmountIn,
        typedAction.sqrtPriceLimitX96,
        typedAction.recipient,
        typedAction.router,
        typedAction.authorizedExecutor,
        typedAction.nonce,
        typedAction.deadline
      ]
    ));
    expect(ethersDigest).toBe(keccak256(concat(["0x1901", domainSeparator, structHash])));
    expect(typedAction.op).toBe(2);
    expect(typedAction.byteGasLimit).toBe(SWAPVM.mintByteGasLimit);
    expect(typedAction.exactEthAmountIn).toBe(1_000_000_000_000n);
    expect(typedAction.router).toBe(SWAPVM.router);
  });

  it("encodes transfer(bytes32,uint256) with the frozen selector and exact ABI words", () => {
    const recipientId = `0x01${"00".repeat(30)}42`;
    const amount = 250n * 10n ** 18n;
    const payload = buildTransferPayload(recipientId, amount);
    const expected = `${id("transfer(bytes32,uint256)").slice(0, 10)}${abi
      .encode(["bytes32", "uint256"], [recipientId, amount])
      .slice(2)}`;

    expect(payload).toBe(expected);
    expect(payload.slice(0, 10)).toBe("0x6a467394");
    expect(payload.length).toBe(2 + 4 * 2 + 32 * 2 * 2);

    const action = buildTransferAction(ACTOR, recipientId, amount, 7n, 99n);
    expect(action.typedAction.byteGasLimit).toBe(SWAPVM.transferByteGasLimit);
    expect(action.typedAction.payloadHash).toBe(keccak256(payload));
  });

  it("binds a market transfer to the buyer, market executor, and escrowed VM input", () => {
    const recipient = "0x00000000000000000000000000000000000000b0";
    const market = "0x00000000000000000000000000000000000000A1";
    const payload = buildTransferPayload(ACTOR_ID, 1_000n * 10n ** 18n);
    const marketAction = buildCallAction(ACTOR, payload, 8n, 100n, SWAPVM.transferByteGasLimit, {
      recipient,
      authorizedExecutor: market,
      exactEthAmountIn: 2_000_000_000_000_000n
    });

    expect(marketAction.typedAction.recipient).toBe(recipient);
    expect(marketAction.typedAction.authorizedExecutor).toBe(market);
    expect(marketAction.typedAction.exactEthAmountIn).toBe(2_000_000_000_000_000n);
    expect(marketAction.typedAction.router).toBe(SWAPVM.router);
  });
});
