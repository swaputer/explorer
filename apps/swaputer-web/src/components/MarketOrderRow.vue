<script setup lang="ts">
import { RouterLink } from "vue-router";
import { formatUnits } from "ethers";
import { shortHex, type MarketOrder } from "@/lib/explorer";
import { tokenAmount, nativeAmount } from "@/lib/format";
defineProps<{ order: MarketOrder; symbol: string; decimals: number; expiry: string; action: string; disabled: boolean; mine?: boolean }>();
defineEmits<{ select: [order: MarketOrder] }>();
</script>

<template>
  <div class="market-order-row" role="row">
    <div class="order-amount" role="cell" :title="`${formatUnits(order.amount, decimals)} ${symbol}`">
      <span class="order-mobile-label">Amount</span>
      <div class="order-value"><strong>{{ tokenAmount(order.amount, decimals, 5) }}</strong> <span>{{ symbol }}</span></div>
      <small>{{ mine ? (order.side === 'buy' ? 'Buy' : 'Sell') + ' order' : 'Order' }} #{{ order.orderId }}</small>
    </div>
    <div class="order-total" role="cell">
      <span class="order-mobile-label">Total price</span>
      <div class="order-value"><strong>{{ nativeAmount(order.priceWei, 18) }}</strong> <span>ETH</span></div>
      <small :title="`${formatUnits(order.unitPriceWei, 18)} ETH / ${symbol}`">{{ nativeAmount(order.unitPriceWei) }} ETH / {{ symbol }}</small>
    </div>
    <div class="order-maker" role="cell"><RouterLink :to="`/address/${order.maker}`" :title="order.maker"><span class="sr-only">Maker </span>{{ shortHex(order.maker, 8, 6) }}</RouterLink></div>
    <div class="order-expiry" role="cell"><time :datetime="new Date(order.expiry * 1000).toISOString()" :title="new Date(order.expiry * 1000).toLocaleString()"><span class="sr-only">Expires </span>{{ expiry }}</time></div>
    <div class="order-action-cell" role="cell"><button class="order-action" type="button" :disabled="disabled" @click="$emit('select', order)">{{ action }}</button></div>
  </div>
</template>

<style scoped>
.market-order-row { display: grid; grid-template-columns: var(--order-columns); align-items: center; gap: 24px; min-height: 68px; padding: 12px 20px; border-top: 1px solid var(--rule); transition: background 150ms; }
.market-order-row:hover, .market-order-row:focus-within { background: var(--surface-hover); }
.market-order-row > div { min-width: 0; }
.order-value { color: var(--ink); font-size: 14px; line-height: 1.5; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.order-value strong { font-weight: 600; }
.order-value > span { color: var(--muted); font-size: 12px; }
.order-total .order-value > span { color: var(--ink); }
.market-order-row small { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.order-maker a { display: block; width: fit-content; max-width: 100%; color: var(--blue); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.order-maker a:hover { text-decoration: underline; }
.order-expiry { color: var(--muted); font-size: 12px; }
.order-action-cell { text-align: right; }
.order-action { min-height: 32px; width: 100%; padding: 6px 10px; border: 1px solid transparent; border-radius: 6px; background: var(--blue-soft); color: var(--blue); font: 550 12px/1.4 var(--font-sans, inherit); overflow-wrap: anywhere; }
.order-action:hover:not(:disabled) { border-color: var(--blue); }
.order-action:disabled { opacity: .45; cursor: not-allowed; }
.order-mobile-label { display: none; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (max-width: 900px) { .market-order-row { gap: 16px; padding-inline: 16px; } }
@media (max-width: 680px) {
  .market-order-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(68px, .8fr); gap: 12px 10px; padding: 16px; }
  .order-amount { grid-column: 1; }
  .order-total { grid-column: 2 / 4; text-align: right; }
  .order-maker { grid-column: 1; }
  .order-expiry { grid-column: 2; text-align: center; font-size: 11px; }
  .order-action-cell { grid-column: 3; }
  .order-action { min-height: 40px; padding-inline: 6px; }
  .order-mobile-label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 4px; }
}
@media (prefers-reduced-motion: reduce) { .market-order-row { transition: none; } }
</style>
