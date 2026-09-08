<script setup lang="ts">
import { onMounted } from "vue";
import { studioAppURL } from "@/lib/studioApp";

const url = studioAppURL();
onMounted(() => { if (url) window.location.replace(url); });
</script>

<template>
  <main class="page">
    <section class="page-heading">
      <h1>Studio</h1>
      <p>TinySol Studio is now an independent online development environment.</p>
      <a v-if="url" :href="url" class="protocol-link">Open Studio →</a>
      <p v-else>Studio is not available at this address yet.</p>
    </section>
  </main>
</template>
