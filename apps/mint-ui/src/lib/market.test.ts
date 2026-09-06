import { AbiCoder, id } from "ethers";
import { describe, expect, it } from "vitest";
import {
  decodeMarketOrder,
  encodeMarketAccountAmountPayload,
  MARKET_TOKEN_SCALE,
  quoteOrderPriceWei
} from "./market";

const MAKER = "0x590a77Ec892bB78206bcad2444B62d1bC31A2D03";
const ZERO = "0x0000000000000000000000000000000000000000";
const ACCOUNT = `0x01${"22".repeat(31)}`;
const abi = AbiCoder.defaultAbiCoder();

describe("SRC20 escrow market encoding", () => {
  it("mirrors the contract's fixed 18-decimal quote and uint128 bounds", () => {
    expect(quoteOrderPriceWei(1_000n * MARKET_TOKEN_SCALE, 10_000_000_000_000n)).toBe(10_000_000_000_000_000n);
    expect(() => quoteOrderPriceWei(0n, 1n)).toThrow("amount");
    expect(() => quoteOrderPriceWei(1n, 1n)).toThrow("total");
    expect(() => quoteOrderPriceWei(1n << 128n, MARKET_TOKEN_SCALE)).toThrow("uint128");
  });

  it.each([
    ["approve(bytes32,uint256)", "0x47144421"],
    ["deposit(bytes32,uint256)", "0x1de26e16"],
    ["release(bytes32,uint256)", "0x66afd8ef"]
  ])("encodes %s with the exact selector, account and amount", (signature, selector) => {
    const amount = 250n * MARKET_TOKEN_SCALE;
    const payload = encodeMarketAccountAmountPayload(signature, ACCOUNT, amount);
    expect(payload).toBe(`${id(signature).slice(0, 10)}${abi.encode(["bytes32", "uint256"], [ACCOUNT, amount]).slice(2)}`);
    expect(payload.slice(0, 10)).toBe(selector);
    expect(payload.length).toBe(2 + 4 * 2 + 32 * 2 * 2);
  });

  it("decodes ethers named and nested tuple shapes without confusing side/status enums", () => {
    const named = decodeMarketOrder(7n, {
      side: 1n,
      status: 1n,
      maker: MAKER,
      taker: ZERO,
      amount: 2n,
      unitPriceWei: 3n,
      priceWei: 4n,
      vmEthAmount: 5n,
      expiry: 6n
    });
    expect(named).toMatchObject({ id: 7n, side: "sell", status: "open", maker: MAKER, amount: 2n });

    const nested = decodeMarketOrder(8n, [[MAKER, ZERO, 13n, 0n, 2n, 9n, 10n, 11n, 12n]]);
    expect(nested).toMatchObject({ id: 8n, side: "buy", status: "filled", amount: 9n, expiry: 13n });
    expect(decodeMarketOrder(9n, [MAKER, ZERO, 1n, 2n, 1n, 1n, 1n, 1n, 1n])).toBeNull();
    expect(decodeMarketOrder(10n, [MAKER, ZERO, 1n, 0n, 0n, 1n, 1n, 1n, 1n])).toBeNull();
  });
});
