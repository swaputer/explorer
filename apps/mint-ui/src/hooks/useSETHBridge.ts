import { useCallback, useEffect, useMemo, useState } from "react";
import { type Signer } from "ethers";
import {
  configuredSETHVaultAddress,
  depositETH,
  readSETHBridgeSnapshot,
  redeemSETH,
  type BridgeDirection,
  type SETHBridgeSnapshot
} from "../lib/seth";
import { friendlyError } from "../lib/swapvm";

export type BridgePhase = "idle" | "signing" | "pending" | "confirmed" | "error";

export function useSETHBridge(address: string | null, signer: Signer | null) {
  const vaultAddress = useMemo(() => configuredSETHVaultAddress(), []);
  const [snapshot, setSnapshot] = useState<SETHBridgeSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(vaultAddress));
  const [phase, setPhase] = useState<BridgePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!vaultAddress) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSnapshot(await readSETHBridgeSnapshot(address));
      setError(null);
    } catch (cause) {
      console.error("[seth] snapshot failed", cause);
      setError(friendlyError(cause));
    } finally {
      setLoading(false);
    }
  }, [address, vaultAddress]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = useCallback(async (
    direction: BridgeDirection,
    recipient: string,
    amount: bigint,
    vmEthAmount: bigint
  ) => {
    if (!signer || !address) return;
    setPhase("signing");
    setError(null);
    setTransactionHash(null);
    try {
      const run = direction === "deposit" ? depositETH : redeemSETH;
      await run(signer, address, recipient, amount, vmEthAmount, (hash) => {
        setTransactionHash(hash);
        setPhase("pending");
      });
      await refresh();
      setPhase("confirmed");
    } catch (cause) {
      console.error("[seth] bridge transaction failed", { direction, recipient, amount: amount.toString() }, cause);
      setError(friendlyError(cause));
      setPhase("error");
    }
  }, [address, refresh, signer]);

  return { vaultAddress, snapshot, loading, phase, error, transactionHash, refresh, submit };
}
