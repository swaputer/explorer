import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as vue from "vue";

const source = readFileSync(new URL("../src/views/MinterView.vue", import.meta.url), "utf8");
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const compiled = ts.transpileModule(`${script}\nexport const harness = { addressInput, contractId, snapshot, loading, mintPhase, loadContract, mint, submitCreator, createdProgram, createPhase };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const addressA = `0x${"11".repeat(32)}`;
const addressB = `0x${"22".repeat(32)}`;
const token = { name: "Public Token", symbol: "PUB", decimals: 18, cap: 100n, mintAmount: 10n, totalSupply: 0n };

function setup(verify = async () => token, query = {}) {
  const mounted = [];
  const errors = [];
  const successes = [];
  const verified = [];
  const minted = [];
  const replacements = [];
  const modules = {
    vue: { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: () => {} },
    "vue-router": { useRoute: () => ({ query }), useRouter: () => ({ replace: async value => replacements.push(value) }) },
    "@/composables/useWallet": { useWallet: () => ({ address: vue.ref("wallet"), signer: vue.ref({}), connect: async () => {} }) },
    "@/composables/useToast": { toast: { error: value => errors.push(value), success: value => successes.push(value) } },
    "@/lib/protocol": {
      verifyOpenMintSRC20: async target => { verified.push(target); return verify(target); },
      friendlyError: error => error.message,
      mintSRC20: async (_signer, _wallet, target, pending) => { minted.push(target); pending(); }
    }
  };
  const context = { exports: {}, require: name => {
    assert.notEqual(name, "@/lib/explorer", "Minter must not depend on a contract directory");
    return modules[name] ?? {};
  }, document: { addEventListener() {}, body: { style: {} } } };
  vm.runInNewContext(compiled, context);
  return { ...context.exports.harness, mounted, errors, successes, verified, minted, replacements };
}

test("starts empty without fetching or auto-selecting a contract", () => {
  const app = setup();
  app.mounted.forEach(fn => fn());
  assert.equal(app.contractId.value, null);
  assert.equal(app.verified.length, 0);
  assert.match(source, /<form class="contract-loader" @submit.prevent="loadContract">/);
  assert.doesNotMatch(source, /mint-directory|selectToken|openMintTokens/);
});

test("loads the entered address directly and preserves shareable links", async () => {
  const app = setup();
  app.addressInput.value = `  ${addressA}  `;
  await app.loadContract();
  assert.deepEqual(app.verified, [addressA]);
  assert.equal(app.contractId.value, addressA);
  assert.equal(app.snapshot.value.symbol, "PUB");
  assert.equal(app.replacements[0].query.contract, addressA);
});

test("a rejected template clears prior eligibility and reports a toast", async () => {
  const app = setup(async target => {
    if (target === addressB) throw new Error("Unsupported public mint template");
    return token;
  });
  app.addressInput.value = addressA;
  await app.loadContract();
  app.addressInput.value = addressB;
  assert.equal(app.snapshot.value, null);
  await app.loadContract();
  assert.equal(app.contractId.value, null);
  assert.deepEqual(app.errors, ["Unsupported public mint template"]);
  await app.mint();
  assert.equal(app.minted.length, 0);
});

test("a stale verification response cannot replace a newer address", async () => {
  let resolveA;
  const app = setup(target => target === addressA ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(token));
  app.addressInput.value = addressA;
  const first = app.loadContract();
  app.addressInput.value = addressB;
  await app.loadContract();
  resolveA({ ...token, symbol: "OLD" });
  await first;
  assert.equal(app.contractId.value, addressB);
  assert.equal(app.snapshot.value.symbol, "PUB");
  assert.equal(app.loading.value, false);
});

test("revalidates before minting and refuses signing if verification fails", async () => {
  let calls = 0;
  const app = setup(async () => {
    if (++calls > 1) throw new Error("ABI validation failed");
    return token;
  });
  app.addressInput.value = addressA;
  await app.loadContract();
  await app.mint();
  assert.equal(app.verified.length, 2);
  assert.equal(app.minted.length, 0);
  assert.deepEqual(app.errors, ["ABI validation failed"]);
});

test("confirmed mint stays confirmed when the supply refresh fails", async () => {
  let calls = 0;
  const app = setup(async () => {
    if (++calls === 3) throw new Error("RPC unavailable");
    return token;
  });
  app.addressInput.value = addressA;
  await app.loadContract();
  await app.mint();
  assert.deepEqual(app.minted, [addressA]);
  assert.equal(app.mintPhase.value, "confirmed");
  assert.deepEqual(app.successes, ["SRC20 minted."]);
  assert.match(app.errors[0], /Mint confirmed/);
});

test("newly created contracts load directly without waiting for indexing", async () => {
  const app = setup();
  app.createdProgram.value = addressB;
  app.createPhase.value = "confirmed";
  await app.submitCreator();
  assert.equal(app.addressInput.value, addressB);
  assert.equal(app.contractId.value, addressB);
});
