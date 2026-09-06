import { TypedDataEncoder, concat, getBytes, hexlify, keccak256, toBeHex } from "ethers";
import { describe, expect, it } from "vitest";
import { BASE_SEPOLIA, SWAPVM } from "../config";
import {
  buildDeployAction,
  buildDeployPayload,
  inspectSvmPackage,
  normalizeConstructorArgs
} from "./deployer";
import { VM_ACTION_TYPES } from "./swapvm";

const ACTOR = "0x590a77Ec892bB78206bcad2444B62d1bC31A2D03";

function packageBytes(code = "0x00"): Uint8Array {
  const codeBytes = getBytes(code);
  return getBytes(concat([
    "0x53564d31",
    "0x0001",
    "0x0000",
    "0x0000",
    toBeHex(codeBytes.length, 2),
    `0x${"11".repeat(32)}`,
    codeBytes
  ]));
}

describe("Mini contract deployment encoding", () => {
  it("inspects the frozen SVM1 package header and hashes the complete package", () => {
    const bytes = packageBytes("0x0001");
    const inspected = inspectSvmPackage(bytes);
    expect(inspected.packageLength).toBe(46);
    expect(inspected.codeLength).toBe(2);
    expect(inspected.constructorEntry).toBe(0);
    expect(inspected.runtimeEntry).toBe(0);
    expect(inspected.abiHash).toBe(`0x${"11".repeat(32)}`);
    expect(inspected.codeHash).toBe(keccak256(bytes));
  });

  it("prefixes the package with an exact big-endian uint32 and appends constructor bytes", () => {
    const bytes = packageBytes();
    const payload = buildDeployPayload(bytes, "0x1234");
    expect(payload).toBe(hexlify(concat([toBeHex(bytes.length, 4), bytes, "0x1234"])));
    expect(payload.slice(0, 10)).toBe("0x0000002d");
  });

  it("normalizes constructor hex and rejects malformed bytes", () => {
    expect(normalizeConstructorArgs(" 0xAA bb ")).toBe("0xaabb");
    expect(normalizeConstructorArgs(" ")).toBe("0x");
    expect(() => normalizeConstructorArgs("0xabc")).toThrow(/complete bytes/);
    expect(() => normalizeConstructorArgs("0xzz")).toThrow(/hexadecimal/);
  });

  it("builds a v1.2 DEPLOY action bound to package hash, Router and exact VM input", () => {
    const bytes = packageBytes();
    const payload = buildDeployPayload(bytes);
    const action = buildDeployAction(ACTOR, keccak256(bytes), payload, 7n, 2_000_000_000n, 20_000, 1_000_000_000_000n);
    const digest = TypedDataEncoder.hash({
      name: "Swaputer",
      version: SWAPVM.protocolVersion,
      chainId: BASE_SEPOLIA.chainId,
      verifyingContract: SWAPVM.kernel,
      salt: SWAPVM.worldId
    }, VM_ACTION_TYPES, action);

    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(action.op).toBe(1);
    expect(action.targetOrCodeHash).toBe(keccak256(bytes));
    expect(action.payloadHash).toBe(keccak256(payload));
    expect(action.authorizedExecutor).toBe(ACTOR);
    expect(action.exactEthAmountIn).toBe(1_000_000_000_000n);
  });

  it("rejects invalid magic, mismatched code length and out-of-range entries", () => {
    const invalidMagic = packageBytes();
    invalidMagic[0] = 0;
    expect(() => inspectSvmPackage(invalidMagic)).toThrow(/magic/);

    const invalidLength = packageBytes();
    invalidLength[11] = 2;
    expect(() => inspectSvmPackage(invalidLength)).toThrow(/length mismatch/);

    const invalidEntry = packageBytes();
    invalidEntry[7] = 1;
    expect(() => inspectSvmPackage(invalidEntry)).toThrow(/entrypoint/);
  });
});
