import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { formatEther, getAddress, parseEther } from "ethers";
import { BASE_SEPOLIA, SETH_BRIDGE } from "../config";
import { formatToken, shortAddress } from "../format";
import type { BridgePhase } from "../hooks/useSETHBridge";
import type { BridgeDirection, SETHBridgeSnapshot } from "../lib/seth";

interface SETHBridgePageProps {
  readonly address: string | null;
  readonly vaultAddress: string | null;
  readonly snapshot: SETHBridgeSnapshot | null;
  readonly loading: boolean;
  readonly phase: BridgePhase;
  readonly error: string | null;
  readonly transactionHash: string | null;
  readonly onConnect: () => void;
  readonly onRefresh: () => void;
  readonly onSubmit: (direction: BridgeDirection, recipient: string, amount: bigint, vmEthAmount: bigint) => void;
}

export function SETHBridgePage({
  address,
  vaultAddress,
  snapshot,
  loading,
  phase,
  error,
  transactionHash,
  onConnect,
  onRefresh,
  onSubmit
}: SETHBridgePageProps) {
  const [direction, setDirection] = useState<BridgeDirection>("deposit");
  const [amountInput, setAmountInput] = useState("0.01");
  const [vmInput, setVMInput] = useState(formatEther(SETH_BRIDGE.defaultVMInputWei));
  const [recipient, setRecipient] = useState(address ?? "");
  const busy = phase === "signing" || phase === "pending";

  useEffect(() => {
    if (address && !recipient) setRecipient(address);
  }, [address, recipient]);

  const draft = useMemo(() => {
    try {
      const amount = parseEther(amountInput || "0");
      const vmEthAmount = parseEther(vmInput || "0");
      const normalizedRecipient = getAddress(recipient.trim());
      const enoughSETH = direction === "deposit" || (snapshot !== null && snapshot.balance >= amount);
      return {
        amount,
        vmEthAmount,
        recipient: normalizedRecipient,
        enoughSETH,
        valid: amount > 0n && vmEthAmount > 0n && enoughSETH
      };
    } catch {
      return { amount: 0n, vmEthAmount: 0n, recipient: "", enoughSETH: true, valid: false };
    }
  }, [amountInput, direction, recipient, snapshot, vmInput]);

  const submit = () => {
    if (!address) return onConnect();
    if (!vaultAddress || !draft.valid) return;
    onSubmit(direction, draft.recipient, draft.amount, draft.vmEthAmount);
  };

  return (
    <main className="market-main bridge-main">
      <section className="market-hero bridge-hero">
        <div>
          <span className="eyebrow">Atomic vault · MiniVM supply invariant</span>
          <h1>ETH ↔ sETH</h1>
          <p>Lock native test ETH and mint the same number of sETH wei inside SwapVM, or burn sETH and release its backing. Principal, VM state, nonce and payout settle atomically.</p>
        </div>
        <div className={`bridge-solvency ${snapshot?.solvent ? "bridge-solvency--ok" : ""}`}>
          <ShieldCheck size={20} />
          <div><span>Vault status</span><strong>{loading ? "Checking…" : snapshot?.solvent ? "Fully backed" : vaultAddress ? "Unavailable" : "Not configured"}</strong></div>
        </div>
      </section>

      {!vaultAddress && (
        <div className="market-warning" role="status">
          <TriangleAlert size={19} />
          <div><strong>sETH Vault not deployed</strong><span>The Bridge UI is implemented but writes remain disabled until one complete v1.2 Vault/program binding is configured.</span></div>
        </div>
      )}

      <section className="bridge-metrics" aria-label="sETH bridge state">
        <div><span>Your sETH</span><strong>{snapshot ? formatToken(snapshot.balance, 18, 6) : "—"}</strong></div>
        <div><span>ETH locked</span><strong>{snapshot ? formatToken(snapshot.lockedEth, 18, 6) : "—"}</strong></div>
        <div><span>sETH supply</span><strong>{snapshot ? formatToken(snapshot.totalSupply, 18, 6) : "—"}</strong></div>
        <div><span>Forced surplus</span><strong>{snapshot ? formatToken(snapshot.backingSurplus, 18, 6) : "—"}</strong></div>
        <button type="button" className="icon-button" onClick={onRefresh} disabled={!vaultAddress || loading} aria-label="Refresh bridge state"><RefreshCw className={loading ? "spin" : ""} size={17} /></button>
      </section>

      <div className="bridge-layout">
        <section className="bridge-explainer">
          <span className="eyebrow">One transaction, two state machines</span>
          <h2>Backing moves only after the signed VM action succeeds.</h2>
          <div className="bridge-flow">
            <article><span>01</span><div><strong>Sign</strong><p>Your EIP-712 action pins the Vault, sETH program, recipient, amount and VM budget.</p></div></article>
            <article><span>02</span><div><strong>Execute</strong><p>The immutable Vault calls the canonical Router; sETH accepts mint and burn only from that executor.</p></div></article>
            <article><span>03</span><div><strong>Settle</strong><p>Deposit leaves principal locked. Redeem pays ETH only after burn succeeds. Any failure rolls everything back.</p></div></article>
          </div>
          <div className="bridge-equation"><span>Invariant</span><strong>sETH total supply = locked ETH liability</strong></div>
        </section>

        <aside className="create-order bridge-form" aria-labelledby="bridge-form-title">
          <span className="eyebrow">Bridge action</span>
          <h2 id="bridge-form-title">{direction === "deposit" ? "Deposit ETH" : "Redeem sETH"}</h2>
          <div className="book-tabs create-tabs">
            <button type="button" aria-selected={direction === "deposit"} onClick={() => setDirection("deposit")}>Deposit</button>
            <button type="button" aria-selected={direction === "redeem"} onClick={() => setDirection("redeem")}>Redeem</button>
          </div>
          <label>Amount <span>{direction === "deposit" ? "ETH" : "sETH"}</span><input value={amountInput} inputMode="decimal" onChange={(event) => setAmountInput(event.target.value)} /></label>
          <label>Recipient <input className="bridge-recipient" value={recipient} placeholder="0x…" onChange={(event) => setRecipient(event.target.value)} /></label>
          <label>VM execution budget <span>ETH</span><input value={vmInput} inputMode="decimal" onChange={(event) => setVMInput(event.target.value)} /></label>
          <dl className="order-summary">
            <div><dt>Conversion</dt><dd>1 ETH wei = 1 sETH wei</dd></div>
            <div><dt>{direction === "deposit" ? "Wallet sends" : "Recipient receives"}</dt><dd>{formatEther(direction === "deposit" ? draft.amount + draft.vmEthAmount : draft.amount)} ETH{direction === "deposit" ? " max" : ""}</dd></div>
            <div><dt>Unused VM budget</dt><dd>Refunded to signer</dd></div>
          </dl>
          <button className="create-button" type="button" disabled={Boolean(address && (!vaultAddress || !draft.valid || busy))} onClick={submit}>
            {busy ? <LoaderCircle className="spin" size={18} /> : direction === "deposit" ? <ArrowDownToLine size={18} /> : <ArrowUpFromLine size={18} />}
            {address ? direction === "deposit" ? "Deposit and mint" : "Burn and redeem" : "Connect wallet"}
          </button>
          {!draft.enoughSETH && <p className="market-error">Amount exceeds your sETH balance.</p>}
          {error && <p className="market-error" role="alert">{error}</p>}
          {transactionHash && <a className="bridge-tx" href={`${BASE_SEPOLIA.explorerUrl}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a>}
        </aside>
      </div>

      <section className="market-footnote">
        <TriangleAlert size={17} /><p><strong>Unaudited experimental bridge.</strong> Zero-value testing only. The Vault has no owner, pause, upgrade, sweep or arbitrary withdrawal path.</p>
        {vaultAddress && <span>Vault {shortAddress(vaultAddress, 6)}</span>}
      </section>
    </main>
  );
}
