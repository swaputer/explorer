<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";
import { DOCS_URL, GITHUB_URL } from "@/lib/links";
</script>

<template>
  <footer class="site-footer">
    <span>Swaputer Protocol</span>
    <nav aria-label="Footer">
      <a class="footer-external" :href="DOCS_URL" target="_blank" rel="noopener noreferrer">Docs <ArrowUpRight :size="13" aria-hidden="true" /></a>
      <a class="footer-external" :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">GitHub <ArrowUpRight :size="13" aria-hidden="true" /></a>
    </nav>
  </footer>
</template>
