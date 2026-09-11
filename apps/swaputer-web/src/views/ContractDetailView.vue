<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Copy } from "@lucide/vue";
import ExplorerSearch from "@/components/ExplorerSearch.vue";
import SvmTransactionTable from "@/components/SvmTransactionTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toast } from "@/composables/useToast";
import {
  explorerApi, formatAge, formatCount, formatUnitsExact, shortHex,
  type ContractDetail, type TokenHolder, type TransactionSummary, type TransferDetail
} from "@/lib/explorer";

type ContractTab = "holders" | "transfers" | "transactions";

const route = useRoute();
const contract = ref<ContractDetail | null>(null);
const holders = ref<TokenHolder[]>([]);
const transfers = ref<TransferDetail[]>([]);
const transactions = ref<TransactionSummary[]>([]);
const loading = ref(true);
const tab = ref<ContractTab>("transactions");
const pageSize = 25;
const holderPage = ref(1);
const holderCursors = ref<string[]>([""]);
const nextHolderCursor = ref<string | undefined>();
const transferPage = ref(1);
const transferCursors = ref<string[]>([""]);
const nextTransferCursor = ref<string | undefined>();
const transactionPage = ref(1);
const transactionCursors = ref<string[]>([""]);
const nextTransactionCursor = ref<string | undefined>();
const program = computed(() => String(route.params.program || ""));
const isSRC20 = computed(() => Boolean(contract.value?.token));
const title = computed(() => isSRC20.value ? (contract.value?.token?.name || "Unnamed SRC20") : "Contract");
const subtitle = computed(() => isSRC20.value
  ? `${contract.value?.token?.symbol || "—"} · SRC20`
  : contract.value ? shortHex(contract.value.programId, 16, 12) : "Mini contract details and indexed activity.");
const holderRange = computed(() => pageRange(holderPage.value, holders.value.length, "holders"));
const transferRange = computed(() => pageRange(transferPage.value, transfers.value.length, "transfers"));
const transactionRange = computed(() => pageRange(transactionPage.value, transactions.value.length, "transactions"));

function pageRange(page: number, count: number, label: string): string {
  if (!count) return `0 ${label}`;
  const start = (page - 1) * pageSize + 1;
  return `${start}–${start + count - 1} indexed ${label}`;
}

function holderShare(holder: TokenHolder): string {
  const token = contract.value?.token;
  if (!token) return "—";
  try {
    const supply = BigInt(token.totalSupply);
    if (supply === 0n) return "—";
    return `${Number(BigInt(holder.balance) * 10_000n / supply) / 100}%`;
  } catch { return "—"; }
}

async function load() {
  loading.value = true;
  try {
    const next = await explorerApi.contract(program.value);
    contract.value = next;
    resetPagination();
    tab.value = next.token ? "holders" : "transactions";
    await loadActiveTab();
  } catch {
    contract.value = null;
    holders.value = [];
    transfers.value = [];
    transactions.value = [];
    toast.error("Contract not found in the SVM index.");
  } finally { loading.value = false; }
}

function resetPagination() {
  holders.value = [];
  transfers.value = [];
  transactions.value = [];
  holderPage.value = 1;
  holderCursors.value = [""];
  nextHolderCursor.value = undefined;
  transferPage.value = 1;
  transferCursors.value = [""];
  nextTransferCursor.value = undefined;
  transactionPage.value = 1;
  transactionCursors.value = [""];
  nextTransactionCursor.value = undefined;
}

async function loadActiveTab() {
  if (tab.value === "holders") {
    const result = await explorerApi.holders(program.value, pageSize, holderCursors.value[holderPage.value - 1]);
    holders.value = result.items;
    nextHolderCursor.value = result.nextCursor;
    return;
  }
  if (tab.value === "transfers") {
    const result = await explorerApi.transfers(program.value, pageSize, transferCursors.value[transferPage.value - 1]);
    transfers.value = result.items;
    nextTransferCursor.value = result.nextCursor;
    return;
  }
  const result = await explorerApi.contractTransactions(program.value, pageSize, transactionCursors.value[transactionPage.value - 1]);
  transactions.value = result.items;
  nextTransactionCursor.value = result.nextCursor;
}

function selectTab(next: ContractTab) {
  if (tab.value === next) return;
  tab.value = next;
  if (next === "holders") {
    holderPage.value = 1;
    holderCursors.value = [""];
  } else if (next === "transfers") {
    transferPage.value = 1;
    transferCursors.value = [""];
  } else {
    transactionPage.value = 1;
    transactionCursors.value = [""];
  }
  void loadActiveTab();
}

function previousHolders() { if (holderPage.value > 1) { holderPage.value -= 1; void loadActiveTab(); } }
function nextHolders() {
  if (!nextHolderCursor.value) return;
  holderCursors.value = holderCursors.value.slice(0, holderPage.value);
  holderCursors.value.push(nextHolderCursor.value);
  holderPage.value += 1;
  nextHolderCursor.value = undefined;
  void loadActiveTab();
}
function previousTransfers() { if (transferPage.value > 1) { transferPage.value -= 1; void loadActiveTab(); } }
function nextTransfers() {
  if (!nextTransferCursor.value) return;
  transferCursors.value = transferCursors.value.slice(0, transferPage.value);
  transferCursors.value.push(nextTransferCursor.value);
  transferPage.value += 1;
  nextTransferCursor.value = undefined;
  void loadActiveTab();
}
function previousTransactions() { if (transactionPage.value > 1) { transactionPage.value -= 1; void loadActiveTab(); } }
function nextTransactions() {
  if (!nextTransactionCursor.value) return;
  transactionCursors.value = transactionCursors.value.slice(0, transactionPage.value);
  transactionCursors.value.push(nextTransactionCursor.value);
  transactionPage.value += 1;
  nextTransactionCursor.value = undefined;
  void loadActiveTab();
}

function copy(value: string) { void navigator.clipboard?.writeText(value); }

onMounted(load);
watch(program, load);
</script>

<template>
  <main class="page explorer-page explorer-detail-page contract-detail-page">
    <div class="directory-topline explorer-detail-topline">
      <header class="detail-heading contract-detail-heading"><h1>{{ title }}</h1><p>{{ subtitle }}</p></header>
      <ExplorerSearch compact />
    </div>
    <p v-if="loading" class="protocol-loading protocol-loading--page">Loading contract…</p>

    <template v-if="contract">
      <section v-if="isSRC20 && contract.token" class="protocol-ledger protocol-ledger--four token-ledger">
        <div><span>Total supply</span><strong>{{ formatUnitsExact(contract.token.totalSupply, contract.token.decimals) }}</strong><small>{{ contract.token.symbol || 'SRC20' }}</small></div>
        <div><span>Holders</span><strong>{{ formatCount(contract.token.holderCount) }}</strong><small>Accounts</small></div>
        <div><span>Decimals</span><strong>{{ contract.token.decimals }}</strong><small>Precision</small></div>
        <div><span>Block</span><strong>{{ formatCount(contract.deploymentBlock) }}</strong><small>{{ contract.finalized ? 'Deployed' : 'Confirming' }}</small></div>
      </section>

      <section class="detail-section contract-details-section">
        <h2>CONTRACT DETAILS</h2>
        <dl class="detail-ledger detail-ledger--two contract-details-ledger">
          <div><dt>Program ID</dt><dd><code>{{ shortHex(contract.programId, 18, 14) }}</code><button type="button" aria-label="Copy contract program ID" @click="copy(contract.programId)"><Copy :size="13" /></button></dd></div>
          <div><dt>Code hash</dt><dd><code>{{ shortHex(contract.codeHash, 18, 14) }}</code><button type="button" aria-label="Copy contract code hash" @click="copy(contract.codeHash)"><Copy :size="13" /></button></dd></div>
          <div><dt>Creator</dt><dd><RouterLink class="protocol-link protocol-mono" :to="`/address/${contract.creator}`">{{ shortHex(contract.creator, 18, 14) }}</RouterLink><button type="button" aria-label="Copy contract creator" @click="copy(contract.creator)"><Copy :size="13" /></button></dd></div>
          <div><dt>Creation transaction</dt><dd><RouterLink class="protocol-link protocol-mono" :to="`/tx/${contract.creationTransactionHash}`">{{ shortHex(contract.creationTransactionHash, 18, 14) }}</RouterLink><button type="button" aria-label="Copy creation transaction hash" @click="copy(contract.creationTransactionHash)"><Copy :size="13" /></button></dd></div>
          <div><dt>Deployment</dt><dd><span class="protocol-mono">Block {{ formatCount(contract.deploymentBlock) }}</span><span :class="['tx-status', { 'tx-status--pending': !contract.finalized }]">{{ contract.finalized ? 'Finalized' : 'Confirming' }}</span></dd></div>
        </dl>
      </section>

      <template v-if="isSRC20 && contract.token">
        <nav class="entity-tabs token-entity-tabs contract-entity-tabs" aria-label="Contract data">
          <button type="button" :class="{ active: tab === 'holders' }" @click="selectTab('holders')">Holders</button>
          <button type="button" :class="{ active: tab === 'transfers' }" @click="selectTab('transfers')">Transfers</button>
          <button type="button" :class="{ active: tab === 'transactions' }" @click="selectTab('transactions')">Transactions</button>
        </nav>

        <section v-if="tab === 'holders'" class="protocol-section entity-table-section">
          <div class="protocol-table-wrap"><table class="protocol-table holders-table"><thead><tr><th>Rank</th><th>Account</th><th class="hide-small">Mapped EVM address</th><th>Balance</th><th class="hide-small">Share</th></tr></thead><tbody>
            <tr v-for="(holder, index) in holders" :key="holder.accountId"><td class="protocol-mono">{{ (holderPage - 1) * pageSize + index + 1 }}</td><td><RouterLink class="protocol-link protocol-mono" :to="`/address/${holder.accountId}`">{{ shortHex(holder.accountId, 12, 10) }}</RouterLink></td><td class="protocol-mono hide-small">{{ holder.evmAddress ? shortHex(holder.evmAddress, 10, 8) : '—' }}</td><td class="protocol-mono">{{ formatUnitsExact(holder.balance, contract.token.decimals) }} {{ contract.token.symbol }}</td><td class="protocol-mono hide-small">{{ holderShare(holder) }}</td></tr>
            <tr v-if="!holders.length"><td colspan="5" class="protocol-empty-row">No token holders indexed.</td></tr>
          </tbody></table></div>
          <TablePagination v-if="holders.length" :page="holderPage" :has-next="Boolean(nextHolderCursor)" :label="holderRange" @previous="previousHolders" @next="nextHolders" />
        </section>

        <section v-else-if="tab === 'transfers'" class="protocol-section entity-table-section">
          <div class="protocol-table-wrap"><table class="protocol-table transfer-table"><thead><tr><th>Transaction</th><th>Type</th><th>From</th><th>To</th><th>Amount</th><th>Block</th><th>Age</th></tr></thead><tbody>
            <tr v-for="item in transfers" :key="`${item.transactionHash}-${item.sender}-${item.recipient}`"><td><RouterLink class="protocol-link protocol-mono" :to="`/tx/${item.transactionHash}`">{{ shortHex(item.transactionHash) }}</RouterLink></td><td>{{ item.mint ? 'Mint' : item.burn ? 'Burn' : 'Transfer' }}</td><td><RouterLink class="protocol-link protocol-mono" :title="item.sender" :to="`/address/${item.sender}`">{{ shortHex(item.sender) }}</RouterLink></td><td><RouterLink class="protocol-link protocol-mono" :title="item.recipient" :to="`/address/${item.recipient}`">{{ shortHex(item.recipient) }}</RouterLink></td><td class="protocol-mono">{{ formatUnitsExact(item.amount, contract.token.decimals) }} {{ contract.token.symbol }}</td><td class="protocol-mono">{{ formatCount(item.blockNumber) }}</td><td class="protocol-mono">{{ formatAge(item.blockTime) }}</td></tr>
            <tr v-if="!transfers.length"><td colspan="7" class="protocol-empty-row">No transfers indexed for this contract.</td></tr>
          </tbody></table></div>
          <TablePagination v-if="transfers.length" :page="transferPage" :has-next="Boolean(nextTransferCursor)" :label="transferRange" @previous="previousTransfers" @next="nextTransfers" />
        </section>
      </template>

      <section v-if="!isSRC20 || tab === 'transactions'" class="protocol-section contract-transactions-section">
        <h2>CONTRACT TRANSACTIONS</h2>
        <SvmTransactionTable :items="transactions" show-actor hide-target />
        <TablePagination v-if="transactions.length" :page="transactionPage" :has-next="Boolean(nextTransactionCursor)" :label="transactionRange" @previous="previousTransactions" @next="nextTransactions" />
      </section>
    </template>
  </main>
</template>
