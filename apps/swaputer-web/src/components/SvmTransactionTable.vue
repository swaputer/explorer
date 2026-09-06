<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { formatAge, formatCount, shortHex, type TransactionSummary } from "@/lib/explorer";

const props = defineProps<{
  items: TransactionSummary[];
  showActor?: boolean;
  hideTarget?: boolean;
  compact?: boolean;
  overview?: boolean;
}>();

const columnCount = computed(() => props.overview
  ? 5
  : 5 + (props.showActor ? 1 : 0) - (props.hideTarget ? 1 : 0) - (props.compact ? 1 : 0));
</script>

<template>
  <div class="protocol-table-wrap">
    <table class="protocol-table transaction-table">
      <thead><tr><th class="transaction-cell">Transaction</th><th class="block-cell" :class="{ 'hide-small': !overview }">Block</th><th v-if="showActor" class="actor-cell" :class="{ 'hide-medium': !overview }">{{ overview ? 'From' : 'Actor' }}</th><th v-if="!hideTarget" class="contract-cell">Contract</th><th v-if="!compact" class="bytes-cell hide-small">Bytes</th><th class="age-cell">{{ overview ? 'Time' : 'Age' }}</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="`${item.hash}-${item.executionHeight}`">
          <td class="transaction-cell">
            <RouterLink class="protocol-link protocol-mono" :to="`/tx/${item.hash}`">{{ shortHex(item.hash) }}</RouterLink>
          </td>
          <td class="block-cell protocol-mono" :class="{ 'hide-small': !overview }">{{ formatCount(item.blockNumber) }}</td>
          <td v-if="showActor" class="actor-cell protocol-mono" :class="{ 'hide-medium': !overview }"><RouterLink class="protocol-link" :to="`/address/${item.actor}`">{{ shortHex(item.actor) }}</RouterLink></td>
          <td v-if="!hideTarget" class="contract-cell protocol-mono"><RouterLink class="protocol-link transaction-contract-link" :to="`/contract/${item.rootTarget}`">{{ shortHex(item.rootTarget) }}</RouterLink></td>
          <td v-if="!compact" class="bytes-cell protocol-mono hide-small">{{ formatCount(item.executedBytes) }}</td>
          <td class="age-cell protocol-mono">{{ formatAge(item.blockTime) }}</td>
        </tr>
        <tr v-if="!items.length"><td :colspan="columnCount" class="protocol-empty-row">No indexed SVM transactions.</td></tr>
      </tbody>
    </table>
  </div>
</template>
