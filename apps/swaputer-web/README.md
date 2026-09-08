# Swaputer Web

Vue 3 + Vite protocol explorer for Swaputer.

## Routes

- `/contracts` — all deployed Mini Contracts, with standard-aware details
- `/studio` — compatibility redirect to the standalone online Studio
- `/transactions`, `/tx/:hash`, `/address/:address` — indexed activity and details
- `/computer` — application desktop
- `/minter`, `/market`, `/market/:program`, `/bridge` — compatibility links to computer

Studio runs as an independent online frontend. Mint, Market and Bridge run in the standalone computer frontend on desktop and mobile.

## Development

```bash
npm install
npm run dev
```

The development server listens on `http://127.0.0.1:4174`.

## Configuration

Copy `.env.example` to `.env.local` and configure the RPC, indexer, `VITE_COMPUTER_URL`, and `VITE_STUDIO_URL`. Deployment addresses come from the pinned Base Sepolia release manifest. Build-time address overrides must match that manifest.

## Verification

```bash
npm run typecheck
npm run build
```
