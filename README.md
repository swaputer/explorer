# Swaputer Explorer

Private product repository for the Swaputer Explorer, Studio, Minter, Bridge,
Market, production Go indexer, REST API, and WebSocket feed. Swaputer does not
have a separate marketing website; these user surfaces live in
`apps/swaputer-web`.

- `apps/swaputer-web` — primary Vue product UI.
- `services/svm-indexer` — production Go indexer and public API.
- `apps/mint-ui` — legacy React implementation reference.

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

This repository was split from private monorepo commit
`c9c8bb269e9dfd112d2dad78726a9db516940462` on September 6, 2026. Licensed
under the MIT License.
