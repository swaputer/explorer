# Applications

- `swaputer-web` is the primary Vue application and the complete product UI;
  Explorer, Studio, Minter, Bridge, and Market all live here.
- `mint-ui` is a legacy React test interface. Reuse protocol logic from it when
  useful, but add new product pages to `swaputer-web`.
- `swaputer-inspector` is a standalone inspection utility.

The primary navigation is Bridge, SRC20, Market, Explorer and Studio. Studio is
desktop-only; the other product surfaces remain responsive.
