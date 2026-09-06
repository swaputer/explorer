<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";

const docsUrl = import.meta.env.VITE_DOCS_URL || (import.meta.env.DEV ? "http://127.0.0.1:4175/" : "https://docs.swaputer.xyz");
</script>

<template>
  <footer class="site-footer">
    <span>Swaputer Protocol</span>
    <nav aria-label="Footer">
      <a class="footer-external" :href="docsUrl">Docs <ArrowUpRight :size="13" aria-hidden="true" /></a>
      <a class="footer-external" href="https://github.com" target="_blank" rel="noreferrer">GitHub <ArrowUpRight :size="13" aria-hidden="true" /></a>
    </nav>
  </footer>
</template>
