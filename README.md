# Swaputer Explorer

Swaputer protocol explorer, Go indexer, REST API and WebSocket feed.
The web interface is read-only: it does not request a wallet connection or host
protocol applications. Its Developer menu links to the standalone TinySol
Studio, documentation, and Swaputer's GitHub organization.

- `apps/swaputer-web` — primary Vue product UI.
- `services/svm-indexer` — production Go indexer and public API.

The private `swaputer/protocol` submodule supplies the pinned active deployment
and protocol data used by the indexer. Clone recursively when working on the
complete Explorer stack:

```sh
git clone --recurse-submodules https://github.com/swaputer/explorer.git
cd explorer
npm ci --prefix apps/swaputer-web
npm run test --prefix apps/swaputer-web
npm run typecheck --prefix apps/swaputer-web
npm run build --prefix apps/swaputer-web
npm audit --prefix apps/swaputer-web --omit=dev --audit-level=high
(cd services/svm-indexer && go test ./... && go vet ./...)
```

Licensed under the MIT License.
