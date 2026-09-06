import { useCallback, useEffect, useState } from "react";
import type { Signer } from "ethers";
import {
  bidOnAuction,
  cancelAuction,
  createAuction,
  readAuctionState,
  settleAuction,
  withdrawAuctionEth,
  type AuctionLot,
  type AuctionState,
  type CreateAuctionInput
} from "../lib/auction";
import { friendlyError } from "../lib/swapvm";

export type AuctionPhase = "idle" | "signing" | "pending" | "confirmed" | "error";

const EMPTY_STATE: AuctionState = {
  factoryAddress: null,
  auctionHouseAddress: null,
  escrowId: null,
  lots: [],
  claimableEth: 0n
};

export function useSRC20Auction(
  address: string | null,
  signer: Signer | null,
  refreshToken: (address?: string | null) => Promise<void>
) {
  const [state, setState] = useState<AuctionState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<AuctionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeAuctionId, setActiveAuctionId] = useState<bigint | null>(null);
  const [operation, setOperation] = useState<"create" | "bid" | "settle" | "cancel" | "withdraw" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await readAuctionState(address));
      setError(null);
    } catch (cause) {
      console.error("[auction] state refresh failed", cause);
      setError(friendlyError(cause));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  const transact = useCallback(async (
    nextOperation: NonNullable<typeof operation>,
    auctionId: bigint | null,
    action: () => Promise<unknown>
  ) => {
    setOperation(nextOperation);
    setActiveAuctionId(auctionId);
    setPhase("signing");
    setError(null);
    try {
      const pending = action();
      setPhase("pending");
      await pending;
      await Promise.all([refresh(), refreshToken(address)]);
      setPhase("confirmed");
    } catch (cause) {
      console.error(`[auction] ${nextOperation} failed`, cause);
      setError(friendlyError(cause));
      setPhase("error");
    } finally {
      setActiveAuctionId(null);
      setOperation(null);
    }
  }, [address, refresh, refreshToken]);

  const create = useCallback(async (input: CreateAuctionInput) => {
    if (!signer) return;
    await transact("create", null, () => createAuction(signer, input));
  }, [signer, transact]);

  const bid = useCallback(async (lot: AuctionLot, amountWei: bigint) => {
    if (!signer) return;
    await transact("bid", lot.id, () => bidOnAuction(signer, lot, amountWei));
  }, [signer, transact]);

  const settle = useCallback(async (lot: AuctionLot) => {
    if (!signer) return;
    await transact("settle", lot.id, () => settleAuction(signer, lot));
  }, [signer, transact]);

  const cancel = useCallback(async (lot: AuctionLot) => {
    if (!signer) return;
    await transact("cancel", lot.id, () => cancelAuction(signer, lot));
  }, [signer, transact]);

  const withdraw = useCallback(async () => {
    if (!signer) return;
    await transact("withdraw", null, () => withdrawAuctionEth(signer));
  }, [signer, transact]);

  return {
    ...state,
    loading,
    phase,
    error,
    activeAuctionId,
    operation,
    refresh,
    create,
    bid,
    settle,
    cancel,
    withdraw
  };
}
