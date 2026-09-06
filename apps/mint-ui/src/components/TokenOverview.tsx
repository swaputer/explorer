import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { SWAPVM } from "../config";
import { formatToken, shortAddress } from "../format";
import type { TokenSnapshot } from "../lib/swapvm";
import { TokenMark } from "./TokenMark";

interface TokenOverviewProps {
  readonly snapshot: TokenSnapshot | null;
  readonly loading: boolean;
}

export function TokenOverview({ snapshot, loading }: TokenOverviewProps) {
  const [copied, setCopied] = useState(false);
  const total = snapshot ? formatToken(snapshot.totalSupply, snapshot.decimals, 0) : "—";
  const cap = snapshot ? formatToken(snapshot.cap, snapshot.decimals, 0) : "10,000,000";
  const progress = snapshot && snapshot.cap > 0n
    ? Math.min(100, Number((snapshot.totalSupply * 1_000_000n) / snapshot.cap) / 10_000)
    : 0;

  async function copyProgramId() {
    await navigator.clipboard.writeText(SWAPVM.programId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  const rows = [
    ["Name", snapshot?.name ?? (loading ? "Loading…" : "—")],
    ["Symbol", snapshot?.symbol ?? "—"],
    ["Decimals", snapshot?.decimals.toString() ?? "—"],
    ["Mint per call", snapshot ? formatToken(snapshot.mintAmount, snapshot.decimals, 0) : "—"],
    ["Supply cap", cap]
  ] as const;

  return (
    <section className="overview" aria-labelledby="token-title">
      <div className="token-heading">
        <TokenMark />
        <div>
          <h1 id="token-title">Mintable SRC20</h1>
          <p className="token-symbol">mSRC20</p>
          <p className="release-state"><span aria-hidden="true" />Experimental · Unaudited</p>
        </div>
      </div>

      <div className="progress-block">
        <div className="progress-copy">
          <p><strong>{total}</strong> <span>/ {cap} minted</span></p>
          <span>{progress < 0.01 && progress > 0 ? "<0.01" : progress.toFixed(2)}%</span>
        </div>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span style={{ width: `${Math.max(progress, progress > 0 ? 0.4 : 0)}%` }} />
        </div>
      </div>

      <dl className="token-details">
        {rows.map(([label, value]) => (
          <div className="detail-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="detail-row">
          <dt>Program ID</dt>
          <dd className="program-id">
            <span title={SWAPVM.programId}>{shortAddress(SWAPVM.programId, 7)}</span>
            <button type="button" onClick={copyProgramId} aria-label="Copy program ID">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </dd>
        </div>
      </dl>
    </section>
  );
}
