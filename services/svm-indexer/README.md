# SVM indexer

HTTP-first Go service for committed SVM executions. It stores raw receipt history
and exposes programs, accounts, transactions, and Events without assigning an
application standard to deployed programs.

## Run locally

From the repository root:

```sh
git submodule update --init --recursive
cp services/svm-indexer/.env.example services/svm-indexer/.env.local
(cd services/svm-indexer && go run ./cmd/server)
```

The service automatically reads `services/svm-indexer/.env.local`. Copy
`.env.example` when setting up another machine, then configure PostgreSQL and
RPC endpoints. Never commit a real provider credential. The production image is
network-neutral: mount a deployment manifest and set `SVM_DEPLOYMENT_MANIFEST`
at runtime.

Endpoints currently available:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /v1/status`
- `GET /v1/events`
- `GET /v1/transactions`
- `GET /v1/transactions/{transactionHash}`
- `GET /v1/addresses/{account}`
- `GET /v1/addresses/{account}/transactions`
- `GET /v1/contracts`
- `GET /v1/contracts/{programId}`
- `GET /v1/contracts/{programId}/transactions`
- `GET /v1/src20`
- `GET /v1/src20/{programId}`
- `GET /v1/src20/{programId}/holders`
- `GET /v1/src20/{programId}/transfers`
- `GET /v1/minter/src20`
- `GET /v1/minter/src20/{programId}`
- `GET /v1/ws`

The `/v1/src20` and `/v1/minter/src20` endpoints provide application data for
compatible explorer detail pages, wallets, and minting clients. SRC20 data is
not used to classify the contract directory or interpret generic transaction
events. The minter endpoints return only the OpenMint package hash pinned by
the active release after its public-mint metadata ABI has been read successfully.

## Cursor pagination

Growing transaction, contract, holder, and transfer collections
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
value means there is no later page. Cursors are scoped to the endpoint. Reusing
a cursor with another address, contract, token, or collection
returns `400 INVALID_CURSOR`.

Clients must treat cursors as opaque and short-lived navigation state. They are
not record identifiers and should not be decoded, modified, or persisted as
durable bookmarks. Keyset ordering prevents concurrent inserts at the head of a
collection from shifting the already visited page boundary.

The indexer subscribes when WS is configured; otherwise it runs in HTTP polling mode.
It always backfills and reconciles through HTTP. HTTP reconciliation runs periodically
so a reconnect cannot create a permanent gap.

For production, set at least `SVM_RPC_HTTP_URL` and optional comma-separated
alternatives in `SVM_RPC_HTTP_FALLBACK_URLS`. Optionally set `SVM_RPC_WS_URL`
and `SVM_RPC_WS_FALLBACK_URLS` for live notifications.
Every HTTP chain read is retried against the next endpoint and validates chain ID
before use. Endpoint URLs are redacted from runtime errors.

`/healthz` is a process liveness probe. `/readyz` returns success only after an
initial authoritative HTTP sync, a responsive database, a recent checkpoint,
and chain lag within `SVM_READINESS_MAX_LAG`. WS availability is reported but
does not gate readiness: if WS providers are unavailable, the loop continues HTTP
catch-up. `/metrics` exposes Prometheus text metrics for chain
lag, canonical/finalized tips, RPC endpoint selection and failures, WS
reconnects, last sync time, and quarantined ingestion errors.

Operational commands:

```sh
go run ./cmd/admin status
go run ./cmd/admin rewind 46138326
```

`rewind` preserves raw orphaned history and rebuilds canonical projections from
the requested block when the server starts again.
