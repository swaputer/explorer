import { ChevronDown, Circle } from "lucide-react";
import { shortAddress } from "../format";

export type AppPage = "token" | "market" | "auction" | "bridge" | "deploy" | "studio" | "docs";

interface HeaderProps {
  readonly address: string | null;
  readonly page: AppPage;
  readonly onConnect: () => void;
  readonly onNavigate: (page: AppPage) => void;
}

export function Header({ address, page, onConnect, onNavigate }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__brand">
        <button className="wordmark" type="button" onClick={() => onNavigate("token")} aria-label="Swaputer home">Swaputer</button>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button type="button" aria-current={page === "token" ? "page" : undefined} onClick={() => onNavigate("token")}>Token</button>
          <button type="button" aria-current={page === "market" ? "page" : undefined} onClick={() => onNavigate("market")}>Market</button>
          <button type="button" aria-current={page === "auction" ? "page" : undefined} onClick={() => onNavigate("auction")}>Auction</button>
          <button type="button" aria-current={page === "bridge" ? "page" : undefined} onClick={() => onNavigate("bridge")}>Bridge</button>
          <button type="button" aria-current={page === "deploy" ? "page" : undefined} onClick={() => onNavigate("deploy")}>Deploy</button>
          <button className="studio-nav-button" type="button" aria-current={page === "studio" ? "page" : undefined} onClick={() => onNavigate("studio")}>Studio</button>
          <button type="button" aria-current={page === "docs" ? "page" : undefined} onClick={() => onNavigate("docs")}>Docs</button>
        </nav>
      </div>
      <div className="header__actions">
        <div className="network" aria-label="Connected network: Base Sepolia">
          <Circle size={10} fill="currentColor" strokeWidth={0} />
          <span>Base Sepolia</span>
          <ChevronDown size={15} aria-hidden="true" />
        </div>
        <button className="wallet-button" type="button" onClick={onConnect}>
          {address ? shortAddress(address, 5) : "Connect wallet"}
        </button>
      </div>
    </header>
  );
}
