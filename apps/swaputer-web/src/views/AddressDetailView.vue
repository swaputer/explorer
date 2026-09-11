<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Check, Copy } from "@lucide/vue";
import ExplorerSearch from "@/components/ExplorerSearch.vue";
import SvmTransactionTable from "@/components/SvmTransactionTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toast } from "@/composables/useToast";
import { explorerApi, formatCount, shortHex, type AddressDetail, type TransactionSummary } from "@/lib/explorer";

const route = useRoute();
const detail = ref<AddressDetail | null>(null);
const loading = ref(true);
const copied = ref(false);
const page = ref(1);
const pageSize = 25;
const transactions = ref<TransactionSummary[]>([]);
const cursors = ref<string[]>([""]);
const nextCursor = ref<string | undefined>();
const address = computed(() => String(route.params.address || ""));
const rangeLabel = computed(() => {
  if (!transactions.value.length) return "0 transactions";
  const start = (page.value - 1) * pageSize + 1;
  return `${start}–${start + transactions.value.length - 1} indexed transactions`;
});

async function load() {
  loading.value = true;
  page.value = 1;
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
      <section class="protocol-ledger address-ledger">
        <div><span>SVM transactions</span><strong>{{ formatCount(detail.transactionCount ?? detail.transactions.length) }}</strong><small>Indexed</small></div>
      </section>

      <section class="protocol-section entity-table-section">
        <h2>ADDRESS TRANSACTIONS</h2>
        <SvmTransactionTable :items="transactions" />
        <TablePagination v-if="transactions.length" :page="page" :has-next="Boolean(nextCursor)" :label="rangeLabel" @previous="previous" @next="next" />
      </section>
    </template>
  </main>
</template>
