import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveOfficialFeatureScope } from "../src/lib/releaseScope.ts";

const candidateScope = JSON.parse(readFileSync(new URL("../../../release/v1.2/candidate-scope.json", import.meta.url), "utf8"));
const routerSource = readFileSync(new URL("../src/router.ts", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../src/components/AppHeader.vue", import.meta.url), "utf8");

test("Base Sepolia and local releases preserve the existing application routes", () => {
  for (const environment of ["local", "testnet"]) {
    const scope = resolveOfficialFeatureScope(environment);
    assert.equal(scope.market, true);
    assert.equal(scope.seth, true);
    assert.equal(scope.auction, false);
  }
});

test("mainnet and unknown environments fail closed to the Stage 7M interface scope", () => {
  for (const environment of ["mainnet", "production", ""]) {
    assert.deepEqual(resolveOfficialFeatureScope(environment), {
      explorer: true,
      studio: true,
      openMintMinter: true,
      market: false,
      seth: false,
      auction: false
    });
  }
});

test("router and header enforce the same application gates", () => {
  assert.match(routerSource, /OFFICIAL_FEATURES\.market/);
  assert.match(routerSource, /OFFICIAL_FEATURES\.seth/);
  assert.match(headerSource, /v-if="OFFICIAL_FEATURES\.market"/);
  assert.match(headerSource, /v-if="OFFICIAL_FEATURES\.seth"/);
});

test("machine-readable candidate scope matches the web feature gate", () => {
  const included = new Set(candidateScope.launch.officialInterfaces);
  const excluded = new Set(candidateScope.excludedMainnetApplications.map((item) => item.id));
  const scope = resolveOfficialFeatureScope("mainnet");
  assert.equal(included.has("explorer"), scope.explorer);
  assert.equal(included.has("studio"), scope.studio);
  assert.equal(included.has("open-mint-minter"), scope.openMintMinter);
  assert.equal(excluded.has("src20-market"), !scope.market);
  assert.equal(excluded.has("seth"), !scope.seth);
  assert.equal(excluded.has("auction"), !scope.auction);
});
