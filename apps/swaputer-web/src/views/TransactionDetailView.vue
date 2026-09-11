<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Check, Copy } from "@lucide/vue";
import { toast } from "@/composables/useToast";
import ExplorerSearch from "@/components/ExplorerSearch.vue";
import { nativeAmount } from "@/lib/format";
import {
  explorerApi, formatCount, formatUnitsExact, shortHex, type TransactionDetail
} from "@/lib/explorer";

type DetailTab = "overview" | "executions" | "events" | "input";

const route = useRoute();
const detail = ref<TransactionDetail | null>(null);
const loading = ref(true);
const copied = ref<string | null>(null);
const activeTab = ref<DetailTab>("overview");

const hash = computed(() => String(route.params.hash || ""));
const executionStatus = computed(() => detail.value?.finalized ? "Finalized" : detail.value?.canonical ? "Confirming" : "Not canonical");
const events = computed(() => detail.value?.executions.flatMap((execution) => execution.events.map((event) => ({
  ...event,
  executionId: execution.id,
  executionHeight: execution.executionHeight
}))) ?? []);
const executedBytes = computed(() => detail.value?.executions.reduce((total, execution) => total + execution.executedBytes, 0) ?? 0);
const dateLabel = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }) + " UTC";

async function load() {
  loading.value = true;
  activeTab.value = "overview";
  try {
    detail.value = await explorerApi.transaction(hash.value);
  }
  catch { detail.value = null; toast.error("Transaction not found in the SVM index."); }
  finally { loading.value = false; }
}

async function copy(value: string) {
  await navigator.clipboard?.writeText(value);
  copied.value = value;
  window.setTimeout(() => { copied.value = null; }, 1_200);
}

onMounted(load);
watch(hash, load);
</script>

<template>
  <main class="page explorer-page explorer-detail-page tx-detail-page">
    <div class="directory-topline explorer-detail-topline">
      <header class="detail-heading">
        <h1>Transaction Details</h1>
        <p>Indexed Ethereum transaction with SVM execution data.</p>
      </header>
      <ExplorerSearch compact />
    </div>
    <p v-if="loading" class="protocol-loading protocol-loading--page">Loading transaction…</p>

    <template v-if="detail">
      <nav class="tx-detail-tabs" aria-label="Transaction detail sections">
        <button type="button" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">Overview</button>
        <button type="button" :class="{ active: activeTab === 'executions' }" @click="activeTab = 'executions'">SVM Executions <span>{{ detail.executions.length }}</span></button>
        <button type="button" :class="{ active: activeTab === 'events' }" @click="activeTab = 'events'">Events <span>{{ events.length }}</span></button>
        <button type="button" :class="{ active: activeTab === 'input' }" @click="activeTab = 'input'">Input Data</button>
      </nav>

      <section v-if="activeTab === 'overview'" class="tx-detail-card" aria-label="Transaction overview">
        <dl class="tx-detail-rows">
          <div>
            <dt>Transaction Hash</dt>
            <dd class="tx-copy-value"><code>{{ detail.hash }}</code><button type="button" aria-label="Copy transaction hash" @click="copy(detail.hash)"><Check v-if="copied === detail.hash" :size="15" /><Copy v-else :size="15" /></button></dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd><span :class="['tx-status', { 'tx-status--pending': !detail.finalized }]">{{ executionStatus }}</span></dd>
          </div>
          <div>
            <dt>Block</dt>
            <dd><span class="protocol-link protocol-mono">{{ formatCount(detail.blockNumber) }}</span></dd>
          </div>
          <div>
            <dt>Timestamp</dt>
            <dd class="protocol-mono">{{ dateLabel(detail.blockTime) }}</dd>
          </div>
          <div v-if="detail.executions.length">
            <dt>SVM Action</dt>
            <dd class="tx-action-summary">
              <RouterLink :to="`/address/${detail.executions[0]!.actor}`">{{ shortHex(detail.executions[0]!.actor, 10, 8) }}</RouterLink>
              <span>executed {{ formatCount(executedBytes) }} bytes on</span>
              <RouterLink class="protocol-mono" :to="`/contract/${detail.executions[0]!.rootTarget}`">{{ shortHex(detail.executions[0]!.rootTarget, 12, 10) }}</RouterLink>
            </dd>
          </div>
          <div>
            <dt>From</dt>
            <dd class="tx-address-value"><RouterLink :to="`/address/${detail.sender}`">{{ detail.sender }}</RouterLink><span>Sender</span></dd>
          </div>
          <div>
            <dt>To</dt>
            <dd class="tx-address-value"><RouterLink v-if="detail.recipient" :to="`/address/${detail.recipient}`">{{ detail.recipient }}</RouterLink><span v-else>Contract creation</span></dd>
          </div>
          <div>
            <dt>Value</dt>
            <dd class="protocol-mono">{{ formatUnitsExact(detail.valueWei, 18, 8) }} ETH</dd>
          </div>
          <div>
            <dt>Gas Used</dt>
            <dd class="protocol-mono">{{ formatCount(detail.gasUsed) }}</dd>
          </div>
        </dl>

        <details class="tx-more-details">
          <summary><span>More Details</span><small>Click to show more</small></summary>
          <dl class="tx-detail-rows tx-detail-rows--more">
            <div><dt>Nonce</dt><dd class="protocol-mono">{{ formatCount(detail.nonce) }}</dd></div>
            <div><dt>Position in Block</dt><dd class="protocol-mono">{{ formatCount(detail.transactionIndex) }}</dd></div>
            <div><dt>Block Hash</dt><dd class="tx-copy-value"><code>{{ detail.blockHash }}</code><button type="button" aria-label="Copy block hash" @click="copy(detail.blockHash)"><Check v-if="copied === detail.blockHash" :size="15" /><Copy v-else :size="15" /></button></dd></div>
            <div><dt>Canonical</dt><dd>{{ detail.canonical ? 'Yes' : 'No' }}</dd></div>
          </dl>
        </details>
      </section>

      <section v-else-if="activeTab === 'executions'" class="tx-tab-content">
        <article v-for="execution in detail.executions" :key="execution.id" class="tx-detail-card tx-execution-card">
          <header><div><span>SVM Execution</span><strong>#{{ formatCount(execution.executionHeight) }}</strong></div><span class="tx-status">{{ executionStatus }}</span></header>
          <dl class="tx-detail-rows">
            <div><dt>World ID</dt><dd class="protocol-mono">{{ execution.worldId }}</dd></div>
            <div><dt>Actor</dt><dd><RouterLink class="protocol-link protocol-mono" :to="`/address/${execution.actor}`">{{ execution.actor }}</RouterLink></dd></div>
            <div><dt>Root Target</dt><dd><RouterLink class="protocol-link protocol-mono" :to="`/contract/${execution.rootTarget}`">{{ execution.rootTarget }}</RouterLink></dd></div>
            <div><dt>Executed Bytes</dt><dd class="protocol-mono">{{ formatCount(execution.executedBytes) }}</dd></div>
            <div><dt>Token Burned</dt><dd class="protocol-mono">{{ nativeAmount(execution.tokenBurned, 6) }} VM</dd></div>
            <div><dt>Gross Token Out</dt><dd class="protocol-mono">{{ nativeAmount(execution.grossTokenOut, 6) }} VM</dd></div>
            <div><dt>Net Token Out</dt><dd class="protocol-mono">{{ nativeAmount(execution.netTokenOut, 6) }} VM</dd></div>
            <div><dt>Ethereum Log Index</dt><dd class="protocol-mono">{{ execution.ethereumLogIndex }}</dd></div>
            <div><dt>Receipt Version</dt><dd class="protocol-mono">{{ execution.receiptVersion ?? '—' }}</dd></div>
            <div><dt>Receipt Flags</dt><dd class="protocol-mono">{{ execution.receiptFlags !== undefined ? `0x${execution.receiptFlags.toString(16).padStart(4, '0')}` : '—' }}</dd></div>
          </dl>
          <details class="tx-payload"><summary>Raw Receipt</summary><code>{{ execution.rawReceipt }}</code></details>
        </article>
        <div v-if="!detail.executions.length" class="tx-empty-state">No SVM execution was indexed for this transaction.</div>
      </section>

      <section v-else-if="activeTab === 'events'" class="tx-tab-content">
        <article v-for="event in events" :key="`${event.executionId}-${event.index}`" class="tx-detail-card tx-event-card">
          <header><div><span>Event</span><strong>#{{ event.index }}</strong></div><small>Execution #{{ formatCount(event.executionHeight) }}</small></header>
          <dl class="tx-detail-rows">
            <div><dt>Address</dt><dd><RouterLink class="protocol-link protocol-mono" :to="`/contract/${event.emitter}`">{{ event.emitter }}</RouterLink></dd></div>
            <div><dt>Record type</dt><dd>{{ event.kind === 'application' ? 'Application event' : event.kind }}</dd></div>
            <div><dt>Topics</dt><dd class="tx-topic-list"><code v-for="(topic, index) in event.topics" :key="topic"><span>{{ index }}</span>{{ topic }}</code><span v-if="!event.topics.length">—</span></dd></div>
            <div><dt>Data</dt><dd><code class="tx-long-data">{{ event.data }}</code></dd></div>
          </dl>
        </article>
        <div v-if="!events.length" class="tx-empty-state">No events were emitted by this transaction.</div>
      </section>

      <section v-else class="tx-detail-card tx-input-card">
        <header><div><span>Transaction Input</span><strong>Raw hex data</strong></div></header>
        <div class="tx-input-data"><code>{{ detail.input }}</code><button type="button" @click="copy(detail.input)"><Check v-if="copied === detail.input" :size="15" /><Copy v-else :size="15" />Copy input</button></div>
      </section>
    </template>
  </main>
</template>
