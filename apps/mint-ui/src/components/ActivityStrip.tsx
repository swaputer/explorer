import { CheckCircle2, ExternalLink, List } from "lucide-react";
import { BASE_SEPOLIA } from "../config";
import { formatToken, shortAddress } from "../format";
import type { Activity } from "../hooks/useMintableToken";
import type { TokenSnapshot } from "../lib/swapvm";

interface ActivityStripProps {
  readonly activity: Activity | null;
  readonly snapshot: TokenSnapshot | null;
}

export function ActivityStrip({ activity, snapshot }: ActivityStripProps) {
  return (
    <section className="activity" aria-labelledby="activity-title">
      <div className="activity__heading">
        <div><List size={20} /><h2 id="activity-title">Recent activity</h2></div>
        <span>Current session</span>
      </div>
      {activity ? (
        <div className="activity-row">
          <span className="activity-status"><CheckCircle2 size={16} />Confirmed</span>
          <span>{activity.operation === "mint" ? "Mint" : "Transfer"}</span>
          <strong>{snapshot ? formatToken(activity.amount, snapshot.decimals, 0) : "1,000"} mSRC20</strong>
          <a href={`${BASE_SEPOLIA.explorerUrl}/tx/${activity.hash}`} target="_blank" rel="noreferrer">
            {shortAddress(activity.hash, 7)}<ExternalLink size={14} />
          </a>
          <span>Block {activity.blockNumber.toLocaleString()}</span>
        </div>
      ) : (
        <p className="activity-empty">No token transaction submitted in this browser session.</p>
      )}
    </section>
  );
}
