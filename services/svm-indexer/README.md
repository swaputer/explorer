# SVM indexer

WS-first Go service for committed SVM executions. It stores raw receipt history
before building SRC20 and market projections. Public API terminology uses SVM
and Events; the decoder listens for the on-chain `Events` event.

## Run locally

From the repository root:

```sh
docker compose -f infra/local/compose.yaml up -d
go run ./services/svm-indexer/cmd/server
```

The service automatically reads `services/svm-indexer/.env.local`. Copy
`.env.example` when setting up another machine. Never commit a real provider
credential.

Endpoints currently available:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /v1/status`
- `GET /v1/events`
- `GET /v1/transactions`
- `GET /v1/transactions/{transactionHash}`
- `GET /v1/addresses/{account}/transactions`
- `GET /v1/contracts?standard=all|src20|unclassified`
- `GET /v1/contracts/{programId}`
- `GET /v1/contracts/{programId}/transactions`
- `GET /v1/src20/{programId}/holders`
- `GET /v1/src20/{programId}/transfers`
- `GET /v1/minter/src20`
- `GET /v1/minter/src20/{programId}`
- `GET /v1/market/{programId}/orders`
- `GET /v1/market/{programId}/trades`
- `GET /v1/ws`

The minter list uses the same opaque cursor pagination contract as other
growing collections. These endpoints are deliberately narrower than the general SRC20
explorer. They return only the OpenMint SRC20 package hash pinned by the active
release, after its complete public-mint metadata ABI has been read successfully.
They are the allowlist boundary for consumer minting interfaces.

## Cursor pagination

Growing transaction, contract, holder, transfer, order, and trade collections
use keyset pagination. Set `limit` to the requested page size (default 50,
maximum 200) and omit `cursor` for the first page. A paginated response has the
following shape:

```json
{
  "items": [],
  "nextCursor": "opaque-value"
}
```

Pass a non-empty `nextCursor` unchanged as the next request's `cursor`. An empty
value means there is no later page. Cursors are scoped to the endpoint and all
active filters, so clients must keep `standard`, `status`, `side`, and `maker`
unchanged while continuing a result set. Reusing a cursor with another address,
contract, token, market, or filter returns `400 INVALID_CURSOR`.

Clients must treat cursors as opaque and short-lived navigation state. They are
not record identifiers and should not be decoded, modified, or persisted as
durable bookmarks. Keyset ordering prevents concurrent inserts at the head of a
collection from shifting the already visited page boundary.

The indexer subscribes before taking its initial chain-head snapshot, backfills
through HTTP, then drains live WS notifications. HTTP reconciliation also runs
periodically so a reconnect cannot create a permanent gap.

For production, keep the primary endpoint in `SVM_RPC_WS_URL` and
`SVM_RPC_HTTP_URL`, then provide comma-separated alternatives through
`SVM_RPC_WS_FALLBACK_URLS` and `SVM_RPC_HTTP_FALLBACK_URLS`. WS connection,
chain validation, and subscription failures rotate to the next endpoint. Every
HTTP chain read is retried against the next endpoint and validates chain ID
before use. Endpoint URLs are redacted from runtime errors.

`/healthz` is a process liveness probe. `/readyz` returns success only after an
initial authoritative HTTP sync, a responsive database, a recent checkpoint,
and chain lag within `SVM_READINESS_MAX_LAG`. WS availability is reported but
does not gate readiness: if every WS provider is unavailable, the retry loop
continues HTTP catch-up. `/metrics` exposes Prometheus text metrics for chain
lag, canonical/finalized tips, RPC endpoint selection and failures, WS
reconnects, last sync time, and quarantined ingestion errors.

Operational commands:

```sh
go run ./cmd/admin status
go run ./cmd/admin rewind 46138326
```

`rewind` preserves raw orphaned history and rebuilds canonical projections from
the requested block when the server starts again.

## SRC20 market projection

The same WS-first scanner follows the configured `SwaputerSRC20MarketFactory`
and every market it creates. `OrderCreated`, `OrderFilled`, and
`OrderCancelled` are stored as reorg-aware projections. A configured legacy
market can be included with `SVM_MARKET_ADDRESSES`.

- `GET /v1/market` returns only SRC20 markets with at least one unexpired open order.
- `GET /v1/market/{program}` returns the market binding and order summary.
- `GET /v1/market/{program}/orders` accepts `status`, `side`, `maker`, and `limit`.
- `GET /v1/market/{program}/trades` returns indexed fills newest first.
- WS clients receive `svm.market` after committed market events.
