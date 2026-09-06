<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { X } from "@lucide/vue";
defineProps<{ title: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);
const titleId = useId();
let previous: HTMLElement | null = null;
let overflow = "";
function trap(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const elements = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') || [])].filter(el => el.getClientRects().length);
  const first = elements[0]; const last = elements.at(-1);
  if (!first) { event.preventDefault(); panel.value?.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
onMounted(async () => {
  previous = document.activeElement as HTMLElement | null;
  overflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  await nextTick();
  panel.value?.focus();
});
onBeforeUnmount(() => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); });
</script>

<template>
  <Teleport to="body">
    <div class="market-dialog-backdrop" @click.self="!busy && emit('close')" @keydown.esc.stop.prevent="!busy && emit('close')" @keydown="trap">
      <section ref="panel" class="market-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="busy" tabindex="-1">
        <header class="market-dialog-heading"><h2 :id="titleId">{{ title }}</h2><button type="button" aria-label="Close dialog" :disabled="busy" @click="emit('close')"><X :size="20" /></button></header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
