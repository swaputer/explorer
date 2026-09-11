<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { LoaderCircle, Search } from "@lucide/vue";
import { toast } from "@/composables/useToast";
import { explorerApi } from "@/lib/explorer";

const props = withDefaults(defineProps<{ compact?: boolean; placeholder?: string }>(), {
  compact: false,
  placeholder: "Search transaction hash, address or SVM account"
});
const router = useRouter();
const query = ref("");
const loading = ref(false);

async function submit() {
  const value = query.value.trim();
  if (!value) return;
  loading.value = true;
  try {
    const result = await explorerApi.search(value);
    await router.push(result.route);
    query.value = "";
  } catch {
    toast.error("No transaction, SVM account, or program found.");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form :class="['explorer-search', { 'explorer-search--compact': props.compact }]" role="search" @submit.prevent="submit">
    <label class="sr-only" for="explorer-query">Search the SVM protocol</label>
    <button class="explorer-search__leading" type="submit" :disabled="loading" aria-label="Search">
      <LoaderCircle v-if="loading" class="spin" :size="16" aria-hidden="true" />
      <Search v-else :size="16" aria-hidden="true" />
    </button>
    <input id="explorer-query" v-model="query" type="search" autocomplete="off" spellcheck="false" :placeholder="props.placeholder" />
  </form>
</template>
