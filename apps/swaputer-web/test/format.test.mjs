import assert from "node:assert/strict";
import test from "node:test";

import { tokenAmount } from "../src/lib/format.ts";

test("formats token units without a wallet or Ethereum runtime dependency", () => {
  assert.equal(tokenAmount("1234567890000000000000", 18, 6), "1,234.56789");
  assert.equal(tokenAmount(42n, 0, 6), "42");
  assert.equal(tokenAmount(1n, 18, 6), "<0.000001");
  assert.equal(tokenAmount(-1n, 18, 6), "-<0.000001");
  assert.equal(tokenAmount("invalid", 18, 6), "—");
  assert.equal(tokenAmount(1n, -1, 6), "—");
  assert.equal(tokenAmount(1n, 18, 101), "—");
});
