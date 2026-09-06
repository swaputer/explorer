import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Clock3,
  Gavel,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { ZeroAddress, formatEther, parseEther, parseUnits } from "ethers";
import { SRC20_AUCTION } from "../config";
import { formatToken, shortAddress } from "../format";
import type { AuctionPhase } from "../hooks/useSRC20Auction";
import type { AuctionLot, CreateAuctionInput } from "../lib/auction";
import type { TokenSnapshot } from "../lib/swapvm";

interface AuctionPageProps {
  readonly snapshot: TokenSnapshot | null;
  readonly address: string | null;
  readonly balance: bigint | null;
  readonly factoryAddress: string | null;
  readonly auctionHouseAddress: string | null;
  readonly lots: readonly AuctionLot[];
  readonly claimableEth: bigint;
  readonly loading: boolean;
  readonly phase: AuctionPhase;
  readonly error: string | null;
  readonly activeAuctionId: bigint | null;
  readonly operation: "create" | "bid" | "settle" | "cancel" | "withdraw" | null;
  readonly onConnect: () => void;
  readonly onRefresh: () => void;
  readonly onCreate: (input: CreateAuctionInput) => void;
  readonly onBid: (lot: AuctionLot, amountWei: bigint) => void;
  readonly onSettle: (lot: AuctionLot) => void;
  readonly onCancel: (lot: AuctionLot) => void;
  readonly onWithdraw: () => void;
}

type AuctionFilter = "live" | "ended";
const nowSeconds = () => BigInt(Math.floor(Date.now() / 1_000));

function isLive(lot: AuctionLot): boolean {
  return lot.status === "open" && lot.endTime > nowSeconds();
}

function endLabel(endTime: bigint): string {
  const seconds = Number(endTime - nowSeconds());
  if (seconds <= 0) return "Ended";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ${Math.ceil(seconds % 3_600 / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor(seconds % 86_400 / 3_600)}h`;
}

function lotState(lot: AuctionLot): string {
  if (lot.status === "settled") return "Settled";
  if (lot.status === "cancelled") return "Cancelled";
  return isLive(lot) ? "Live" : "Awaiting settlement";
}

export function AuctionPage({
  snapshot,
  address,
  balance,
  factoryAddress,
  auctionHouseAddress,
  lots,
  claimableEth,
  loading,
  phase,
  error,
  activeAuctionId,
  operation,
  onConnect,
  onRefresh,
  onCreate,
  onBid,
  onSettle,
  onCancel,
  onWithdraw
}: AuctionPageProps) {
  const [filter, setFilter] = useState<AuctionFilter>("live");
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [amountInput, setAmountInput] = useState("1000");
  const [reserveInput, setReserveInput] = useState("0.001");
  const [durationInput, setDurationInput] = useState("24");
  const [vmInput, setVMInput] = useState(formatEther(SRC20_AUCTION.defaultVMInputWei));
  const [bidInput, setBidInput] = useState("");
  const symbol = snapshot?.symbol ?? "SRC20";
  const decimals = snapshot?.decimals ?? 18;
  const busy = phase === "signing" || phase === "pending";
  const selected = lots.find((lot) => lot.id === selectedId) ?? null;

  const visibleLots = useMemo(
    () => lots.filter((lot) => filter === "live" ? isLive(lot) : !isLive(lot)),
    [filter, lots]
  );

  const draft = useMemo(() => {
    try {
      const amount = parseUnits(amountInput || "0", decimals);
      const reservePriceWei = parseEther(reserveInput || "0");
      const vmEthAmount = parseEther(vmInput || "0");
      const hours = Number(durationInput);
      const validHours = Number.isFinite(hours) && hours > 0 && hours <= 720;
      const duration = validHours ? BigInt(Math.round(hours * 3_600)) : 0n;
      return {
        amount,
        reservePriceWei,
        vmEthAmount,
        duration,
        valid: amount > 0n && reservePriceWei > 0n && vmEthAmount > 0n && duration > 0n
      };
    } catch {
      return { amount: 0n, reservePriceWei: 0n, vmEthAmount: 0n, duration: 0n, valid: false };
    }
  }, [amountInput, decimals, durationInput, reserveInput, vmInput]);

  const parsedBid = useMemo(() => {
    if (!selected) return 0n;
    try { return parseEther(bidInput || formatEther(selected.minimumNextBidWei)); } catch { return 0n; }
  }, [bidInput, selected]);

  const selectLot = (lot: AuctionLot) => {
    setSelectedId(lot.id);
    setBidInput(formatEther(lot.minimumNextBidWei));
  };

  const submitCreate = () => {
    if (!address) return onConnect();
    if (!draft.valid || !factoryAddress) return;
    onCreate({
      amount: draft.amount,
      reservePriceWei: draft.reservePriceWei,
      vmEthAmount: draft.vmEthAmount,
      endTime: nowSeconds() + draft.duration
    });
  };

  const renderDetailAction = (lot: AuctionLot) => {
    if (!address) return <button className="create-button" type="button" onClick={onConnect}>Connect wallet</button>;
    const current = address.toLowerCase();
    const seller = lot.seller.toLowerCase();
    const ended = lot.endTime <= nowSeconds();
    const hasBid = lot.highestBidder !== ZeroAddress;
    if (lot.status !== "open") return <button className="create-button" type="button" disabled>{lotState(lot)}</button>;
    if (!ended && current !== seller) {
      return (
        <button
          className="create-button"
          type="button"
          disabled={busy || parsedBid < lot.minimumNextBidWei}
          onClick={() => onBid(lot, parsedBid)}
        >
          {busy && activeAuctionId === lot.id ? <LoaderCircle className="spin" size={17} /> : <Gavel size={17} />}
          Place bid
        </button>
      );
    }
    if (ended && hasBid) {
      return (
        <button className="create-button" type="button" disabled={busy} onClick={() => onSettle(lot)}>
          {busy && activeAuctionId === lot.id ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}
          Settle auction
        </button>
      );
    }
    if (!hasBid && current === seller) {
      return (
        <button className="create-button auction-danger-button" type="button" disabled={busy} onClick={() => onCancel(lot)}>
          {busy && activeAuctionId === lot.id ? <LoaderCircle className="spin" size={17} /> : null}
          Cancel auction
        </button>
      );
    }
    return <button className="create-button" type="button" disabled>{ended ? "No bids" : "Your auction"}</button>;
  };

  return (
    <main className="market-main auction-main">
      <section className="market-hero auction-hero">
        <div>
          <span className="eyebrow">TinySol escrow · English auction</span>
          <h1>{symbol} Auctions</h1>
          <p>List SRC20 lots into a dedicated mini-contract escrow. Bids remain locked in the auction house and final settlement releases the winning lot atomically through SVM.</p>
        </div>
        <div className="market-wallet-card">
          <span>Your balance</span>
          <strong>{address && balance !== null ? formatToken(balance, decimals, 4) : "—"}</strong>
          <small>{symbol}</small>
        </div>
      </section>

      <div className="auction-metrics">
        <div><span>Auction house</span><strong>{auctionHouseAddress ? shortAddress(auctionHouseAddress, 6) : "Not created"}</strong></div>
        <div><span>All lots</span><strong>{lots.length}</strong></div>
        <div><span>Claimable proceeds</span><strong>{formatEther(claimableEth)} ETH</strong></div>
        <button type="button" disabled={!address || claimableEth === 0n || busy} onClick={address ? onWithdraw : onConnect}>
          {operation === "withdraw" && busy ? <LoaderCircle className="spin" size={15} /> : <WalletCards size={15} />}
          Withdraw
        </button>
      </div>

      <div className="market-layout auction-layout">
        <section className="order-book" aria-labelledby="auction-list-title">
          <div className="section-heading">
            <div><span className="eyebrow">Onchain lots</span><h2 id="auction-list-title">Auction board</h2></div>
            <button type="button" className="icon-button" disabled={!factoryAddress || loading} onClick={onRefresh} aria-label="Refresh auctions">
              <RefreshCw className={loading ? "spin" : ""} size={17} />
            </button>
          </div>
          <div className="book-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={filter === "live"} onClick={() => setFilter("live")}>Live auctions</button>
            <button type="button" role="tab" aria-selected={filter === "ended"} onClick={() => setFilter("ended")}>Ended & settled</button>
          </div>
          <div className="auction-row auction-row--head" role="row">
            <span>Lot</span><span>Amount</span><span>Current bid</span><span>Ends</span><span>Seller</span><span />
          </div>
          <div className="order-list" role="table" aria-label="SRC20 auctions">
            {visibleLots.map((lot) => (
              <button className="auction-row" type="button" role="row" key={lot.id.toString()} onClick={() => selectLot(lot)}>
                <span className="auction-lot-id"><Gavel size={15} /><strong>#{lot.id.toString()}</strong><small>{lotState(lot)}</small></span>
                <span><strong>{formatToken(lot.amount, decimals, 4)}</strong><small>{symbol}</small></span>
                <span><strong>{formatEther(lot.highestBidWei || lot.reservePriceWei)}</strong><small>{lot.highestBidWei ? "ETH highest" : "ETH reserve"}</small></span>
                <span><strong>{endLabel(lot.endTime)}</strong><small>{lot.bidCount.toString()} bids</small></span>
                <span><strong>{shortAddress(lot.seller, 4)}</strong><small>seller</small></span>
                <span className="auction-view">View</span>
              </button>
            ))}
            {!loading && visibleLots.length === 0 && <div className="order-empty">No {filter} auctions yet.</div>}
          </div>
        </section>

        <aside className="create-order auction-panel" aria-labelledby={selected ? "auction-detail-title" : "create-auction-title"}>
          {selected ? (
            <>
              <button className="auction-back" type="button" onClick={() => setSelectedId(null)}><ArrowLeft size={14} /> New auction</button>
              <span className="eyebrow">Lot #{selected.id.toString()}</span>
              <h2 id="auction-detail-title">{lotState(selected)}</h2>
              <dl className="order-summary auction-detail-list">
                <div><dt>Lot amount</dt><dd>{formatToken(selected.amount, decimals, 6)} {symbol}</dd></div>
                <div><dt>Reserve</dt><dd>{formatEther(selected.reservePriceWei)} ETH</dd></div>
                <div><dt>Highest bid</dt><dd>{formatEther(selected.highestBidWei)} ETH</dd></div>
                <div><dt>Bid count</dt><dd>{selected.bidCount.toString()}</dd></div>
                <div><dt>Seller</dt><dd>{shortAddress(selected.seller, 6)}</dd></div>
                <div><dt>Time</dt><dd>{endLabel(selected.endTime)}</dd></div>
              </dl>
              {isLive(selected) && address?.toLowerCase() !== selected.seller.toLowerCase() && (
                <label>Bid amount <span>ETH</span><input value={bidInput} inputMode="decimal" onChange={(event) => setBidInput(event.target.value)} /></label>
              )}
              {renderDetailAction(selected)}
              <p className="market-form-note">Minimum next bid: {formatEther(selected.minimumNextBidWei)} ETH. Outbid funds become withdrawable instead of being pushed to the wallet.</p>
            </>
          ) : (
            <>
              <span className="eyebrow">New escrowed lot</span>
              <h2 id="create-auction-title">Create auction</h2>
              <label>Lot amount <span>{symbol}</span><input value={amountInput} inputMode="decimal" onChange={(event) => setAmountInput(event.target.value)} /></label>
              <label>Reserve price <span>ETH</span><input value={reserveInput} inputMode="decimal" onChange={(event) => setReserveInput(event.target.value)} /></label>
              <label>Duration <span>hours</span><input value={durationInput} inputMode="decimal" onChange={(event) => setDurationInput(event.target.value)} /></label>
              <label>VM execution budget <span>ETH</span><input value={vmInput} inputMode="decimal" onChange={(event) => setVMInput(event.target.value)} /></label>
              <dl className="order-summary">
                <div><dt>Custody</dt><dd>TinySol escrow</dd></div>
                <div><dt>Bid increment</dt><dd>5% minimum</dd></div>
                <div><dt>Settlement</dt><dd>Permissionless after end</dd></div>
              </dl>
              <button className="create-button" type="button" disabled={Boolean(address && (!factoryAddress || !draft.valid || busy))} onClick={submitCreate}>
                {operation === "create" && busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
                {address ? "Create auction" : "Connect wallet"}
              </button>
              <p className="market-form-note">{auctionHouseAddress ? "Your lot moves into the existing bound escrow." : "The first lot automatically deploys this token's TinySol escrow and creates its deterministic auction house."}</p>
            </>
          )}
          {error && <p className="market-error" role="alert">{error}</p>}
        </aside>
      </div>

      <section className="market-footnote auction-footnote">
        <Clock3 size={17} />
        <p><strong>Settlement is explicit.</strong> After time expires, any wallet may submit settlement; tokens always go to the highest bidder and proceeds become claimable by the seller.</p>
        {factoryAddress && <span>Factory {shortAddress(factoryAddress, 6)}</span>}
      </section>
    </main>
  );
}
