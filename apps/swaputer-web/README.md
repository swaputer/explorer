# Swaputer Web

Vue 3 + Vite protocol explorer for Swaputer.

## Routes

- `/contracts` — all deployed SVM programs and their indexed activity
- `/transactions`, `/tx/:hash`, `/address/:address` — indexed activity and details
- `/docs` — link to the standalone protocol documentation

## Development

```bash
npm ci
npm run dev
```

The development server listens on `http://127.0.0.1:4174`.

## Configuration

Copy `.env.example` to `.env.local` and configure the indexer API and documentation URL. The Explorer is read-only and never requests a wallet connection.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```
