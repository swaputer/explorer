<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { Wallet, ArrowUpRight } from "@lucide/vue";
import BrandMark from "./BrandMark.vue";
import { useWallet } from "@/composables/useWallet";
import { computerAppURL } from "@/lib/computer";
import { studioAppURL } from "@/lib/studioApp";
import { short } from "@/lib/protocol";
const wallet = useWallet();
const route = useRoute();
const computer = computerAppURL();
const studio = studioAppURL();
const walletLabel = computed(() => wallet.connecting.value ? "Connecting…" : wallet.address.value ? short(wallet.address.value) : "Connect wallet");
</script>
<template>
  <header class="site-header"><div class="site-header__inner">
    <RouterLink class="brand" to="/" aria-label="Swaputer home"><BrandMark /><span>Swaputer</span></RouterLink>
    <nav class="site-nav" aria-label="Primary">
      <RouterLink to="/" :class="{ active: route.path === '/' }">Overview</RouterLink>
      <RouterLink to="/contracts" :class="{ active: route.path.startsWith('/contract') }">Contracts</RouterLink>
      <a v-if="studio" :href="studio">Studio <ArrowUpRight :size="12" /></a>
      <RouterLink v-else to="/studio">Studio</RouterLink>
      <a v-if="computer" :href="computer">Computer <ArrowUpRight :size="12" /></a>
      <RouterLink v-else to="/computer">Computer</RouterLink>
    </nav>
    <div class="site-actions"><button class="wallet-button" type="button" :disabled="wallet.connecting.value" @click="wallet.connect"><Wallet class="wallet-button__icon" :size="17" /><span>{{ walletLabel }}</span></button></div>
  </div></header>
</template>
