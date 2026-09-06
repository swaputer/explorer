<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { ArrowRight } from "@lucide/vue";
import AppFooter from "@/components/AppFooter.vue";
import { toast } from "@/composables/useToast";
import ExplorerSearch from "@/components/ExplorerSearch.vue";
import SvmTransactionTable from "@/components/SvmTransactionTable.vue";
import {
  explorerApi, formatAge, formatCount, subscribeExplorer,
  type IndexerStatus, type TransactionSummary
} from "@/lib/explorer";

const status = ref<IndexerStatus | null>(null);
const transactions = ref<TransactionSummary[]>([]);
let unsubscribe: (() => void) | undefined;
let refreshing = false;

async function load() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [nextStatus, nextTransactions] = await Promise.all([
      explorerApi.status(), explorerApi.transactions(6)
    ]);
    status.value = nextStatus;
    transactions.value = nextTransactions.items;
  } catch {
    toast.error("The SVM indexer is temporarily unavailable.");
  } finally {
    refreshing = false;
  }
}

onMounted(() => { void load(); unsubscribe = subscribeExplorer(() => void load()); });
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <main class="page explorer-page explorer-page--overview">
    <div class="overview-topline">
      <header class="explorer-heading"><h1>Explore SVM</h1></header>
      <ExplorerSearch compact placeholder="Search transaction, address or SVM account" />
    </div>

    <section class="protocol-ledger protocol-ledger--four overview-ledger" aria-label="Protocol status">
      <div><span>Indexed block</span><strong>{{ formatCount(status?.canonicalTip ?? (status ? status.nextBlock - 1 : null)) }}</strong><small>{{ status ? formatAge(status.updatedAt) : 'Connecting' }}</small></div>
      <div><span>SVM transactions</span><strong>{{ formatCount(status?.executions) }}</strong><small>Total</small></div>
      <div><span>Mini contracts</span><strong>{{ formatCount(status?.deployments) }}</strong><small>Deployed</small></div>
      <div><span>SVM accounts</span><strong>{{ formatCount(status?.accounts) }}</strong><small>Unique actors</small></div>
    </section>

    <section class="protocol-section overview-transactions">
      <h2>Latest SVM transactions</h2>
      <SvmTransactionTable :items="transactions" show-actor compact overview />
      <RouterLink class="protocol-more" to="/transactions">View all transactions <ArrowRight :size="15" aria-hidden="true" /></RouterLink>
    </section>

    <AppFooter />
  </main>
</template>
