# Swaputer Explorer

Swaputer protocol explorer, Go indexer, REST API and WebSocket feed.
TinySol Studio is an independent online frontend. Mint, Market and Bridge are applications in the standalone `computer` frontend.
Set `VITE_COMPUTER_URL` and `VITE_STUDIO_URL` when building the explorer to enable its app links and
forward legacy application URLs.

- `apps/swaputer-web` — primary Vue product UI.
- `services/svm-indexer` — production Go indexer and public API.

The private `swaputer/protocol` submodule supplies the pinned active deployment,
protocol sources, specifications, and recursive tooling dependency required by
the UI build. Clone recursively:

```sh
git clone --recurse-submodules https://github.com/swaputer/explorer.git
cd explorer
npm ci --prefix apps/swaputer-web
npm run test --prefix apps/swaputer-web
npm run build --prefix apps/swaputer-web
(cd services/svm-indexer && go test ./...)
```

Licensed under the MIT License.
