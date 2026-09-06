import { useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, Circle, LoaderCircle, WalletCards } from "lucide-react";
import { ZeroAddress, formatEther, formatUnits, getAddress, isAddress, parseUnits } from "ethers";
import { BASE_SEPOLIA, SWAPVM } from "../config";
import { formatToken, shortAddress } from "../format";
import type { MintPhase, TokenOperation } from "../hooks/useMintableToken";
import type { TokenSnapshot } from "../lib/swapvm";

interface MintPanelProps {
  readonly snapshot: TokenSnapshot | null;
  readonly address: string | null;
  readonly balance: bigint | null;
  readonly phase: MintPhase;
  readonly operation: TokenOperation;
  readonly canMint: boolean;
  readonly error: string | null;
  readonly onConnect: () => void;
  readonly onMint: () => void;
  readonly onTransfer: (recipient: string, amount: bigint) => void;
}

function statusCopy(phase: MintPhase, operation: TokenOperation): string {
  const verb = operation === "mint" ? "Mint" : "Transfer";
  if (phase === "idle") return `Ready to ${verb.toLowerCase()}`;
  if (phase === "signing") return `Confirm the signed ${verb.toLowerCase()} action in your wallet`;
  if (phase === "pending") return `${verb} submitted · waiting for confirmation`;
  if (phase === "confirmed") return `${verb} confirmed · balance refreshed`;
  return `${verb} was not completed`;
}

export function MintPanel({
  snapshot,
  address,
  balance,
  phase,
  operation,
  canMint,
  error,
  onConnect,
  onMint,
  onTransfer
}: MintPanelProps) {
  const [selectedAction, setSelectedAction] = useState<TokenOperation>("mint");
  const [recipient, setRecipient] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const decimals = snapshot?.decimals ?? 18;
  const symbol = snapshot?.symbol ?? "mSRC20";
  const mintAmount = snapshot ? formatToken(snapshot.mintAmount, decimals, 0) : "1,000";
  const busy = phase === "signing" || phase === "pending";

  const transferDraft = useMemo(() => {
    let amount: bigint | null = null;
    try {
      if (amountInput.trim()) amount = parseUnits(amountInput.trim(), decimals);
    } catch {
      amount = null;
    }
    const validRecipient = isAddress(recipient) && getAddress(recipient) !== ZeroAddress;
    const positiveAmount = amount !== null && amount > 0n;
    const withinBalance = amount !== null && amount > 0n && balance !== null && amount <= balance;
    return { amount, validRecipient, positiveAmount, withinBalance };
  }, [amountInput, balance, decimals, recipient]);

  const transferHint = useMemo(() => {
    if (recipient && !transferDraft.validRecipient) return "Enter a valid nonzero EVM wallet address.";
    if (amountInput && !transferDraft.positiveAmount) return `Enter an amount with up to ${decimals} decimals.`;
    if (transferDraft.amount !== null && balance !== null && transferDraft.amount > balance) return "Amount exceeds your available balance.";
    return "The wallet address is converted to its SwapVM AccountId before signing.";
  }, [amountInput, balance, decimals, recipient, transferDraft]);

  const canTransfer = Boolean(address && transferDraft.validRecipient && transferDraft.withinBalance && !busy);
  const visibleOperation = phase === "idle" ? selectedAction : operation;

  const submitTransfer = () => {
    if (transferDraft.amount !== null && canTransfer) onTransfer(recipient, transferDraft.amount);
  };

  return (
    <section className="mint-panel" aria-labelledby="balance-title">
      <div className="balance-block">
        <p id="balance-title">Your balance</p>
        <div className="balance-value">
          <strong>{address && balance !== null ? formatToken(balance, decimals, 2) : "—"}</strong>
          <span>{symbol}</span>
        </div>
      </div>

      <div className="action-tabs" role="tablist" aria-label="Token action">
        <button type="button" role="tab" aria-selected={selectedAction === "mint"} disabled={busy} onClick={() => setSelectedAction("mint")}>Mint</button>
        <button type="button" role="tab" aria-selected={selectedAction === "transfer"} disabled={busy} onClick={() => setSelectedAction("transfer")}>Transfer</button>
      </div>

      {selectedAction === "mint" ? (
        <div className="action-pane" role="tabpanel">
          <button className="mint-button" type="button" disabled={address ? !canMint : false} onClick={address ? onMint : onConnect}>
            {busy && operation === "mint" && <LoaderCircle className="spin" size={19} aria-hidden="true" />}
            {address ? (busy && operation === "mint" ? "Mint in progress" : `Mint ${mintAmount} ${symbol}`) : "Connect wallet to mint"}
          </button>
          <p className="mint-note">Each mint creates {mintAmount} {symbol}. The VM buy uses {formatEther(SWAPVM.buyInputWei)} test ETH.</p>
        </div>
      ) : (
        <div className="action-pane transfer-form" role="tabpanel">
          <label htmlFor="transfer-recipient">Recipient wallet</label>
          <input id="transfer-recipient" type="text" inputMode="text" autoComplete="off" spellCheck={false} placeholder="0x…" value={recipient} disabled={busy} onChange={(event) => setRecipient(event.target.value.trim())} />

          <div className="amount-label">
            <label htmlFor="transfer-amount">Amount</label>
            <span>Available {balance !== null ? formatToken(balance, decimals, 4) : "—"} {symbol}</span>
          </div>
          <div className="amount-input">
            <input id="transfer-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0.0" value={amountInput} disabled={busy} onChange={(event) => setAmountInput(event.target.value)} />
            <button type="button" disabled={!address || balance === null || balance === 0n || busy} onClick={() => balance !== null && setAmountInput(formatUnits(balance, decimals))}>Max</button>
          </div>
          <p className={`transfer-hint${(recipient && !transferDraft.validRecipient) || (amountInput && !transferDraft.positiveAmount) ? " transfer-hint--error" : ""}`}>{transferHint}</p>
          <button className="mint-button transfer-button" type="button" disabled={address ? !canTransfer : false} onClick={address ? submitTransfer : onConnect}>
            {busy && operation === "transfer" ? <LoaderCircle className="spin" size={19} aria-hidden="true" /> : <ArrowUpRight size={19} aria-hidden="true" />}
            {address ? (busy && operation === "transfer" ? "Transfer in progress" : `Transfer ${symbol}`) : "Connect wallet to transfer"}
          </button>
          <p className="mint-note">Transfers execute inside SwapVM and use {formatEther(SWAPVM.buyInputWei)} Base Sepolia test ETH.</p>
        </div>
      )}

      <div className="wallet-state">
        <div><WalletCards size={17} /><span>Wallet</span></div>
        <span>{address ? shortAddress(address, 6) : "Not connected"}</span>
      </div>

      <div className={`transaction-state transaction-state--${phase}`} aria-live="polite">
        <div className="transaction-state__icon">
          {phase === "confirmed" ? <CheckCircle2 size={24} /> : busy ? <LoaderCircle className="spin" size={24} /> : <Circle size={24} />}
        </div>
        <div>
          <strong>{statusCopy(phase, visibleOperation)}</strong>
          <p>{error ?? (address ? `Your ${visibleOperation} status will appear here.` : "Connect a wallet on Base Sepolia to continue.")}</p>
        </div>
      </div>

      <a className="network-link" href={`${BASE_SEPOLIA.explorerUrl}/address/${SWAPVM.router}`} target="_blank" rel="noreferrer">View immutable Router</a>
    </section>
  );
}
