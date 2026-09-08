<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { computerAppURL } from "@/lib/computer";
const route = useRoute();
const url = computed(() => computerAppURL(route.path === "/computer" ? "/" : route.fullPath));
onMounted(() => { if (url.value) window.location.replace(url.value); });
</script>
<template><main class="page"><section class="page-heading"><h1>Computer</h1><p>Mint, Market and Bridge now live in Computer.</p><a v-if="url" :href="url" class="protocol-link">Open Computer →</a><p v-else>The application desktop is not available at this address yet.</p></section></main></template>
