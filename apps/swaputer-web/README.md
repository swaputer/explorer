# Swaputer Web

Vue 3 + Vite + Vue Router frontend for the Swaputer mainnet product surface.

## Routes

- `/bridge` — ETH / sETH atomic bridge
- `/contracts` — all deployed Mini Contracts, with standard-aware details
- `/studio` — TinySol editor, compiler, constructor-aware deployment and ABI interaction
- `/minter` — address-driven SRC20 minter

Studio is intentionally unavailable below the desktop breakpoint and is hidden from small-screen navigation.

## Development

```bash
npm install
npm run dev
```

The development server listens on `http://127.0.0.1:4174`.

## Mainnet configuration

Copy `.env.example` to `.env.local` and provide the frozen mainnet deployment values. The UI never falls back to test deployment addresses. Without these values the pages remain inspectable, but on-chain actions stay unavailable and no chain data is fabricated.

## Verification

```bash
npm run typecheck
npm run build
```
