import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the protocol explorer header stays read-only", () => {
  const header = source("../src/components/AppHeader.vue");

  assert.doesNotMatch(header, /useWallet|Connect wallet|window\.ethereum/);
  assert.doesNotMatch(header, />Apps<|>Ecosystem</);
  assert.match(header, />Overview</);
  assert.match(header, />Contracts</);
  assert.match(header, /Developer/);
  assert.match(header, />Docs</);
  assert.match(header, />GitHub</);
  assert.match(header, />Studio</);
});

test("standalone app routes and views are not bundled into Explorer", () => {
  const router = source("../src/router.ts");
  const retiredPaths = ["/minter", "/market", "/bridge", "/ecosystem", "/studio"];

  for (const path of retiredPaths) assert.doesNotMatch(router, new RegExp(`path: [\"']${path}`));

  const retiredFiles = [
    "../src/composables/useWallet.ts",
    "../src/views/EcosystemRedirectView.vue",
    "../src/views/StudioRedirectView.vue",
    "../src/views/DocsView.vue",
    "../src/lib/ecosystem.ts",
    "../src/lib/config.ts",
    "../src/lib/protocol.ts",
    "../src/lib/releaseScope.ts",
    "../src/lib/studioApp.ts",
    "../src/lib/universalRouter.ts"
  ];
  for (const path of retiredFiles) assert.equal(existsSync(new URL(path, import.meta.url)), false);
});

test("external product links use the canonical destinations", () => {
  const header = source("../src/components/AppHeader.vue");
  const docsRedirect = source("../src/views/DocsRedirectView.vue");
  const links = source("../src/lib/links.ts");

  assert.match(header, /DOCS_URL, GITHUB_URL, STUDIO_URL/);
  assert.match(docsRedirect, /window\.location\.replace\(DOCS_URL\)/);
  assert.match(links, /https:\/\/github\.com\/swaputer/);
  assert.match(links, /http:\/\/127\.0\.0\.1:4177\//);
  assert.match(links, /http:\/\/127\.0\.0\.1:4176\//);
  assert.doesNotMatch(header, /rel="noreferrer"/);
  assert.match(header, /rel="noopener noreferrer"/);
});

test("production builds default to the same-origin read-only API", () => {
  const explorer = source("../src/lib/explorer.ts");
  const packageManifest = source("../package.json");
  assert.match(explorer, /import\.meta\.env\.DEV \? "http:\/\/127\.0\.0\.1:8080" : "\/api"/);
  assert.match(explorer, /\/v1\/src20\/\$.*\/holders/);
  assert.match(explorer, /\/v1\/src20\/\$.*\/transfers/);
  assert.doesNotMatch(explorer, /\/v1\/market/);
  assert.doesNotMatch(packageManifest, /"ethers"/);
});

test("the document canvas is dark before and after application startup", () => {
  const document = source("../index.html");
  const theme = source("../src/theme-dark.css");

  assert.match(document, /name="theme-color" content="#131313"/);
  assert.match(document, /html,body,#app\{[^}]*background:#131313/);
  assert.match(theme, /html,\s*body,\s*#app,\s*\.app-shell\s*\{[^}]*background:\s*var\(--canvas\)/s);
});

test("each explorer page owns its contextual search", () => {
  const header = source("../src/components/AppHeader.vue");
  const search = source("../src/components/ExplorerSearch.vue");
  const views = [
    "../src/views/ExplorerView.vue",
    "../src/views/TransactionsView.vue",
    "../src/views/ContractsView.vue",
    "../src/views/AddressDetailView.vue",
    "../src/views/ContractDetailView.vue",
    "../src/views/TransactionDetailView.vue"
  ].map(source);

  assert.doesNotMatch(header, /ExplorerSearch|header-command-island|global-explorer-query/);
  assert.doesNotMatch(header, /event\.metaKey \|\| event\.ctrlKey/);
  assert.doesNotMatch(search, /<kbd/);
  assert.match(search, /class="explorer-search__leading"[^>]*type="submit"/);
  for (const view of views) assert.match(view, /<ExplorerSearch\s+compact/);
});
