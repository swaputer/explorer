<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, Plus, Search } from "@lucide/vue";
import AppFooter from "@/components/AppFooter.vue";
import MarketDialog from "@/components/MarketDialog.vue";
import { toast } from "@/composables/useToast";
import { explorerApi, shortHex, subscribeExplorer, type MarketSummary } from "@/lib/explorer";
import { nativeAmount } from "@/lib/format";

const router = useRouter();
const items = ref<MarketSummary[]>([]);
const query = ref("");
const loading = ref(true);
const orderModal = ref(false);
const orderProgram = ref("");
let unsubscribe: (() => void) | null = null;

const filtered = computed(() => {
  const value = query.value.trim().toLowerCase();
  if (!value) return items.value;
  return items.value.filter((item) => `${item.name} ${item.symbol} ${item.programId}`.toLowerCase().includes(value));
});

function eth(value?: string): string {
  try { return value && BigInt(value) > 0n ? nativeAmount(value) : "—"; }
  catch { return "—"; }
}

async function load() {
  try { items.value = await explorerApi.markets(100); }
  catch { toast.error("Active markets are temporarily unavailable."); }
  finally { loading.value = false; }
}

function submitSearch() {
  const value = query.value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) void router.push(`/market/${value}`);
}

function openOrderMarket() {
  const value = orderProgram.value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return;
  orderModal.value = false;
  void router.push({ path: `/market/${value}`, query: { create: "1" } });
}

onMounted(() => { void load(); unsubscribe = subscribeExplorer(() => void load()); });
onBeforeUnmount(() => { unsubscribe?.(); });
</script>

<template>
  <main class="page market-directory-page market-discovery-page">
    <header class="discovery-heading">
      <h1>Market</h1>
      <form class="discovery-search" @submit.prevent="submitSearch">
      <Search :size="17" aria-hidden="true" />
      <input v-model="query" aria-label="Search markets" placeholder="Search name, symbol or address" spellcheck="false" autocomplete="off" />
      <button v-if="/^0x[0-9a-fA-F]{64}$/.test(query.trim())" type="submit" aria-label="Open market"><ArrowRight :size="16" /></button>
      </form>
      <button type="button" class="discovery-list-button" @click="orderModal = true"><Plus :size="16" />List tokens</button>
    </header>
    <div class="discovery-toolbar">
      <h2>{{ query.trim() ? 'Search results' : 'Active markets' }} <span v-if="!loading" aria-live="polite">{{ filtered.length }}</span></h2>
      <p>Prices in ETH per token</p>
    </div>
    <section class="discovery-results" aria-label="Active SRC20 markets" :aria-busy="loading">
      <div v-if="filtered.length" class="discovery-grid">
        <RouterLink v-for="item in filtered" :key="item.programId" class="market-discovery-card" :to="`/market/${item.programId}`" :aria-label="`Open ${item.symbol || 'SRC20'} market ${item.programId}`">
          <div class="discovery-identity">
            <div class="discovery-title-row">
              <h3 :title="item.name || 'Unnamed token'">{{ item.name || 'Unnamed token' }}</h3>
              <span class="discovery-symbol" :title="item.symbol || 'SRC20'">{{ item.symbol || 'SRC20' }}</span>
            </div>
            <div class="discovery-meta-row">
              <code :title="item.programId">{{ shortHex(item.programId, 12, 10) }}</code>
              <span class="discovery-order-count">{{ item.openOrders.toLocaleString('en-US') }} open {{ item.openOrders === 1 ? 'order' : 'orders' }}</span>
            </div>
          </div>
          <dl class="discovery-quotes">
            <div><dt>Best bid</dt><dd>{{ eth(item.bestBidWei) }}</dd></div>
            <div><dt>Best ask</dt><dd>{{ eth(item.bestAskWei) }}</dd></div>
          </dl>
        </RouterLink>
      </div>
      <div v-else-if="!loading" class="discovery-empty">
        <strong>{{ query ? 'No matching active market' : 'No active markets' }}</strong>
        <span>{{ query ? 'Enter a complete SRC20 program ID to open it directly.' : 'Markets appear here as soon as an open order is indexed.' }}</span>
      </div>
      <p v-else class="discovery-loading" role="status">Loading active markets…</p>
    </section>
    <AppFooter />

    <MarketDialog v-if="orderModal" title="List tokens" @close="orderModal = false">
      <form class="market-composer market-composer-dialog" @submit.prevent="openOrderMarket">
        <p>Enter the SRC20 contract you want to list for sale.</p>
        <label><span>Contract address</span><div><input v-model="orderProgram" spellcheck="false" autocomplete="off" placeholder="0x…" /></div></label>
        <button class="market-submit" type="submit" :disabled="!/^0x[0-9a-fA-F]{64}$/.test(orderProgram.trim())">Continue <ArrowRight :size="14" /></button>
      </form>
    </MarketDialog>
  </main>
</template>

<style scoped>
.discovery-heading { display: grid; grid-template-columns: minmax(0, 1fr) 320px auto; align-items: center; gap: 14px; padding: 26px 0; border-bottom: 1px solid var(--rule); }
.discovery-heading h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -.035em; font-weight: 600; }
.discovery-search { display: flex; align-items: center; min-width: 0; height: 36px; padding-left: 12px; gap: 8px; border: 1px solid var(--rule-strong); border-radius: 6px; color: var(--muted); }
.discovery-search > svg { flex-shrink: 0; }
.discovery-search:focus-within { border-color: var(--blue); }
.discovery-search input { flex: 1; width: 0; min-width: 0; height: 100%; padding: 0 12px 0 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-family: inherit; font-size: 12px; line-height: 1.4; }
.discovery-search button { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; background: transparent; color: var(--blue); }
.discovery-list-button { display: flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 13px; border: 0; border-radius: 6px; background: var(--blue); color: #fff; font-size: 12px; font-weight: 550; white-space: nowrap; }
.discovery-list-button:hover { background: var(--blue-hover); }
.discovery-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0 16px; }
.discovery-toolbar h2 { display: flex; align-items: baseline; gap: 10px; margin: 0; font-size: 13px; font-weight: 550; }
.discovery-toolbar h2 span { color: var(--muted); font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
.discovery-toolbar p { margin: 0; color: var(--muted); font-size: 11px; }
.discovery-results { margin-bottom: 36px; }
.discovery-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.market-discovery-card { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--rule-strong); border-radius: 8px; background: var(--surface); color: var(--ink); text-decoration: none; transition: border-color 150ms; overflow: hidden; }
.market-discovery-card:hover { border-color: var(--blue); }
.market-discovery-card:focus-visible, .discovery-heading button:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
.discovery-identity { padding: 18px 18px 0; }
.discovery-title-row, .discovery-meta-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.discovery-identity h3 { flex: 1; min-width: 0; margin: 0; font-size: 14px; line-height: 1.4; font-weight: 600; letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.discovery-symbol { flex-shrink: 0; max-width: 35%; color: var(--muted); font-size: 12px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.discovery-meta-row { margin-top: 8px; }
.discovery-order-count { flex-shrink: 0; color: var(--muted); font-size: 11px; line-height: 1.4; font-variant-numeric: tabular-nums; white-space: nowrap; }
.discovery-identity code { min-width: 0; color: var(--muted); font-family: var(--font-mono); font-size: 10px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.discovery-quotes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 14px 18px 0; padding: 14px 0; border-top: 1px solid var(--rule); flex: 1; }
.discovery-quotes dt { color: var(--muted); font-size: 11px; }
.discovery-quotes dd { margin: 6px 0 0; font-size: 14px; line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.discovery-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 260px; padding: 24px; gap: 12px; text-align: center; border: 1px dashed var(--rule-strong); border-radius: 8px; }
.discovery-empty strong { font-size: 14px; font-weight: 550; }
.discovery-empty span, .discovery-loading { font-size: 12px; line-height: 1.6; color: var(--muted); }
.discovery-loading { padding: 60px 0; text-align: center; }
@media (max-width: 1100px) { .discovery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 850px) { .discovery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .discovery-heading { grid-template-columns: minmax(0, 1fr) 280px auto; } }
@media (max-width: 640px) {
  .discovery-heading { grid-template-columns: minmax(0, 1fr) auto; gap: 16px 12px; padding: 22px 0; }
  .discovery-heading h1 { font-size: 24px; }
  .discovery-search { grid-column: 1 / -1; grid-row: 2; }
  .discovery-list-button { grid-column: 2; grid-row: 1; }
  .discovery-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .discovery-toolbar { flex-wrap: wrap; gap: 8px; padding-top: 20px; }
  .discovery-toolbar p { font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) { .market-discovery-card { transition: none; } }
</style>
