import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { formatEther, parseEther, parseUnits } from "ethers";
import { SRC20_MARKET } from "../config";
import { formatToken, shortAddress } from "../format";
import type { MarketPhase } from "../hooks/useSRC20Market";
import { quoteOrderPriceWei, type MarketOrder, type OrderSide } from "../lib/market";
import type { TokenSnapshot } from "../lib/swapvm";

const SELL_ASKS_ENABLED = SRC20_MARKET.sellEscrowEnabled;

interface MarketPageProps {
  readonly snapshot: TokenSnapshot | null;
  readonly address: string | null;
  readonly balance: bigint | null;
  readonly marketAddress: string | null;
  readonly orders: readonly MarketOrder[];
  readonly loading: boolean;
  readonly phase: MarketPhase;
  readonly error: string | null;
  readonly activeOrderId: bigint | null;
  readonly onConnect: () => void;
  readonly onRefresh: () => void;
  readonly onCreate: (input: {
    side: OrderSide;
    amount: bigint;
    unitPriceWei: bigint;
    vmEthAmount: bigint;
    expiry: bigint;
  }) => void;
  readonly onOrderAction: (order: MarketOrder) => void;
}

const nowSeconds = () => BigInt(Math.floor(Date.now() / 1_000));

function orderAction(order: MarketOrder, address: string | null): { label: string; enabled: boolean } {
  if (!address) return { label: "Connect wallet", enabled: true };
  const current = address.toLowerCase();
  const maker = order.maker.toLowerCase();
  if (order.status === "filled") return { label: "Filled", enabled: false };
  if (order.status === "cancelled") return { label: "Cancelled", enabled: false };
  if (order.status === "open" && current === maker) return { label: "Cancel order", enabled: true };
  if (order.side === "buy" && order.status === "open") return { label: "Sell into bid", enabled: true };
  if (order.side === "sell" && !SELL_ASKS_ENABLED) return { label: "Escrow unavailable", enabled: false };
  if (order.side === "sell" && order.status === "open") return { label: "Buy from escrow", enabled: true };
  return { label: "Unavailable", enabled: false };
}

function OrderRow({
  order,
  address,
  symbol,
  busy,
  onConnect,
  onAction
}: {
  readonly order: MarketOrder;
  readonly address: string | null;
  readonly symbol: string;
  readonly busy: boolean;
  readonly onConnect: () => void;
  readonly onAction: (order: MarketOrder) => void;
}) {
  const action = orderAction(order, address);
  const expired = order.expiry < nowSeconds();
  const makerCanCancel = Boolean(address && address.toLowerCase() === order.maker.toLowerCase());
  return (
    <div className="market-order" role="row">
      <div className="market-order__side" role="cell">
        <span className={`order-icon order-icon--${order.side}`}>
          {order.side === "buy" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
        </span>
        <div><strong>{order.side === "buy" ? "Buy" : "Sell"}</strong><span>#{order.id.toString()}</span></div>
      </div>
      <div role="cell"><strong>{formatToken(order.amount, 18, 4)}</strong><span>{symbol}</span></div>
      <div role="cell"><strong>{formatEther(order.unitPriceWei)}</strong><span>ETH / token</span></div>
      <div role="cell"><strong>{formatEther(order.priceWei)}</strong><span>ETH total</span></div>
      <div role="cell"><strong>{shortAddress(order.maker, 4)}</strong><span>{expired ? "Expired" : order.status}</span></div>
      <button
        className="order-action"
        type="button"
        disabled={!action.enabled || busy || (expired && !makerCanCancel)}
        onClick={() => address ? onAction(order) : onConnect()}
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : action.label}
      </button>
    </div>
  );
}

export function MarketPage({
  snapshot,
  address,
  balance,
  marketAddress,
  orders,
  loading,
  phase,
  error,
  activeOrderId,
  onConnect,
  onRefresh,
  onCreate,
  onOrderAction
}: MarketPageProps) {
  const [bookSide, setBookSide] = useState<OrderSide>("buy");
  const [createSide, setCreateSide] = useState<OrderSide>("buy");
  const [amountInput, setAmountInput] = useState("1000");
  const [priceInput, setPriceInput] = useState("0.00001");
  const [vmInput, setVMInput] = useState(formatEther(SRC20_MARKET.defaultVMInputWei));
  const symbol = snapshot?.symbol ?? "mSRC20";
  const busy = phase === "signing" || phase === "pending";

  const visibleOrders = useMemo(
    () => orders.filter((order) => order.side === bookSide && order.status === "open"),
    [bookSide, orders]
  );
  const draft = useMemo(() => {
    try {
      const amount = parseUnits(amountInput || "0", snapshot?.decimals ?? 18);
      const unitPriceWei = parseEther(priceInput || "0");
      const vmEthAmount = parseEther(vmInput || "0");
      const priceWei = quoteOrderPriceWei(amount, unitPriceWei);
      return { amount, unitPriceWei, vmEthAmount, priceWei, valid: amount > 0n && unitPriceWei > 0n && vmEthAmount > 0n && priceWei > 0n };
    } catch {
      return { amount: 0n, unitPriceWei: 0n, vmEthAmount: 0n, priceWei: 0n, valid: false };
    }
  }, [amountInput, priceInput, snapshot?.decimals, vmInput]);
  const sellAskBlocked = createSide === "sell" && !SELL_ASKS_ENABLED;

  const submit = () => {
    if (!address) return onConnect();
    if (!draft.valid || !marketAddress || sellAskBlocked) return;
    onCreate({
      side: createSide,
      amount: draft.amount,
      unitPriceWei: draft.unitPriceWei,
      vmEthAmount: draft.vmEthAmount,
      expiry: nowSeconds() + BigInt(SRC20_MARKET.defaultExpirySeconds)
    });
  };

  return (
    <main className="market-main">
      <section className="market-hero">
        <div>
          <span className="eyebrow">Atomic ETH settlement · SwapVM transfer</span>
          <h1>{symbol} Market</h1>
          <p>Escrowed bids and asks for experimental SRC20. Buy makers lock test ETH; sell makers move SRC20 into a dedicated MiniVM escrow before an order becomes visible.</p>
        </div>
        <div className="market-wallet-card">
          <span>Your balance</span>
          <strong>{address && balance !== null ? formatToken(balance, snapshot?.decimals ?? 18, 4) : "—"}</strong>
          <small>{symbol}</small>
        </div>
      </section>

      {!marketAddress && (
        <div className="market-warning" role="status">
          <ShieldAlert size={19} />
          <div><strong>Market contract not deployed</strong><span>The interface is ready, but this Base Sepolia release has no configured market address. Order writes stay disabled.</span></div>
        </div>
      )}

      <div className="market-layout">
        <section className="order-book" aria-labelledby="order-book-title">
          <div className="section-heading">
            <div><span className="eyebrow">Live contract state</span><h2 id="order-book-title">Order book</h2></div>
            <button type="button" className="icon-button" disabled={!marketAddress || loading} onClick={onRefresh} aria-label="Refresh orders"><RefreshCw className={loading ? "spin" : ""} size={17} /></button>
          </div>
          <div className="book-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={bookSide === "buy"} onClick={() => setBookSide("buy")}>Buy orders</button>
            <button type="button" role="tab" aria-selected={bookSide === "sell"} disabled={!SELL_ASKS_ENABLED} onClick={() => setBookSide("sell")}>Sell orders</button>
          </div>
          <div className="market-order market-order--head" role="row">
            <span>Side</span><span>Amount</span><span>Unit price</span><span>Total</span><span>Maker</span><span>Action</span>
          </div>
          <div className="order-list" role="table" aria-label={`${bookSide} orders`}>
            {visibleOrders.map((order) => (
              <OrderRow key={order.id.toString()} order={order} address={address} symbol={symbol} busy={activeOrderId === order.id} onConnect={onConnect} onAction={onOrderAction} />
            ))}
            {!loading && visibleOrders.length === 0 && (
              <div className="order-empty">{marketAddress ? `No open ${bookSide} orders.` : "Deploy and configure the market contract to read real orders."}</div>
            )}
          </div>
        </section>

        <aside className="create-order" aria-labelledby="create-order-title">
          <span className="eyebrow">New onchain order</span>
          <h2 id="create-order-title">Create {createSide} order</h2>
          <div className="book-tabs create-tabs">
            <button type="button" aria-selected={createSide === "buy"} onClick={() => setCreateSide("buy")}>Buy</button>
            <button type="button" aria-selected={createSide === "sell"} disabled={!SELL_ASKS_ENABLED} onClick={() => setCreateSide("sell")}>Sell</button>
          </div>
          <label>Amount <span>{symbol}</span><input value={amountInput} inputMode="decimal" onChange={(event) => setAmountInput(event.target.value)} /></label>
          <label>Price per token <span>ETH</span><input value={priceInput} inputMode="decimal" onChange={(event) => setPriceInput(event.target.value)} /></label>
          <label>VM execution budget <span>ETH</span><input value={vmInput} inputMode="decimal" onChange={(event) => setVMInput(event.target.value)} /></label>
          <dl className="order-summary">
            <div><dt>Trade total</dt><dd>{formatEther(draft.priceWei)} ETH</dd></div>
            <div><dt>Order lifetime</dt><dd>24 hours</dd></div>
            <div><dt>Settlement</dt><dd>{createSide === "buy" ? "ETH locked now" : "SRC20 escrowed now"}</dd></div>
          </dl>
          <button className="create-button" type="button" disabled={Boolean(address && (!marketAddress || !draft.valid || busy || sellAskBlocked))} onClick={submit}>
            {busy && activeOrderId === null ? <LoaderCircle className="spin" size={18} /> : createSide === "buy" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
            {address ? `Create ${createSide} order` : "Connect wallet"}
          </button>
          <p className="market-form-note">
            {createSide === "buy"
              ? `Locks ${formatEther(draft.priceWei + draft.vmEthAmount)} test ETH for price plus VM execution.`
              : `Approves the dedicated MiniVM escrow when needed, then atomically moves ${amountInput || "0"} ${symbol} into custody. Creating an ask uses up to two VM buys.`}
          </p>
          {error && <p className="market-error" role="alert">{error}</p>}
        </aside>
      </div>

      <section className="market-footnote">
        <ShieldAlert size={17} /><p><strong>Unaudited experimental software.</strong> Zero-value testing only. The contract has no owner, pause, upgrade or arbitrary withdrawal path. Forced ETH is never included in user refunds.</p>
        {marketAddress && <span>Market {shortAddress(marketAddress, 6)}</span>}
      </section>
    </main>
  );
}
