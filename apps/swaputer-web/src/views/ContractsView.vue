<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AppFooter from "@/components/AppFooter.vue";
import ExplorerSearch from "@/components/ExplorerSearch.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toast } from "@/composables/useToast";
import { explorerApi, formatCount, shortHex, type ContractSummary } from "@/lib/explorer";

const items = ref<ContractSummary[]>([]);
const loading = ref(true);
const page = ref(1);
const pageSize = 25;
const cursors = ref<string[]>([""]);
const nextCursor = ref<string | undefined>();
const rangeLabel = computed(() => {
  if (!items.value.length) return "0 contracts";
  const start = (page.value - 1) * pageSize + 1;
  return `${start}–${start + items.value.length - 1} indexed contracts`;
});

async function load() {
  loading.value = true;
  try {
    const result = await explorerApi.contracts("all", pageSize, cursors.value[page.value - 1]);
    items.value = result.items;
    nextCursor.value = result.nextCursor;
  }
  catch { toast.error("Contracts are temporarily unavailable."); }
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

onMounted(load);
</script>

<template>
  <main class="page explorer-page explorer-directory-page contracts-directory-page">
    <div class="directory-topline">
      <header class="detail-heading"><h1>Contracts</h1><p>Mini contracts deployed on the SVM protocol.</p></header>
      <ExplorerSearch compact />
    </div>

    <section class="protocol-section contracts-directory-surface">
      <div class="protocol-table-wrap">
        <table class="protocol-table contracts-directory-table">
          <thead><tr><th>Contract</th><th>Standard</th><th>Block</th><th class="hide-small">Creator</th><th class="hide-small">Code hash</th></tr></thead>
          <tbody>
            <tr v-for="contract in items" :key="contract.programId">
              <td class="contract-address"><RouterLink :to="`/contract/${contract.programId}`"><code>{{ shortHex(contract.programId, 16, 12) }}</code></RouterLink></td>
              <td><span :class="['contract-standard', `contract-standard--${contract.standard}`]">{{ contract.standard === 'src20' ? 'SRC20' : '—' }}</span></td>
              <td class="protocol-mono">{{ formatCount(contract.deploymentBlock) }}</td>
              <td class="protocol-mono hide-small"><RouterLink class="protocol-link" :to="`/address/${contract.creator}`">{{ shortHex(contract.creator, 10, 8) }}</RouterLink></td>
              <td class="protocol-mono hide-small">{{ shortHex(contract.codeHash, 10, 8) }}</td>
            </tr>
            <tr v-if="!items.length && !loading"><td colspan="5" class="protocol-empty-row">No contracts indexed.</td></tr>
          </tbody>
        </table>
      </div>
      <TablePagination v-if="!loading && items.length" :page="page" :has-next="Boolean(nextCursor)" :label="rangeLabel" @previous="previous" @next="next" />
    </section>
    <AppFooter />
  </main>
</template>
