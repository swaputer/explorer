<script setup lang="ts">
import { onMounted } from "vue";
import { DOCS_URL } from "@/lib/links";

onMounted(() => window.location.replace(DOCS_URL));
</script>

<template>
  <main class="page"><p class="protocol-loading protocol-loading--page">Opening <a :href="DOCS_URL">Swaputer Docs</a>…</p></main>
</template>
