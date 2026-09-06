<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { RouterLink } from "vue-router";
import { useRoute } from "vue-router";
import { ChevronDown, Wallet } from "@lucide/vue";
import BrandMark from "./BrandMark.vue";
import { useWallet } from "@/composables/useWallet";
import { OFFICIAL_FEATURES } from "@/lib/config";
import { short } from "@/lib/protocol";

const wallet = useWallet();
const route = useRoute();
const appsMenu = ref<HTMLDetailsElement | null>(null);
const walletLabel = computed(() => wallet.connecting.value ? "Connecting…" : wallet.address.value ? short(wallet.address.value) : "Connect wallet");
const overviewActive = computed(() => route.path === "/");
const contractsActive = computed(() => route.path === "/contracts" || route.path.startsWith("/contract/"));
const appPaths = [
  ...(OFFICIAL_FEATURES.seth ? ["/bridge"] : []),
  "/minter",
  ...(OFFICIAL_FEATURES.market ? ["/market"] : []),
  "/studio"
];
const appsActive = computed(() => appPaths.some((path) => route.path.startsWith(path)));
let appsCloseTimer: number | undefined;
const cancelAppsClose = () => {
  if (appsCloseTimer !== undefined) window.clearTimeout(appsCloseTimer);
  appsCloseTimer = undefined;
};
const openApps = () => {
  cancelAppsClose();
  if (appsMenu.value) appsMenu.value.open = true;
};
const closeApps = () => {
  cancelAppsClose();
  if (appsMenu.value) appsMenu.value.open = false;
};
const scheduleAppsClose = () => {
  cancelAppsClose();
  appsCloseTimer = window.setTimeout(closeApps, 220);
};
const handleAppsFocusOut = (event: FocusEvent) => {
  const next = event.relatedTarget as Node | null;
  if (!next || !appsMenu.value?.contains(next)) closeApps();
};
onBeforeUnmount(cancelAppsClose);
</script>

<template>
  <header class="site-header">
    <div class="site-header__inner">
      <RouterLink class="brand" to="/" aria-label="Swaputer home">
        <BrandMark />
        <span>Swaputer</span>
      </RouterLink>
      <nav class="site-nav" aria-label="Primary">
        <RouterLink to="/" :class="{ active: overviewActive }">Overview</RouterLink>
        <RouterLink to="/contracts" :class="{ active: contractsActive }">Contracts</RouterLink>
        <details
          ref="appsMenu"
          :class="['apps-menu', { active: appsActive }]"
          @mouseenter="openApps"
          @mouseleave="scheduleAppsClose"
          @focusin="openApps"
          @focusout="handleAppsFocusOut"
          @keydown.esc="closeApps"
        >
          <summary aria-haspopup="menu" @click.prevent="openApps">Apps <ChevronDown :size="14" /></summary>
          <div role="menu">
            <RouterLink v-if="OFFICIAL_FEATURES.seth" role="menuitem" to="/bridge" @click="closeApps"><span>Bridge</span><small>Move ETH into SVM</small></RouterLink>
            <RouterLink role="menuitem" to="/minter" @click="closeApps"><span>Minter</span><small>Discover and mint SRC20</small></RouterLink>
            <RouterLink v-if="OFFICIAL_FEATURES.market" role="menuitem" to="/market" @click="closeApps"><span>Market</span><small>Trade SRC20 tokens</small></RouterLink>
            <RouterLink role="menuitem" class="studio-nav-link" to="/studio" @click="closeApps"><span>Studio</span><small>Build mini contracts</small></RouterLink>
          </div>
        </details>
      </nav>
      <div class="site-actions">
        <button class="wallet-button" type="button" :disabled="wallet.connecting.value" @click="wallet.connect">
          <Wallet class="wallet-button__icon" :size="17" />
          <span>{{ walletLabel }}</span>
        </button>
      </div>
    </div>
  </header>
</template>
