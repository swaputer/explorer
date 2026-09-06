import { useCallback, useEffect, useMemo, useState } from "react";
import { type Signer } from "ethers";
import {
  cancelOrder,
  configuredMarketAddress,
  createOrder,
  readOrders,
  settleOrder,
  type CreateOrderInput,
  type MarketOrder
} from "../lib/market";
import { friendlyError } from "../lib/swapvm";

export type MarketPhase = "idle" | "signing" | "pending" | "confirmed" | "error";

export function useSRC20Market(
  address: string | null,
  signer: Signer | null,
  refreshToken: (address?: string | null) => Promise<void>
) {
  const marketAddress = useMemo(() => configuredMarketAddress(), []);
  const [orders, setOrders] = useState<readonly MarketOrder[]>([]);
  const [loading, setLoading] = useState(Boolean(marketAddress));
  const [phase, setPhase] = useState<MarketPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!marketAddress) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setOrders(await readOrders());
      setError(null);
    } catch (cause) {
      console.error("[market] readOrders failed", cause);
      setError(friendlyError(cause));
    } finally {
      setLoading(false);
    }
  }, [marketAddress]);

  useEffect(() => { void refresh(); }, [refresh]);

  const transact = useCallback(async (orderId: bigint | null, action: () => Promise<unknown>) => {
    setActiveOrderId(orderId);
    setPhase("signing");
    setError(null);
    try {
      const promise = action();
      setPhase("pending");
      await promise;
      await Promise.all([refresh(), refreshToken(address)]);
      setPhase("confirmed");
    } catch (cause) {
      console.error("[market] transaction failed", cause);
      setError(friendlyError(cause));
      setPhase("error");
    } finally {
      setActiveOrderId(null);
    }
  }, [address, refresh, refreshToken]);

  const create = useCallback(async (input: CreateOrderInput) => {
    if (!signer) return;
    await transact(null, () => createOrder(signer, input));
  }, [signer, transact]);

  const actOnOrder = useCallback(async (order: MarketOrder) => {
    if (!signer || !address) return;
    const current = address.toLowerCase();
    const maker = order.maker.toLowerCase();
    if (order.status === "open" && current === maker) {
      await transact(order.id, () => cancelOrder(signer, order));
      return;
    }
    if (order.status === "open") {
      await transact(order.id, () => settleOrder(signer, address, order));
    }
  }, [address, signer, transact]);

  return {
    marketAddress,
    orders,
    loading,
    phase,
    error,
    activeOrderId,
    refresh,
    create,
    actOnOrder
  };
}
