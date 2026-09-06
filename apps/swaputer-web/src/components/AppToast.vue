<script setup lang="ts">
import { CheckCircle2, CircleAlert, Info, X } from "@lucide/vue";
import { useToast } from "@/composables/useToast";

const { items, dismiss } = useToast();
</script>

<template>
  <Teleport to="body">
    <TransitionGroup class="toast-viewport" tag="section" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
      <article v-for="item in items" :key="item.id" :class="['toast', `toast--${item.tone}`]" :role="item.tone === 'error' ? 'alert' : 'status'">
        <CheckCircle2 v-if="item.tone === 'success'" :size="17" aria-hidden="true" />
        <CircleAlert v-else-if="item.tone === 'error'" :size="17" aria-hidden="true" />
        <Info v-else :size="17" aria-hidden="true" />
        <p>{{ item.message }}</p>
        <button type="button" aria-label="Dismiss notification" @click="dismiss(item.id)"><X :size="15" /></button>
      </article>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.toast-viewport { position: fixed; z-index: 200; top: 80px; right: 20px; width: min(380px, calc(100vw - 32px)); display: grid; gap: 8px; pointer-events: none; }
.toast { min-height: 48px; padding: 10px 10px 10px 12px; border: 1px solid var(--rule-strong); border-radius: 10px; background: rgba(32, 32, 32, .96); box-shadow: 0 16px 42px rgba(0, 0, 0, .34); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; color: var(--ink); pointer-events: auto; }
.toast > p { margin: 0; font-size: var(--text-sm); line-height: 1.4; }
.toast > button { width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); display: grid; place-items: center; }
.toast > button:hover { background: var(--surface-hover); color: var(--ink); }
.toast--error > svg { color: var(--red); }
.toast--success > svg { color: var(--green); }
.toast--info > svg { color: var(--blue); }
.v-enter-active, .v-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.v-enter-from, .v-leave-to { opacity: 0; transform: translateY(6px); }
@media (max-width: 620px) { .toast-viewport { top: 68px; right: 12px; width: calc(100vw - 24px); } }
</style>
