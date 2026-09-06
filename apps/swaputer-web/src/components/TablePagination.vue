<script setup lang="ts">
import { computed } from "vue";
import { ChevronLeft, ChevronRight } from "@lucide/vue";

const props = defineProps<{ page: number; pageCount?: number; label: string; hasNext?: boolean; busy?: boolean }>();
defineEmits<{ previous: []; next: [] }>();

const nextDisabled = computed(() => props.hasNext !== undefined
  ? !props.hasNext
  : props.pageCount === undefined || props.page === props.pageCount);
</script>

<template>
  <footer class="table-pagination" aria-label="Table pagination">
    <span>{{ label }}</span>
    <div>
      <button type="button" :disabled="busy || page === 1" aria-label="Previous page" @click="$emit('previous')"><ChevronLeft :size="15" /></button>
      <span>{{ pageCount === undefined ? `Page ${page}` : `${page} / ${pageCount}` }}</span>
      <button type="button" :disabled="busy || nextDisabled" aria-label="Next page" @click="$emit('next')"><ChevronRight :size="15" /></button>
    </div>
  </footer>
</template>
