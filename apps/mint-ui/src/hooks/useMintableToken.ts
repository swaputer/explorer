import { useCallback, useEffect, useMemo, useState } from "react";
import { type BrowserProvider, type ContractTransactionReceipt, type Signer } from "ethers";
import {
  connectWallet,
  friendlyError,
  mintTokens,
  readBalance,
  readTokenSnapshot,
  transferTokens,
  type TokenSnapshot
} from "../lib/swapvm";

export type MintPhase = "idle" | "signing" | "pending" | "confirmed" | "error";
export type TokenOperation = "mint" | "transfer";

export interface Activity {
  readonly operation: TokenOperation;
  readonly hash: string;
  readonly blockNumber: number;
  readonly amount: bigint;
  readonly recipient?: string;
  readonly timestamp: number;
}

export function useMintableToken() {
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [phase, setPhase] = useState<MintPhase>("idle");
  const [operation, setOperation] = useState<TokenOperation>("mint");
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (walletAddress = address) => {
    const nextSnapshot = await readTokenSnapshot();
    setSnapshot(nextSnapshot);
    if (walletAddress) setBalance(await readBalance(walletAddress));
    else setBalance(null);
  }, [address]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    readTokenSnapshot()
      .then((value) => active && setSnapshot(value))
      .catch((cause) => active && setError(friendlyError(cause)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const reload = () => window.location.reload();
    window.ethereum.on("accountsChanged", reload);
    window.ethereum.on("chainChanged", reload);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", reload);
      window.ethereum?.removeListener?.("chainChanged", reload);
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const wallet = await connectWallet();
      setProvider(wallet.provider);
      setSigner(wallet.signer);
      setAddress(wallet.address);
      setBalance(await readBalance(wallet.address));
    } catch (cause) {
      console.error("[mint] connect failed", cause);
      setError(friendlyError(cause));
    }
  }, []);

  const mint = useCallback(async () => {
    if (!signer || !address || !snapshot) return;
    setOperation("mint");
    setError(null);
    setPhase("signing");
    try {
      const receipt: ContractTransactionReceipt = await mintTokens(
        signer,
        address,
        () => setPhase("pending")
      );
      setActivity({
        operation: "mint",
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        amount: snapshot.mintAmount,
        timestamp: Date.now()
      });
      await refresh(address);
      setPhase("confirmed");
    } catch (cause) {
      setError(friendlyError(cause));
      setPhase("error");
    }
  }, [address, refresh, signer, snapshot]);

  const transfer = useCallback(async (recipient: string, amount: bigint) => {
    if (!signer || !address || !snapshot || balance === null) return;
    setOperation("transfer");
    setError(null);
    setPhase("signing");
    try {
      if (amount > balance) throw new Error("Transfer amount exceeds your mSRC20 balance.");
      const receipt: ContractTransactionReceipt = await transferTokens(
        signer,
        address,
        recipient,
        amount,
        () => setPhase("pending")
      );
      setActivity({
        operation: "transfer",
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        amount,
        recipient,
        timestamp: Date.now()
      });
      await refresh(address);
      setPhase("confirmed");
    } catch (cause) {
      console.error("[mint] transfer failed", { recipient, amount: amount.toString() }, cause);
      setError(friendlyError(cause));
      setPhase("error");
    }
  }, [address, balance, refresh, signer, snapshot]);

  const canMint = useMemo(() => {
    if (!snapshot || !address || phase === "signing" || phase === "pending") return false;
    return snapshot.totalSupply + snapshot.mintAmount <= snapshot.cap;
  }, [address, phase, snapshot]);

  return {
    snapshot,
    address,
    balance,
    provider,
    signer,
    phase,
    operation,
    error,
    activity,
    loading,
    canMint,
    connect,
    mint,
    transfer,
    refresh
  };
}
