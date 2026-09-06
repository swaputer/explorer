import { AbiCoder, getAddress, id } from "ethers";
import { describe, expect, it } from "vitest";
import activeRelease from "../../../../deployments/active/base-sepolia.json";
import {
  configuredSETHVaultAddress,
  encodeBridgeBurnPayload,
  encodeBridgeMintPayload,
  validateBridgeAmount
} from "./seth";

const ACCOUNT = `0x01${"42".repeat(31)}`;
const abi = AbiCoder.defaultAbiCoder();

describe("sETH atomic bridge encoding", () => {
  it("selects the pinned Base Sepolia Vault binding", () => {
    expect(configuredSETHVaultAddress()).toBe(getAddress(activeRelease.applications.sethVault));
  });

  it("encodes the exact bridgeMint selector, recipient AccountId and amount", () => {
    const amount = 25n * 10n ** 18n;
    const payload = encodeBridgeMintPayload(ACCOUNT, amount);
    expect(payload.slice(0, 10)).toBe("0x59acdeeb");
    expect(payload).toBe(`${id("bridgeMint(bytes32,uint256)").slice(0, 10)}${abi
      .encode(["bytes32", "uint256"], [ACCOUNT, amount])
      .slice(2)}`);
    expect(payload.length).toBe(2 + 4 * 2 + 32 * 2 * 2);
  });

  it("encodes bridgeBurn with amount only so the program burns signed tx.actor", () => {
    const amount = 7n;
    const payload = encodeBridgeBurnPayload(amount);
    expect(payload.slice(0, 10)).toBe("0xdcc67de9");
    expect(payload).toBe(`${id("bridgeBurn(uint256)").slice(0, 10)}${abi.encode(["uint256"], [amount]).slice(2)}`);
    expect(payload.length).toBe(2 + 4 * 2 + 32 * 2);
  });

  it("rejects zero and uint128-overflow bridge values before wallet signing", () => {
    expect(() => validateBridgeAmount(0n, 1n)).toThrow("amount");
    expect(() => validateBridgeAmount(1n, 0n)).toThrow("budget");
    expect(() => validateBridgeAmount(1n << 128n, 1n)).toThrow("uint128");
    expect(() => validateBridgeAmount(1n, 1n << 128n)).toThrow("uint128");
    expect(() => validateBridgeAmount(1n, 1n)).not.toThrow();
  });
});
