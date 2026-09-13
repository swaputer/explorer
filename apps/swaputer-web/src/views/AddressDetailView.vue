<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { Check, Copy } from "@lucide/vue";
import SvmTransactionTable from "@/components/SvmTransactionTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toast } from "@/composables/useToast";
import { explorerApi, formatCount, formatUnitsExact, shortHex, type AddressDetail, type TransactionSummary } from "@/lib/explorer";

type AddressTab = "transactions" | "tokens";
const route = useRoute();
const tab = ref<AddressTab>("transactions");
const detail = ref<AddressDetail | null>(null);
const loading = ref(true);
const copied = ref(false);
const page = ref(1);
const pageSize = 25;
const holdingsPage = ref(1);
const holdingsPageSize = 20;
const transactions = ref<TransactionSummary[]>([]);
const cursors = ref<string[]>([""]);
const nextCursor = ref<string | undefined>();
const address = computed(() => String(route.params.address || ""));
const rangeLabel = computed(() => {
  if (!transactions.value.length) return "0 transactions";
  const start = (page.value - 1) * pageSize + 1;
  return `${start}–${start + transactions.value.length - 1} indexed transactions`;
});
const holdingsPageCount = computed(() => Math.ceil((detail.value?.balances.length ?? 0) / holdingsPageSize));
const holdings = computed(() => {
  const start = (holdingsPage.value - 1) * holdingsPageSize;
  return detail.value?.balances.slice(start, start + holdingsPageSize) ?? [];
});
const holdingsRangeLabel = computed(() => {
  const total = detail.value?.balances.length ?? 0;
  if (!total) return "0 token holdings";
  const start = (holdingsPage.value - 1) * holdingsPageSize + 1;
  const end = Math.min(start + holdings.value.length - 1, total);
  return `${start}–${end} of ${formatCount(total)} token holdings`;
});

async function load() {
  loading.value = true;
  tab.value = "transactions";
  page.value = 1;
  holdingsPage.value = 1;
  cursors.value = [""];
  nextCursor.value = undefined;
  try {
    detail.value = await explorerApi.address(address.value);
    await loadTransactions();
  } catch {
    detail.value = null;
    transactions.value = [];
    toast.error("Address not found in the SVM index.");
  } finally { loading.value = false; }
}

function selectTab(nextTab: AddressTab) {
  if (tab.value === nextTab) return;
  tab.value = nextTab;
  if (nextTab === "tokens") {
    holdingsPage.value = 1;
    return;
  }
  if (page.value === 1) return;
  page.value = 1;
  cursors.value = [""];
  nextCursor.value = undefined;
  void loadTransactions();
}

async function loadTransactions() {
  const result = await explorerApi.addressTransactions(address.value, pageSize, cursors.value[page.value - 1]);
  transactions.value = result.items;
  nextCursor.value = result.nextCursor;
}

function previous() {
  if (page.value === 1 || loading.value) return;
  page.value -= 1;
  void loadTransactions();
}

function next() {
  if (!nextCursor.value || loading.value) return;
  cursors.value = cursors.value.slice(0, page.value);
  cursors.value.push(nextCursor.value);
  page.value += 1;
  nextCursor.value = undefined;
  void loadTransactions();
}

async function copyAddress() {
  if (!detail.value) return;
  await navigator.clipboard?.writeText(detail.value.accountId);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1_200);
}

onMounted(load);
watch(address, load);
</script>

<template>
  <main class="page explorer-page explorer-detail-page address-detail-page">
    <div class="directory-topline explorer-detail-topline address-detail-topline">
      <header class="detail-heading address-detail-heading">
        <h1>Address</h1>
        <template v-if="detail">
          <div class="entity-id address-identity"><code :title="detail.accountId">{{ shortHex(detail.accountId, 24, 18) }}</code><button type="button" aria-label="Copy address" @click="copyAddress"><Check v-if="copied" :size="15" /><Copy v-else :size="15" /></button><span class="address-transaction-count">{{ formatCount(detail.transactionCount ?? detail.transactions.length) }} indexed transactions</span></div>
          <p v-if="detail.evmAddress">Mapped EVM address: <code>{{ detail.evmAddress }}</code></p>
        </template>
      </header>
    </div>
    <p v-if="loading" class="protocol-loading protocol-loading--page">Loading address…</p>

    <template v-if="detail">
      <nav class="entity-tabs address-entity-tabs" aria-label="Address data">
        <button type="button" :class="{ active: tab === 'transactions' }" @click="selectTab('transactions')">Transactions</button>
        <button type="button" :class="{ active: tab === 'tokens' }" @click="selectTab('tokens')">Token holdings</button>
      </nav>

      <section v-if="tab === 'transactions'" class="protocol-section entity-table-section address-transactions-section">
        <SvmTransactionTable :items="transactions" />
        <TablePagination v-if="transactions.length" :page="page" :has-next="Boolean(nextCursor)" :label="rangeLabel" @previous="previous" @next="next" />
      </section>
      <section v-else class="protocol-section entity-table-section address-holdings-section">
        <div class="protocol-table-wrap"><table class="protocol-table holdings-table">
          <thead><tr><th>Token</th><th>Symbol</th><th>Balance</th><th class="hide-small">Address</th><th class="hide-small">Total supply</th></tr></thead>
          <tbody>
            <tr v-for="balance in holdings" :key="balance.programId">
              <td><RouterLink class="protocol-link" :to="`/contract/${balance.programId}`">{{ balance.name || 'Unnamed token' }}</RouterLink></td>
              <td class="protocol-mono">{{ balance.symbol || '—' }}</td>
              <td class="protocol-mono">{{ formatUnitsExact(balance.balance, balance.decimals) }}</td>
              <td class="protocol-mono hide-small"><RouterLink class="protocol-link" :to="`/contract/${balance.programId}`">{{ shortHex(balance.programId, 10, 8) }}</RouterLink></td>
              <td class="protocol-mono hide-small">{{ formatUnitsExact(balance.totalSupply, balance.decimals) }}</td>
            </tr>
            <tr v-if="!detail.balances.length"><td colspan="5" class="protocol-empty-row">This address holds no indexed tokens.</td></tr>
          </tbody>
        </table></div>
        <TablePagination
          v-if="detail.balances.length"
          :page="holdingsPage"
          :page-count="holdingsPageCount"
          :label="holdingsRangeLabel"
          @previous="holdingsPage -= 1"
          @next="holdingsPage += 1"
        />
      </section>
    </template>
  </main>
</template>
