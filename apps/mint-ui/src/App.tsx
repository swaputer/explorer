import { lazy, Suspense, useState } from "react";
import { ActivityStrip } from "./components/ActivityStrip";
import { AuctionPage } from "./components/AuctionPage";
import { Header } from "./components/Header";
import type { AppPage } from "./components/Header";
import { MarketPage } from "./components/MarketPage";
import { MiniContractDeployPage } from "./components/MiniContractDeployPage";
import { ProtocolDocsPage } from "./components/ProtocolDocsPage";
import { MintPanel } from "./components/MintPanel";
import { SETHBridgePage } from "./components/SETHBridgePage";
import { TokenOverview } from "./components/TokenOverview";
import { useMintableToken } from "./hooks/useMintableToken";
import { useMiniContractDeployer } from "./hooks/useMiniContractDeployer";
import { useSRC20Market } from "./hooks/useSRC20Market";
import { useSRC20Auction } from "./hooks/useSRC20Auction";
import { useSETHBridge } from "./hooks/useSETHBridge";

const TinySolStudioPage = lazy(async () => ({
  default: (await import("./components/TinySolStudioPage")).TinySolStudioPage
}));

export function App() {
  const [page, setPage] = useState<AppPage>("token");
  const token = useMintableToken();
  const market = useSRC20Market(token.address, token.signer, token.refresh);
  const auction = useSRC20Auction(token.address, token.signer, token.refresh);
  const bridge = useSETHBridge(token.address, token.signer);
  const deployer = useMiniContractDeployer(token.address, token.signer);

  return (
    <div className="app-shell">
      <Header address={token.address} page={page} onConnect={token.connect} onNavigate={setPage} />
      {page === "token" ? (
        <main>
          <div className="primary-grid">
            <TokenOverview snapshot={token.snapshot} loading={token.loading} />
            <MintPanel
              snapshot={token.snapshot}
              address={token.address}
              balance={token.balance}
              phase={token.phase}
              operation={token.operation}
              canMint={token.canMint}
              error={token.error}
              onConnect={token.connect}
              onMint={token.mint}
              onTransfer={token.transfer}
            />
          </div>
          <ActivityStrip activity={token.activity} snapshot={token.snapshot} />
        </main>
      ) : page === "market" ? (
        <MarketPage
          snapshot={token.snapshot}
          address={token.address}
          balance={token.balance}
          marketAddress={market.marketAddress}
          orders={market.orders}
          loading={market.loading}
          phase={market.phase}
          error={market.error}
          activeOrderId={market.activeOrderId}
          onConnect={token.connect}
          onRefresh={market.refresh}
          onCreate={market.create}
          onOrderAction={market.actOnOrder}
        />
      ) : page === "auction" ? (
        <AuctionPage
          snapshot={token.snapshot}
          address={token.address}
          balance={token.balance}
          factoryAddress={auction.factoryAddress}
          auctionHouseAddress={auction.auctionHouseAddress}
          lots={auction.lots}
          claimableEth={auction.claimableEth}
          loading={auction.loading}
          phase={auction.phase}
          error={auction.error}
          activeAuctionId={auction.activeAuctionId}
          operation={auction.operation}
          onConnect={token.connect}
          onRefresh={auction.refresh}
          onCreate={auction.create}
          onBid={auction.bid}
          onSettle={auction.settle}
          onCancel={auction.cancel}
          onWithdraw={auction.withdraw}
        />
      ) : page === "bridge" ? (
        <SETHBridgePage
          address={token.address}
          vaultAddress={bridge.vaultAddress}
          snapshot={bridge.snapshot}
          loading={bridge.loading}
          phase={bridge.phase}
          error={bridge.error}
          transactionHash={bridge.transactionHash}
          onConnect={token.connect}
          onRefresh={bridge.refresh}
          onSubmit={bridge.submit}
        />
      ) : page === "deploy" ? (
        <MiniContractDeployPage
          address={token.address}
          selectedPackage={deployer.selectedPackage}
          preview={deployer.preview}
          result={deployer.result}
          phase={deployer.phase}
          error={deployer.error}
          onConnect={token.connect}
          onSelectFile={deployer.selectFile}
          onDeploy={deployer.deploy}
        />
      ) : page === "studio" ? (
        <Suspense fallback={<main className="studio-loading">Loading TinySol Studio…</main>}>
          <TinySolStudioPage onUseInDeploy={(file) => {
            void deployer.selectFile(file);
            setPage("deploy");
          }} />
        </Suspense>
      ) : (
        <ProtocolDocsPage />
      )}
      {page !== "studio" && <footer>Base Sepolia · Zero-value test environment</footer>}
    </div>
  );
}
