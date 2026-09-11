<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ArrowUpRight, BookOpen, ChevronDown, Code2, GitFork } from "@lucide/vue";
import BrandMark from "./BrandMark.vue";
import { DOCS_URL, GITHUB_URL, STUDIO_URL } from "@/lib/links";

const route = useRoute();
const developerOpen = ref(false);
const developerMenu = ref<HTMLElement | null>(null);
const developerButton = ref<HTMLButtonElement | null>(null);

function closeDeveloperMenu({ restoreFocus = false } = {}) {
  developerOpen.value = false;
  if (restoreFocus) void nextTick(() => developerButton.value?.focus());
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!developerMenu.value?.contains(event.target as Node)) closeDeveloperMenu();
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && developerOpen.value) closeDeveloperMenu({ restoreFocus: true });
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeyDown);
});
</script>
<template>
  <header class="site-header"><div class="site-header__inner">
    <RouterLink class="brand" to="/" aria-label="Swaputer home"><BrandMark /><span>Swaputer</span></RouterLink>
    <nav class="site-nav" aria-label="Primary">
      <RouterLink to="/" :class="{ active: route.path === '/' }">Overview</RouterLink>
      <RouterLink to="/transactions" :class="{ active: route.path.startsWith('/transaction') || route.path.startsWith('/tx/') }">Transactions</RouterLink>
      <RouterLink to="/contracts" :class="{ active: route.path.startsWith('/contract') }">Contracts</RouterLink>
      <div ref="developerMenu" class="developer-menu">
        <button
          ref="developerButton"
          class="developer-menu__trigger"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="developerOpen"
          aria-controls="developer-links"
          @click="developerOpen = !developerOpen"
        >
          Developer
          <ChevronDown :size="14" aria-hidden="true" :class="{ 'developer-menu__chevron--open': developerOpen }" />
        </button>
        <Transition name="developer-popover">
          <div v-if="developerOpen" id="developer-links" class="developer-menu__popover" role="menu">
            <a :href="DOCS_URL" target="_blank" rel="noopener noreferrer" role="menuitem" @click="closeDeveloperMenu()">
              <span><BookOpen :size="16" aria-hidden="true" />Docs</span><ArrowUpRight :size="13" aria-hidden="true" />
            </a>
            <a :href="GITHUB_URL" target="_blank" rel="noopener noreferrer" role="menuitem" @click="closeDeveloperMenu()">
              <span><GitFork :size="16" aria-hidden="true" />GitHub</span><ArrowUpRight :size="13" aria-hidden="true" />
            </a>
            <a :href="STUDIO_URL" target="_blank" rel="noopener noreferrer" role="menuitem" @click="closeDeveloperMenu()">
              <span><Code2 :size="16" aria-hidden="true" />Studio</span><ArrowUpRight :size="13" aria-hidden="true" />
            </a>
          </div>
        </Transition>
      </div>
    </nav>
  </div></header>
</template>
