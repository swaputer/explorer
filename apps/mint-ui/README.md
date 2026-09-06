# Swaputer Token & Market UI

A minimal React/Vite interface for the experimental `MintableSRC20` program deployed inside SwapVM on Base Sepolia. It includes mint, transfer, a contract-backed SRC20/ETH order book, a fail-closed UI for the v1.2 atomic ETH/sETH bridge, an in-browser TinySol Studio, a Mini Contract deployment workbench, and the first Chinese edition of the Swaputer Protocol Handbook. The market UI targets only the fully collateralized market and deliberately has no fallback to the obsolete v1.1 buy-only market.

## Run locally

```bash
cd apps/mint-ui
npm install
npm run dev
```

The page uses the public Base Sepolia RPC for read-only MiniVM `staticCall` queries. Minting and SRC20 transfers require an injected EIP-1193 wallet, Base Sepolia test ETH, an EIP-712 `VMAction` signature, and a `0.000001 ETH` exact-input buy through the immutable SwapVM Router. Transfer recipients are entered as EVM addresses and deterministically converted to tagged SwapVM AccountIds.

The UI contains no private key or RPC secret. It is limited to the deployed unaudited, zero-value testnet World and does not expose a mainnet switch.

The Docs page is a handbook-style Chinese protocol narrative. It begins with the unused potential of liquidity, follows one atomic transaction into a sealed World, explains why Mini Contracts are deliberately small, and tells how SRC20 markets and sETH emerge from the protocol. Exact fields, formulas and implementation specifications are intentionally left for a separate technical reference.

The Deploy page accepts a compiled TinySol `.svm` package, validates the SVM1 header and package dimensions locally, displays its immutable package code hash, and predicts the Mini Contract AccountId from the connected wallet's current creator nonce. Constructor arguments are entered as pre-encoded ABI hex. The wallet signs the exact v1.2 `DEPLOY` action; only then are the package bytes sent as transaction calldata. After confirmation the UI reads `programCodeHash` from the Kernel and requires it to match the selected package.

The Studio page runs the pinned TinySol compiler entirely in the browser. It
includes editable Counter, Mini Token and executor-bound bridge templates,
debounced diagnostics, ABI and package inspection, downloads for all seven
compiler artifacts, local source saving, and a direct handoff of the compiled
`.svm` package to the Deploy page. Source code never leaves the browser.

## sETH bridge configuration

The Bridge page defaults to the current zero-value Base Sepolia deployment.
All bindings can be overridden together for a reproducible local deployment;
partial configuration is never accepted:

```bash
VITE_SWAPVM_PROTOCOL_VERSION=1.2 \
VITE_SWAPVM_WORLD_ID=0x... \
VITE_SWAPVM_KERNEL_ADDRESS=0x... \
VITE_SWAPVM_ROUTER_ADDRESS=0x... \
VITE_SWAPVM_SETH_VAULT_ADDRESS=0x... \
VITE_SWAPVM_SETH_ID=0x... \
VITE_SWAPVM_SETH_CODE_HASH=0x... \
npm run dev
```

Every bridge read and write checks the Vault's immutable Router, Kernel, World,
sETH AccountId and exact code hash. Deposits submit principal plus a separate VM
budget; redemptions submit only the VM budget. Unused VM budget returns to the
signer, while the Vault maintains `sETH totalSupply == lockedEth`.

## Market configuration

The market UI never invents sample orders and embeds only the current v1.2 zero-value Base Sepolia bindings. They may be overridden together for a reproducible local deployment:

```bash
VITE_SWAPVM_PROTOCOL_VERSION=1.2 \
VITE_SWAPVM_WORLD_ID=0x... \
VITE_SWAPVM_KERNEL_ADDRESS=0x... \
VITE_SWAPVM_ROUTER_ADDRESS=0x... \
VITE_SWAPVM_SRC20_ID=0x... \
VITE_SWAPVM_MARKET_ADDRESS=0x... \
VITE_SWAPVM_MARKET_ESCROW_ID=0x... \
VITE_SWAPVM_MARKET_ESCROW_CODE_HASH=0x... \
npm run dev
```

The configured market supports:

- Buy orders that lock the quoted test ETH plus the exact VM execution budget.
- Any SRC20 holder selling atomically into an open buy order through the production Router and MiniVM SRC20 `transfer(bytes32,uint256)` call.
- Maker cancellation for open buy orders.
- On v1.2, sell-order creation that checks allowance, performs SRC20 approval if required, and moves the exact amount into the bound MiniVM escrow before recording the order.
- On v1.2, atomic buyer payment plus escrow release and signed seller cancellation plus escrow return.

All market reads and writes validate the market's immutable Router, Kernel, World, token, and escrow bindings before use. Sell controls additionally require protocol version `1.2` and a valid escrow AccountId. The default market, mint and transfer VM input is `0.000001` test ETH. At the pool's `0.00001 ETH/SVMG` initialization price this is materially above the 1,500-byte maximum exposure while avoiding the excessive SVMG output caused by the historical 1:1 test price. The v1.2 escrow application is documented in `docs/SRC20-MARKET.md` and remains unaudited experimental software for zero-value Base Sepolia testing only.

## Current public test bindings

The defaults below select the v1.2 final market. Historical markets are listed only in `deployments/base-sepolia/src20-market-deprecation.json` and are never selected by the UI.

- chain: Base Sepolia (`84532`)
- World: `0x20f614ee9d36602f82422765fa005cedcb6c042fe7fbf5b368124820a829f757`
- Kernel: `0xA751dAFFD61C2d259414573EfCD743cfB24ed10b`
- Router: `0xEe164c82878AE80F2BE88B10771FAB2c4E29b24B`
- MintableSRC20: `0x01ddc42fa71a13cc1ac4fad55e5adf116d9f6a299c18b467b3b90a8b722f946e`
- Escrow market: `0xE183C4d7Ad2F5D882B4c6025DBf4f47cD0669446`
- MarketEscrow: `0x0182fbdf03d5b496c634e0eab2c603bea4297d738e5e1bb6083d98a4ccba2e3c`
- sETH Vault: use the address pinned in `deployments/active/base-sepolia.json`
- sETH MiniVM AccountId: `0x01a52b4c4b0ff5cf872da9a8f8d2adc198896d515555cc1eb4a0ebf4d4ae8c7c`
- sETH code hash: `0x0ba319925e010cc61d6af3c0ef5dc9edb3bcfa1f6588e4ded86e744dbd3fc162`

The last identifier is a MiniVM AccountId, not an EVM contract address. Balances and metadata are queried through `SwapVMKernel.staticCall`.
