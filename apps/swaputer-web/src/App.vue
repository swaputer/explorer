<script setup lang="ts">
import { RouterView } from "vue-router";
import AppHeader from "@/components/AppHeader.vue";
import AppToast from "@/components/AppToast.vue";
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <RouterView />
    <AppToast />
  </div>
</template>
