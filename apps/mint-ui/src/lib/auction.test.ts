import { describe, expect, it } from "vitest";
import { AbiCoder, ZeroAddress, id } from "ethers";
import { decodeAuctionLot, encodeAuctionEscrowPayload } from "./auction";

describe("auction helpers", () => {
  it("decodes the auction house tuple", () => {
    const seller = "0x1000000000000000000000000000000000000001";
    const bidder = "0x2000000000000000000000000000000000000002";
    const lot = decodeAuctionLot(7n, [
      seller,
      bidder,
      2_000_000_000n,
      1n,
      3n,
      10n ** 21n,
      10n ** 15n,
      2n * 10n ** 15n,
      10n ** 12n
    ], 21n * 10n ** 14n);

    expect(lot).toMatchObject({
      id: 7n,
      seller,
      highestBidder: bidder,
      status: "open",
      bidCount: 3n,
      minimumNextBidWei: 21n * 10n ** 14n
    });
  });

  it("rejects unknown statuses", () => {
    expect(decodeAuctionLot(1n, [
      "0x1000000000000000000000000000000000000001",
      ZeroAddress,
      2_000_000_000n,
      9n,
      0n,
      1n,
      1n,
      0n,
      1n
    ], 1n)).toBeNull();
  });

  it("encodes the exact 68-byte escrow payload accepted by the auction house", () => {
    const account = `0x${"ab".repeat(32)}`;
    const payload = encodeAuctionEscrowPayload("release(bytes32,uint256)", account, 42n);
    const expected = `${id("release(bytes32,uint256)").slice(0, 10)}${AbiCoder.defaultAbiCoder()
      .encode(["bytes32", "uint256"], [account, 42n])
      .slice(2)}`;
    expect(payload).toBe(expected);
    expect((payload.length - 2) / 2).toBe(68);
  });
});
