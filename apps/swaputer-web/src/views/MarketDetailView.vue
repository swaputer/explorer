<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ArrowLeft, Check, ChevronDown, Copy, FileText, LoaderCircle, Plus, Wallet } from "@lucide/vue";
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import AppFooter from "@/components/AppFooter.vue";
import TablePagination from "@/components/TablePagination.vue";
import MarketOrderRow from "@/components/MarketOrderRow.vue";
import MarketDialog from "@/components/MarketDialog.vue";
import { useWallet } from "@/composables/useWallet";
import { toast } from "@/composables/useToast";
import { explorerApi, formatAge, formatUnitsExact, shortHex, subscribeExplorer, type MarketOrder, type MarketSummary, type MarketTrade, type TokenSummary } from "@/lib/explorer";
import { cancelMarketOrder, createMarketForToken, createOrder, marketBindingFor, quotePriceWei, settleOrder } from "@/lib/market";
import { friendlyError, readAccountId, readMiniUint, readProtocolFeeConfig, type ProtocolFeeConfig } from "@/lib/protocol";
import { useCursorTable } from "@/composables/useCursorTable";
import { MARKET } from "@/lib/config";
import { nativeAmount } from "@/lib/format";

const route = useRoute();
const wallet = useWallet();
const program = computed(() => String(route.params.program));
const token = ref<TokenSummary | null>(null);
const summary = ref<MarketSummary | null>(null);
const side = ref<"sell" | "buy">("buy");
const createSide = ref<"buy" | "sell">("sell");
const view = ref<"buy" | "sell" | "activity" | "mine">("buy");
const createModal = ref(false);
const selectedOrder = ref<MarketOrder | null>(null);
const amount = ref("");
const price = ref("");
const vmBudget = ref(formatEther(MARKET.defaultVMInputWei));
const advanced = ref(false);
const loading = ref(true);
const busy = ref(false);
const marketModal = ref(false);
const marketPhase = ref<"idle" | "deploying-escrow" | "creating-market" | "confirmed">("idle");
const pageSize = 25;
const reportError = (cause: unknown) => toast.error(friendlyError(cause));
const orderTable = useCursorTable<MarketOrder>((cursor) => explorerApi.marketOrders(program.value, { status: "open", side: side.value, limit: pageSize, cursor }), reportError);
const tradeTable = useCursorTable<MarketTrade>((cursor) => explorerApi.marketTrades(program.value, pageSize, cursor), reportError);
const myOrderTable = useCursorTable<MarketOrder>((cursor) => explorerApi.marketOrders(program.value, { status: "open", maker: wallet.address.value!, limit: pageSize, cursor }), reportError);
const tokenBalance = ref<bigint | null>(null);
const balanceLoading = ref(false);
const amountInput = ref<HTMLInputElement | null>(null);
const copied = ref(false);
const feeConfig = ref<ProtocolFeeConfig | null>(null);
const now = ref(Date.now());
let unsubscribe: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | undefined;
let loadVersion = 0;
let balanceVersion = 0;
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const symbol = computed(() => summary.value?.symbol || token.value?.symbol || "SRC20");
const decimals = computed(() => summary.value?.decimals ?? token.value?.decimals ?? 18);
const activeTable = computed(() => view.value === "activity" ? tradeTable : view.value === "mine" ? myOrderTable : orderTable);
const visibleOrders = computed(() => view.value === "mine" ? myOrderTable.items : orderTable.items);
const range = computed(() => pageRange(activeTable.value.page, activeTable.value.items.length, view.value === "activity" ? "trades" : "orders"));
const isOwnOrder = (order: MarketOrder) => order.maker.toLowerCase() === wallet.address.value?.toLowerCase();
const selectedIsOwn = computed(() => selectedOrder.value ? isOwnOrder(selectedOrder.value) : false);
const confirmationTitle = computed(() => selectedIsOwn.value ? "Cancel order" : `${selectedOrder.value?.side === "buy" ? "Sell" : "Buy"} ${symbol.value}`);
const confirmationLabel = computed(() => selectedIsOwn.value ? "Confirm cancellation" : selectedOrder.value?.side === "buy" ? "Confirm sale" : "Confirm purchase");
const selectedExpired = computed(() => !!selectedOrder.value && selectedOrder.value.expiry * 1000 <= now.value);
const selectedVM = computed(() => !selectedOrder.value || selectedOrder.value.side === "buy" ? 0n : selectedIsOwn.value ? MARKET.defaultVMInputWei : BigInt(selectedOrder.value.vmEthAmount));
const selectedPayment = computed(() => selectedVM.value + (selectedOrder.value?.side === "sell" && !selectedIsOwn.value ? BigInt(selectedOrder.value.priceWei) : 0n));
const selectedProtocolFee = computed(() => selectedVM.value * BigInt(feeConfig.value?.feeBps ?? 0) / 10_000n);
const draft = computed(() => {
  try {
    const tokenAmount = parseUnits(amount.value || "0", decimals.value);
    const unitPrice = parseEther(price.value || "0");
    const vm = parseEther(vmBudget.value || "0");
    return { amount: tokenAmount, unitPrice, vm, total: quotePriceWei(tokenAmount, unitPrice), valid: vm > 0n };
  } catch { return { amount: 0n, unitPrice: 0n, vm: 0n, total: 0n, valid: false }; }
});
const draftProtocolFee = computed(() => draft.value.vm * BigInt(feeConfig.value?.feeBps ?? 0) / 10_000n);

function priceETH(value: string): string {
  return nativeAmount(value);
}

function pageRange(page: number, count: number, label: string): string {
  if (!count) return `0 ${label}`;
  const start = (page - 1) * pageSize + 1;
  return `${start}–${start + count - 1} ${label}`;
}

async function refreshBalance() {
  const request = ++balanceVersion;
  const actor = wallet.address.value;
  const target = program.value;
  if (!actor) { tokenBalance.value = null; balanceLoading.value = false; return; }
  balanceLoading.value = true;
  try {
    const account = await readAccountId(actor);
    const value = await readMiniUint(target, "balanceOf(bytes32)", ["bytes32"], [account]);
    if (request === balanceVersion) tokenBalance.value = value;
  } catch { if (request === balanceVersion) tokenBalance.value = null; }
  finally { if (request === balanceVersion) balanceLoading.value = false; }
}

async function refreshTables() {
  if (!summary.value || loading.value) return;
  await Promise.all([orderTable.load(), tradeTable.load(), wallet.address.value ? myOrderTable.load() : Promise.resolve()]);
}

async function load() {
  const request = ++loadVersion;
  const target = program.value;
  loading.value = true;
  createModal.value = false; selectedOrder.value = null;
  token.value = null;
  summary.value = null;
  tokenBalance.value = null;
  orderTable.reset(); tradeTable.reset(); myOrderTable.reset();
  try {
    const [result, fees] = await Promise.all([
      explorerApi.token(target),
      readProtocolFeeConfig().catch(() => null)
    ]);
    if (request !== loadVersion) return;
    token.value = result;
    feeConfig.value = fees;
    let binding: MarketSummary | null;
    try { binding = await explorerApi.market(target); }
    catch {
      const found = await marketBindingFor(target);
      binding = found ? { programId: target, ...found, name: result.name, symbol: result.symbol, decimals: result.decimals, openOrders: 0 } : null;
    }
    if (request !== loadVersion) return;
    summary.value = binding;
    loading.value = false;
    await Promise.all([refreshTables(), refreshBalance()]);
    if (request === loadVersion && route.query.create === "1") {
      if (summary.value) openCreate();
      else marketModal.value = true;
    }
  } catch (cause) { if (request === loadVersion) reportError(cause); }
  finally { if (request === loadVersion) loading.value = false; }
}

function selectSide(next: "buy" | "sell") {
  view.value = next;
  if (side.value === next) return;
  side.value = next;
  orderTable.reset();
  void orderTable.load();
}

function expiresIn(expiry: number): string {
  const seconds = Math.max(0, expiry - Math.floor(now.value / 1000));
  if (!seconds) return "Expired";
  if (seconds < 60) return "<1m left";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m left`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h left`;
  return `${Math.floor(seconds / 86400)}d left`;
}

async function copyContract() {
  try {
    await navigator.clipboard.writeText(program.value);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = false; }, 1500);
  } catch { toast.error("Could not copy the contract address."); }
}

async function ensureWallet(): Promise<boolean> {
  if (!wallet.address.value || !wallet.signer.value) await wallet.connect();
  return Boolean(wallet.address.value && wallet.signer.value);
}

function openCreate(direction: "buy" | "sell" = "sell") {
  createSide.value = direction;
  createModal.value = true;
  void nextTick(() => amountInput.value?.focus());
}

async function submitOrder() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!wallet.address.value || !wallet.signer.value) { await ensureWallet(); return; }
    if (!summary.value || !draft.value.valid) return;
    const target = program.value;
    const direction = createSide.value;
    await createOrder(wallet.signer.value, wallet.address.value, target, summary.value.marketAddress, summary.value.escrowId,
      direction, draft.value.amount, draft.value.unitPrice, draft.value.vm,
      BigInt(Math.floor(Date.now() / 1000) + MARKET.defaultExpirySeconds));
    if (program.value === target) {
      amount.value = ""; price.value = "";
      createModal.value = false;
      selectSide(direction);
    }
    toast.success(`${direction === "buy" ? "Buy" : "Sell"} order created.`);
    await Promise.all([refreshTables(), refreshBalance()]);
  } catch (cause) { toast.error(friendlyError(cause)); }
  finally { busy.value = false; }
}

async function confirmOrder() {
  if (busy.value || !selectedOrder.value) return;
  busy.value = true;
  try {
    if (!wallet.address.value || !wallet.signer.value) { await ensureWallet(); return; }
    const order = selectedOrder.value;
    if (!order || !summary.value || order.programId.toLowerCase() !== program.value.toLowerCase()
      || order.marketAddress.toLowerCase() !== summary.value.marketAddress.toLowerCase()) return;
    const own = isOwnOrder(order);
    if (!own && order.expiry * 1000 <= Date.now()) { toast.error("This order has expired."); return; }
    if (own) await cancelMarketOrder(wallet.signer.value, wallet.address.value, order, summary.value.escrowId);
    else await settleOrder(wallet.signer.value, wallet.address.value, order, summary.value.escrowId);
    selectedOrder.value = null;
    toast.success(own ? "Order cancelled." : "Order settled.");
    await Promise.all([refreshTables(), refreshBalance()]);
  } catch (cause) { toast.error(friendlyError(cause)); }
  finally { busy.value = false; }
}

async function deployMarket() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!wallet.address.value || !wallet.signer.value) { await ensureWallet(); return; }
    await createMarketForToken(wallet.signer.value!, wallet.address.value!, program.value, (phase) => { marketPhase.value = phase; });
    marketPhase.value = "confirmed";
    toast.success("SRC20 market created.");
    await load();
    marketModal.value = false;
  } catch (cause) { toast.error(friendlyError(cause)); marketPhase.value = "idle"; }
  finally { busy.value = false; }
}

function actionLabel(order: MarketOrder): string {
  if (!wallet.address.value) return `${order.side === "sell" ? "Buy" : "Sell"} ${symbol.value}`;
  if (order.maker.toLowerCase() === wallet.address.value.toLowerCase()) return "Cancel";
  return `${order.side === "sell" ? "Buy" : "Sell"} ${symbol.value}`;
}

watch(program, () => void load());
watch(wallet.address, (_address, previous) => {
  if (previous) selectedOrder.value = null;
  myOrderTable.reset();
  tokenBalance.value = null;
  if (wallet.address.value && summary.value) void myOrderTable.load();
  void refreshBalance();
});
onMounted(() => {
  void load();
  unsubscribe = subscribeExplorer(() => { void refreshTables(); void refreshBalance(); });
  clock = setInterval(() => { now.value = Date.now(); }, 30_000);
});
onBeforeUnmount(() => {
  ++loadVersion; ++balanceVersion;
  orderTable.reset(); tradeTable.reset(); myOrderTable.reset();
  unsubscribe?.();
  if (clock) clearInterval(clock);
  if (copyTimer) clearTimeout(copyTimer);
});
</script>


<template>
  <main class="page market-detail-page market-gallery-page">
    <RouterLink class="market-back" to="/market"><ArrowLeft :size="15" />All markets</RouterLink>
    <header class="market-token-heading">
      <div class="market-token-identity"><div class="market-token-title"><h1>{{ symbol }}</h1><p>{{ token?.name || 'SRC20' }}</p></div><div class="market-contract-line"><RouterLink :to="`/contract/${program}`"><code>{{ shortHex(program, 15, 12) }}</code></RouterLink><button class="market-copy" type="button" aria-label="Copy contract address" @click="copyContract"><Check v-if="copied" :size="15" /><Copy v-else :size="15" /></button></div></div>
      <div v-if="summary" class="market-heading-actions"><button class="market-offer-button" type="button" :disabled="busy" @click="openCreate('buy')">Make an offer</button><button class="market-create-button" type="button" :disabled="busy" @click="openCreate('sell')"><Plus :size="15" />List tokens</button></div>
      <button v-else-if="token && !loading" class="market-create-button" type="button" @click="marketModal = true"><Plus :size="15" />Create market</button>
    </header>
    <p v-if="loading" class="protocol-loading">Loading market…</p>

    <template v-if="summary">
      <nav class="market-gallery-tabs" aria-label="Market views">
        <button type="button" :aria-pressed="view === 'buy'" @click="selectSide('buy')">Buy orders</button>
        <button type="button" :aria-pressed="view === 'sell'" @click="selectSide('sell')">Sell orders</button>
        <button type="button" :aria-pressed="view === 'activity'" @click="view = 'activity'">Activity</button>
        <button type="button" :aria-pressed="view === 'mine'" @click="view = 'mine'">My orders</button>
      </nav>
      <section class="market-gallery-content" :aria-busy="activeTable.loading">
        <div class="market-gallery-context"><p>{{ view === 'buy' ? `Sell ${symbol} to an existing buy order.` : view === 'sell' ? `Buy ${symbol} from an existing sell order.` : view === 'activity' ? 'Completed trades in this market.' : 'Manage your open buy and sell orders.' }}</p><LoaderCircle v-if="activeTable.loading" class="spin" :size="15" /></div>
        <div class="market-gallery-scroll">
          <div v-if="view === 'mine' && !wallet.address.value" class="market-gallery-empty"><Wallet :size="28" /><h2>Connect your wallet</h2><p>Connect to view and manage your orders.</p><button class="market-row-action" type="button" @click="wallet.connect">Connect wallet</button></div>
          <div v-else-if="!activeTable.items.length" class="market-gallery-empty"><LoaderCircle v-if="activeTable.loading" class="spin" :size="28" /><FileText v-else :size="28" /><h2>{{ activeTable.loading ? 'Loading…' : view === 'activity' ? 'No trades yet' : 'No open orders' }}</h2><p v-if="!activeTable.loading">{{ view === 'activity' ? 'Completed trades will appear here.' : view === 'mine' ? 'Your open orders will appear here.' : `Be the first to create a ${side} order.` }}</p><button v-if="!activeTable.loading && view !== 'activity'" class="market-row-action" type="button" @click="openCreate(view === 'mine' ? 'sell' : side)">{{ view === 'buy' ? 'Make an offer' : 'List tokens' }}</button></div>
          <div v-else-if="view === 'activity'" class="protocol-table-wrap market-trades-table"><table>
            <thead><tr><th>Time</th><th>Amount ({{ symbol }})</th><th>Total (ETH)</th><th>Buyer</th><th>Seller</th><th>Transaction</th></tr></thead>
            <tbody><tr v-for="trade in tradeTable.items" :key="`${trade.transactionHash}-${trade.orderId}`"><td>{{ formatAge(trade.blockTime) }}</td><td>{{ formatUnitsExact(trade.amount, decimals, 5) }}</td><td>{{ priceETH(trade.priceWei) }}</td><td><RouterLink :to="`/address/${trade.buyer}`">{{ shortHex(trade.buyer, 8, 6) }}</RouterLink></td><td><RouterLink :to="`/address/${trade.seller}`">{{ shortHex(trade.seller, 8, 6) }}</RouterLink></td><td><RouterLink :to="`/tx/${trade.transactionHash}`">{{ shortHex(trade.transactionHash, 9, 7) }}</RouterLink></td></tr></tbody>
          </table></div>
          <div v-else class="market-order-list" role="table" :aria-label="view === 'mine' ? 'My orders' : `${side === 'buy' ? 'Buy' : 'Sell'} orders`">
            <div class="market-order-head" role="row"><span role="columnheader">Amount</span><span role="columnheader">Total price</span><span role="columnheader">Maker</span><span role="columnheader">Expires</span><span role="columnheader" aria-label="Action"></span></div>
            <div role="rowgroup"><MarketOrderRow v-for="order in visibleOrders" :key="order.orderId" :order="order" :symbol="symbol" :decimals="decimals" :expiry="expiresIn(order.expiry)" :action="actionLabel(order)" :mine="isOwnOrder(order)" :disabled="busy || activeTable.loading || (!isOwnOrder(order) && order.expiry * 1000 <= now)" @select="selectedOrder = $event" /></div>
          </div>
        </div>
        <TablePagination v-if="activeTable.page > 1 || activeTable.nextCursor" :busy="activeTable.loading" :page="activeTable.page" :has-next="Boolean(activeTable.nextCursor)" :label="range" @previous="activeTable.previous" @next="activeTable.next" />
      </section>
    </template>
    <section v-else-if="token && !loading" class="market-missing"><h2>No market yet</h2><p>Create a market for {{ token.symbol || 'this SRC20' }} to start trading.</p><button @click="marketModal = true"><Plus :size="15" />Create SRC20 market</button></section>
    <AppFooter />

    <MarketDialog v-if="createModal && summary" :title="createSide === 'sell' ? 'List tokens' : 'Make an offer'" :busy="busy" @close="createModal = false">
      <form class="market-composer market-composer-dialog" @submit.prevent="submitOrder">
          <div class="market-side-switch"><button type="button" :disabled="busy" :aria-pressed="createSide === 'buy'" :class="{ active: createSide === 'buy' }" @click="createSide = 'buy'">Buy</button><button type="button" :disabled="busy" :aria-pressed="createSide === 'sell'" :class="{ active: createSide === 'sell' }" @click="createSide = 'sell'">Sell</button></div>
          <label><span>Amount</span><small v-if="wallet.address.value">{{ balanceLoading ? 'Loading balance…' : tokenBalance === null ? 'Balance unavailable' : `Balance: ${formatUnitsExact(tokenBalance.toString(), decimals, 5)} ${symbol}` }}</small><div><input ref="amountInput" v-model="amount" :disabled="busy" inputmode="decimal" placeholder="0.0" /><b>{{ symbol }}</b></div></label>
          <label><span>Price per token</span><div><input v-model="price" :disabled="busy" inputmode="decimal" placeholder="0.0" /><b>ETH</b></div></label>
          <dl><div><dt>Total price</dt><dd>{{ nativeAmount(draft.total, 18) }} ETH</dd></div></dl>
          <button class="market-advanced" type="button" :disabled="busy" :aria-expanded="advanced" @click="advanced = !advanced">Advanced settings <ChevronDown :size="14" /></button>
          <label v-if="advanced"><span>VM execution budget</span><div><input v-model="vmBudget" :disabled="busy" inputmode="decimal" /><b>ETH</b></div></label>
          <dl v-if="advanced && feeConfig"><div><dt>Protocol fee ({{ feeConfig.feeBps / 100 }}%)</dt><dd>{{ nativeAmount(draftProtocolFee, 18) }} ETH</dd></div></dl>
          <button class="market-submit" type="button" :disabled="busy || (wallet.address.value ? !draft.valid : false)" @click="submitOrder"><LoaderCircle v-if="busy" class="spin" :size="17" /><Wallet v-else-if="!wallet.address.value" :size="16" /><Plus v-else :size="16" />{{ busy ? 'Confirming…' : wallet.address.value ? (createSide === 'sell' ? 'List tokens' : 'Make an offer') : 'Connect wallet' }}</button>
          <p>{{ createSide === 'buy' ? 'ETH is held in escrow until filled or cancelled.' : `${symbol} is held in escrow until filled or cancelled.` }}</p>

      </form>
    </MarketDialog>
    <MarketDialog v-if="selectedOrder" :title="confirmationTitle" :busy="busy" @close="selectedOrder = null">
      <p class="market-confirm-order">Order #{{ selectedOrder.orderId }}</p>
      <div class="market-confirm-quantity"><strong>{{ formatUnits(selectedOrder.amount, decimals) }}</strong><span>{{ symbol }}</span></div>
      <dl class="market-confirm-details">
        <div><dt>{{ selectedIsOwn ? 'Order total' : selectedOrder.side === 'buy' ? 'You receive' : 'Order price' }}</dt><dd>{{ formatEther(selectedOrder.priceWei) }} ETH</dd></div>
        <div><dt>Price per token</dt><dd>{{ formatEther(selectedOrder.unitPriceWei) }} ETH</dd></div>
        <div><dt>Maker</dt><dd><RouterLink :to="`/address/${selectedOrder.maker}`">{{ shortHex(selectedOrder.maker, 8, 6) }}</RouterLink></dd></div>
        <div><dt>Expires</dt><dd :title="new Date(selectedOrder.expiry * 1000).toLocaleString()">{{ expiresIn(selectedOrder.expiry) }}</dd></div>
        <div v-if="selectedVM > 0n"><dt>VM execution budget</dt><dd>{{ formatEther(selectedVM) }} ETH</dd></div>
        <div v-if="selectedVM > 0n && feeConfig"><dt>Protocol fee ({{ feeConfig.feeBps / 100 }}%)</dt><dd>{{ formatEther(selectedProtocolFee) }} ETH</dd></div>
        <div v-if="selectedPayment > 0n"><dt>Wallet payment</dt><dd>{{ formatEther(selectedPayment) }} ETH</dd></div>
      </dl>
      <p class="market-confirm-note">{{ selectedIsOwn ? 'Unfilled escrow is returned when you cancel.' : 'This order is filled in full.' }} Network gas is additional.</p>
      <button class="market-submit" type="button" :disabled="busy || (!selectedIsOwn && selectedExpired)" @click="confirmOrder"><LoaderCircle v-if="busy" class="spin" :size="17" />{{ busy ? 'Confirming…' : !selectedIsOwn && selectedExpired ? 'Order expired' : !wallet.address.value ? 'Connect wallet' : confirmationLabel }}</button>
    </MarketDialog>
    <MarketDialog v-if="marketModal" title="Create SRC20 market" :busy="busy" @close="marketModal = false">
      <p class="market-confirm-note">Create a market for {{ token?.symbol || 'this SRC20' }}. Deploying the escrow and registering the market requires two wallet transactions.</p>
      <button class="market-submit" type="button" :disabled="busy" @click="deployMarket"><LoaderCircle v-if="busy" class="spin" :size="16" />{{ !wallet.address.value ? 'Connect wallet' : marketPhase === 'creating-market' ? 'Creating market…' : marketPhase === 'deploying-escrow' ? 'Deploying escrow…' : 'Create market' }}</button>
    </MarketDialog>
  </main>
</template>

<style scoped>
/* One aligned list; directory, shell and modal styles remain unchanged. */
.market-gallery-page .market-back { margin: 18px 0 8px; font-size: 11px; }
.market-gallery-page .market-token-heading { padding: 8px 0 18px; gap: 18px; }
.market-token-identity { min-width: 0; }
.market-token-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.market-gallery-page .market-token-heading h1 { font-size: 22px; font-weight: 600; overflow-wrap: anywhere; }
.market-gallery-page .market-token-heading p { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.market-contract-line { margin-top: 8px; }
.market-heading-actions { gap: 8px; }
.market-gallery-page .market-offer-button,
.market-gallery-page .market-create-button { min-height: 34px; padding: 0 12px; border-radius: 6px; font-size: 12px; }
.market-gallery-tabs { gap: 24px; }
.market-gallery-tabs button { height: 40px; font-size: 12px; }
.market-gallery-context { min-height: 44px; }
.market-gallery-context p { font-size: 11px; }
.market-order-list { --order-columns: minmax(0, 1.1fr) minmax(0, 1.4fr) minmax(0, 1.2fr) minmax(0, .8fr) 100px; overflow: hidden; border: 1px solid var(--rule); border-radius: 10px; background: var(--surface); }
.market-order-head { display: grid; grid-template-columns: var(--order-columns); align-items: center; gap: 24px; min-height: 40px; padding: 8px 20px; color: var(--muted); font-size: 11px; }
.market-gallery-content > :deep(.table-pagination) { min-height: 48px; margin-top: 14px; }
.market-gallery-empty { min-height: 240px; gap: 10px; padding: 24px 16px; }
.market-gallery-empty h2 { font-size: 14px; }
.market-trades-table { border-radius: 8px; }
.market-trades-table th { padding: 12px 14px; }
.market-trades-table td { padding: 14px; }
@media (max-width: 900px) { .market-order-head { gap: 16px; padding-inline: 16px; } }
@media (max-width: 680px) {
  .market-order-head { position: absolute; width: 1px; height: 1px; min-height: 0; padding: 0; overflow: hidden; clip-path: inset(50%); }
  .market-gallery-page .market-token-heading { gap: 14px; }
  .market-gallery-page .market-token-heading { flex-wrap: wrap; }
  .market-heading-actions { width: 100%; }
  .market-heading-actions > button { flex: 1; justify-content: center; }
  .market-gallery-tabs { gap: 20px; }
  .market-gallery-tabs button,
  .market-gallery-page .market-heading-actions > button { min-height: 40px; }
}
</style>
