import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as vue from 'vue';
import * as ethers from 'ethers';

const source = readFileSync(new URL('../src/views/MarketDetailView.vue', import.meta.url), 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const compiled = ts.transpileModule(`${script}\nexport const harness = { selectedOrder, summary, createModal, createSide, amount, price, busy, confirmOrder, submitOrder, selectedPayment, selectedVM, selectedIsOwn, confirmationLabel };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const actor = `0x${'11'.repeat(20)}`;
const program = `0x${'22'.repeat(32)}`;
const marketAddress = `0x${'33'.repeat(20)}`;
const seed = { orderId: '1', programId: program, marketAddress, maker: `0x${'44'.repeat(20)}`, side: 'buy', amount: '1000000000000000000', priceWei: '1000', unitPriceWei: '1000', vmEthAmount: '50', expiry: Math.floor(Date.now() / 1000) + 3600 };

function setup({ connected = true, settle = async () => {}, create = async () => {} } = {}) {
  const calls = []; const errors = [];
  const wallet = { address: vue.ref(connected ? actor : null), signer: vue.shallowRef(connected ? {} : null), connect: async () => { calls.push('connect'); wallet.address.value = actor; wallet.signer.value = {}; } };
  const modules = {
    vue: { ...vue, watch: () => {}, onMounted: () => {}, onBeforeUnmount: () => {} },
    ethers,
    'vue-router': { useRoute: () => ({ params: { program }, query: {} }) },
    '@/composables/useWallet': { useWallet: () => wallet },
    '@/composables/useToast': { toast: { success() {}, error: message => errors.push(message) } },
    '@/composables/useCursorTable': { useCursorTable: () => vue.shallowReactive({ page: 1, items: [], loading: false, reset() {}, load: async () => {} }) },
    '@/lib/config': { MARKET: { defaultVMInputWei: 10n, defaultExpirySeconds: 3600 } },
    '@/lib/market': {
      quotePriceWei: (amount, price) => { if (amount <= 0n || price <= 0n) throw new Error('Invalid'); return amount * price / 10n ** 18n; },
      settleOrder: async (...args) => { calls.push('settle'); return settle(...args); },
      cancelMarketOrder: async () => { calls.push('cancel'); },
      createOrder: async (...args) => { calls.push('create'); return create(...args); }
    },
    '@/lib/protocol': { readAccountId: async () => actor, readMiniUint: async () => 0n, friendlyError: e => e.message }
  };
  const context = { exports: {}, require: name => modules[name] ?? {} };
  vm.runInNewContext(compiled, context);
  const app = context.exports.harness;
  app.summary.value = { programId: program, marketAddress, escrowId: program, symbol: 'OMS', decimals: 18 };
  return { ...app, calls, errors, wallet };
}

test('reviewing an order never signs; connecting requires a separate confirmation', async () => {
  const app = setup({ connected: false });
  app.selectedOrder.value = { ...seed };
  assert.deepEqual(app.calls, []);
  await app.confirmOrder();
  assert.deepEqual(app.calls, ['connect']);
  assert.ok(app.selectedOrder.value);
  await app.confirmOrder();
  assert.deepEqual(app.calls, ['connect', 'settle']);
  assert.equal(app.selectedOrder.value, null);
});

test('purchase review includes exact order value plus VM execution payment', () => {
  const app = setup();
  app.selectedOrder.value = { ...seed, side: 'sell' };
  assert.equal(app.selectedVM.value, 50n);
  assert.equal(app.selectedPayment.value, 1050n);
  assert.equal(app.confirmationLabel.value, 'Confirm purchase');
  app.selectedOrder.value = { ...seed };
  assert.equal(app.selectedPayment.value, 0n, 'seller fills a buy order without sending ETH value');
});

test('own sell orders cancel, including expired ones, with cancellation execution budget', async () => {
  const app = setup();
  app.selectedOrder.value = { ...seed, maker: actor, side: 'sell', expiry: 1 };
  assert.equal(app.selectedIsOwn.value, true);
  assert.equal(app.selectedPayment.value, 10n);
  await app.confirmOrder();
  assert.deepEqual(app.calls, ['cancel']);
});

test('expired orders and wrong-market targets cannot be submitted', async () => {
  const app = setup();
  app.selectedOrder.value = { ...seed, expiry: 1 };
  await app.confirmOrder();
  assert.match(app.errors[0], /expired/);
  app.selectedOrder.value = { ...seed, marketAddress: actor };
  await app.confirmOrder();
  assert.deepEqual(app.calls, []);
});

test('double confirmation submits once and rejection keeps review available', async () => {
  let reject;
  const app = setup({ settle: () => new Promise((_, fail) => { reject = fail; }) });
  app.selectedOrder.value = { ...seed };
  const first = app.confirmOrder();
  await app.confirmOrder();
  assert.deepEqual(app.calls, ['settle']);
  reject(new Error('user rejected action'));
  await first;
  assert.equal(app.busy.value, false);
  assert.ok(app.selectedOrder.value);
  assert.deepEqual(app.errors, ['user rejected action']);
});

test('create order connects without immediately creating, then closes only after success', async () => {
  const app = setup({ connected: false });
  app.createModal.value = true;
  app.amount.value = '1000'; app.price.value = '0.000001';
  await app.submitOrder();
  assert.deepEqual(app.calls, ['connect']);
  assert.equal(app.createModal.value, true);
  await app.submitOrder();
  assert.deepEqual(app.calls, ['connect', 'create']);
  assert.equal(app.createModal.value, false);
});

test('creation rejection preserves the draft for retry and prevents duplicate submission', async () => {
  let reject;
  const app = setup({ create: () => new Promise((_, fail) => { reject = fail; }) });
  app.createModal.value = true;
  app.amount.value = '1000'; app.price.value = '0.000001';
  const first = app.submitOrder();
  await app.submitOrder();
  assert.deepEqual(app.calls, ['create']);
  reject(new Error('user rejected action'));
  await first;
  assert.equal(app.createModal.value, true);
  assert.equal(app.amount.value, '1000');
  assert.equal(app.busy.value, false);
});
