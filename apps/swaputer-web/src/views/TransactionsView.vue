<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { toast } from "@/composables/useToast";
import SvmTransactionTable from "@/components/SvmTransactionTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { explorerApi, type TransactionSummary } from "@/lib/explorer";

const items = ref<TransactionSummary[]>([]);
const loading = ref(true);
const page = ref(1);
const pageSize = 25;
const cursors = ref<string[]>([""]);
const nextCursor = ref<string | undefined>();
const rangeLabel = computed(() => {
  if (!items.value.length) return "0 transactions";
  const start = (page.value - 1) * pageSize + 1;
  return `${start}–${start + items.value.length - 1} indexed transactions`;
});

async function load() {
  loading.value = true;
  try {
    const result = await explorerApi.transactions(pageSize, cursors.value[page.value - 1]);
    items.value = result.items;
    nextCursor.value = result.nextCursor;
  }
  catch { toast.error("Transactions are temporarily unavailable."); }
  finally { loading.value = false; }
}

function previous() {
  if (page.value === 1) return;
  page.value -= 1;
  void load();
}

function next() {
  if (!nextCursor.value) return;
  cursors.value = cursors.value.slice(0, page.value);
  cursors.value.push(nextCursor.value);
  page.value += 1;
  void load();
}

onMounted(() => void load());
</script>

<template>
  <main class="page explorer-page explorer-directory-page">
    <div class="directory-topline">
      <header class="detail-heading"><h1>Transactions</h1><p>{{ loading ? 'Loading indexed executions…' : `${items.length} latest indexed executions` }}</p></header>
    </div>
    <section class="protocol-section transaction-directory directory-data-surface">
      <SvmTransactionTable :items="items" show-actor />
      <p v-if="loading" class="protocol-loading">Loading transactions…</p>
      <TablePagination v-else :page="page" :has-next="Boolean(nextCursor)" :label="rangeLabel" @previous="previous" @next="next" />
    </section>
  </main>
</template>
