<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Check, Copy } from "@lucide/vue";
import AppFooter from "@/components/AppFooter.vue";
import { toast } from "@/composables/useToast";
import ExplorerSearch from "@/components/ExplorerSearch.vue";
import SvmTransactionTable from "@/components/SvmTransactionTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { explorerApi, formatCount, formatUnitsExact, shortHex, type AddressDetail, type TransactionSummary } from "@/lib/explorer";

type AddressTab = "transactions" | "tokens";
const route = useRoute();
const tab = ref<AddressTab>("transactions");
const detail = ref<AddressDetail | null>(null);
const loading = ref(true);
const copied = ref(false);
const transactionPage = ref(1);
const pageSize = 25;
const transactions = ref<TransactionSummary[]>([]);
const transactionCursors = ref<string[]>([""]);
const nextTransactionCursor = ref<string | undefined>();
const address = computed(() => String(route.params.address || ""));
const transactionRange = computed(() => {
  if (!transactions.value.length) return "0 transactions";
  const start = (transactionPage.value - 1) * pageSize + 1;
  return `${start}–${start + transactions.value.length - 1} indexed transactions`;
});

async function load() {
  loading.value = true;
  transactionPage.value = 1;
  transactionCursors.value = [""];
  nextTransactionCursor.value = undefined;
  try {
    detail.value = await explorerApi.address(address.value);
    await loadTransactions();
  }
  catch { detail.value = null; toast.error("Address not found in the SVM index."); }
  finally { loading.value = false; }
}

async function loadTransactions() {
  const result = await explorerApi.addressTransactions(address.value, pageSize, transactionCursors.value[transactionPage.value - 1]);
  transactions.value = result.items;
  nextTransactionCursor.value = result.nextCursor;
}

function previousTransactions() {
  if (transactionPage.value === 1 || loading.value) return;
  transactionPage.value -= 1;
  void loadTransactions();
}

function nextTransactions() {
  if (!nextTransactionCursor.value || loading.value) return;
  transactionCursors.value = transactionCursors.value.slice(0, transactionPage.value);
  transactionCursors.value.push(nextTransactionCursor.value);
  transactionPage.value += 1;
  nextTransactionCursor.value = undefined;
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
  <main class="page explorer-page explorer-detail-page">
    <div class="directory-topline explorer-detail-topline address-detail-topline">
      <header class="detail-heading address-detail-heading">
        <h1>Address</h1>
        <template v-if="detail">
          <div class="entity-id"><code :title="detail.accountId">{{ shortHex(detail.accountId, 24, 18) }}</code><button type="button" aria-label="Copy address" @click="copyAddress"><Check v-if="copied" :size="15" /><Copy v-else :size="15" /></button></div>
          <p v-if="detail.evmAddress">Mapped EVM address: <code>{{ detail.evmAddress }}</code></p>
        </template>
      </header>
      <ExplorerSearch compact />
    </div>
    <p v-if="loading" class="protocol-loading protocol-loading--page">Loading address…</p>

    <template v-if="detail">
      <section class="protocol-ledger protocol-ledger--two address-ledger">
        <div><span>SVM transactions</span><strong>{{ formatCount(detail.transactionCount ?? detail.transactions.length) }}</strong><small>Indexed</small></div>
        <div><span>SRC20 balances</span><strong>{{ formatCount(detail.balances.length) }}</strong><small>Tokens</small></div>
      </section>

      <nav class="entity-tabs" aria-label="Address data">
        <button type="button" :class="{ active: tab === 'transactions' }" @click="tab = 'transactions'">Transactions</button>
        <button type="button" :class="{ active: tab === 'tokens' }" @click="tab = 'tokens'">Token holdings</button>
      </nav>

      <section v-if="tab === 'transactions'" class="protocol-section entity-table-section">
        <SvmTransactionTable :items="transactions" />
        <TablePagination v-if="transactions.length" :page="transactionPage" :has-next="Boolean(nextTransactionCursor)" :label="transactionRange" @previous="previousTransactions" @next="nextTransactions" />
      </section>
      <section v-else class="protocol-section entity-table-section">
        <div class="protocol-table-wrap"><table class="protocol-table holdings-table">
          <thead><tr><th>Token</th><th>Symbol</th><th>Balance</th><th class="hide-small">Contract</th><th class="hide-small">Total supply</th></tr></thead>
          <tbody>
            <tr v-for="balance in detail.balances" :key="balance.programId"><td><RouterLink class="protocol-link" :to="`/contract/${balance.programId}`">{{ balance.name || 'Unnamed SRC20' }}</RouterLink></td><td class="protocol-mono">{{ balance.symbol || '—' }}</td><td class="protocol-mono">{{ formatUnitsExact(balance.balance, balance.decimals) }}</td><td class="protocol-mono hide-small"><RouterLink class="protocol-link" :to="`/contract/${balance.programId}`">{{ shortHex(balance.programId, 10, 8) }}</RouterLink></td><td class="protocol-mono hide-small">{{ formatUnitsExact(balance.totalSupply, balance.decimals) }}</td></tr>
            <tr v-if="!detail.balances.length"><td colspan="5" class="protocol-empty-row">This address holds no indexed SRC20 tokens.</td></tr>
          </tbody>
        </table></div>
      </section>
    </template>
    <AppFooter />
  </main>
</template>
