<script setup lang="ts">
import { onMounted } from "vue";

const docsUrl = import.meta.env.VITE_DOCS_URL || (import.meta.env.DEV ? "http://127.0.0.1:4175/" : "https://docs.swaputer.xyz");
onMounted(() => window.location.replace(docsUrl));
</script>

<template>
  <main class="page"><p class="protocol-loading protocol-loading--page">正在打开 <a :href="docsUrl">Swaputer Docs</a>…</p></main>
</template>
