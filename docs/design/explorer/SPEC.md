# Explorer visual specification

The four concept images in this directory are the implementation source of
truth for Explorer, transaction, address and SRC20 detail surfaces.

## Design tokens

- Canvas: true white `#ffffff`.
- Primary text/rules: `#151515`.
- Secondary text: `#6b6b6b`.
- Hairline borders: `#d7d7d7`.
- Action/link blue: `#3157f5`.
- Finalized green: `#22ad39`.
- Typography: Inter Variable for UI and a system monospace stack for hashes,
  amounts and numeric protocol data.
- Page heading: 24px/1.15, 650 weight.
- Section heading: 17px/1.25, 650 weight.
- Body/control text: 12–14px with explicit line heights.
- Table rows: 42–44px.
- Radius: 0–4px. No shadows, gradients or glass effects.
- Explorer pages use a centered 1200px container. Studio has its own design
  specification in the standalone `swaputer/studio` repository.

## Container and components

- Use open tables, rails and hairline dividers; do not wrap sections in cards.
- Header remains quiet and uses a 2px blue active underline.
- Hashes and Account IDs are shortened visually but retain the full value in
  accessible labels and copy actions.
- Status uses a small semantic dot plus text, never a decorative pill.
- Search, tabs, pagination and disclosure controls use squared border-led
  geometry and 12–14px UI text.
- Responsive pages keep the same hierarchy. Tables scroll horizontally below
  760px.

## Visible copy lock

- Header: `Overview`, `Contracts`, `Studio`, `Computer`.
- Explorer: search placeholder `Search transaction hash, address or SVM
  account`, `Search`, `Recent SVM transactions`, `Latest Events`.
- Transaction: `Explorer`, `Transaction`, `SVM execution`, `Events`, `Raw
  receipt`.
- Address: `Explorer`, `Address`, `SRC20 balances`, `SVM transactions`,
  `Transactions`, `Orders`.
- SRC20 detail: `SRC20`, `Holders`, `Transfers`, `Recent transfers`, `Mint`.

No marketing subtitle, eyebrow, fake metric, chart or explanatory hero copy is
allowed on these screens.
