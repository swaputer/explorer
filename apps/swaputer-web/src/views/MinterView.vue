<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Check, Copy, LoaderCircle, LockKeyhole, Plus, Search, ShieldCheck, X } from "@lucide/vue";
import AppFooter from "@/components/AppFooter.vue";
import { useWallet } from "@/composables/useWallet";
import { toast } from "@/composables/useToast";
import { NETWORK } from "@/lib/config";
import { tokenAmount } from "@/lib/format";
import { deployMiniContract, friendlyError, mintSRC20, short, verifyOpenMintSRC20, type TokenSnapshot } from "@/lib/protocol";
import { prepareSRC20 } from "@/lib/src20Factory";

const route = useRoute();
const router = useRouter();
const wallet = useWallet();
const requestedContract = typeof route.query.contract === "string" ? route.query.contract : "";
const addressInput = ref(requestedContract);
const contractId = ref<string | null>(null);
const snapshot = ref<TokenSnapshot | null>(null);
const loading = ref(false);
const mintPhase = ref<"idle" | "verifying" | "signing" | "pending" | "confirmed">("idle");
const copied = ref<string | null>(null);

const creatorOpen = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);
const name = ref("");
const symbol = ref("");
const supply = ref("");
const mintAmount = ref("");
const createPhase = ref<"idle" | "compiling" | "signing" | "pending" | "confirmed">("idle");
const createdProgram = ref<string | null>(null);
const submittedHash = ref<string | null>(null);
let copyTimer: number | undefined;
let loadVersion = 0;

const createBusy = computed(() => createPhase.value === "compiling" || createPhase.value === "signing" || createPhase.value === "pending");
const mintBusy = computed(() => ["verifying", "signing", "pending"].includes(mintPhase.value));
const progress = computed(() => {
  if (!snapshot.value || snapshot.value.cap <= 0n) return null;
  return Math.min(100, Number(snapshot.value.totalSupply * 10_000n / snapshot.value.cap) / 100);
});
const mintExhausted = computed(() => Boolean(snapshot.value && snapshot.value.cap > 0n && snapshot.value.totalSupply + snapshot.value.mintAmount > snapshot.value.cap));
const mintLabel = computed(() => {
  if (!wallet.address.value) return "Connect wallet";
  if (mintPhase.value === "verifying") return "Verifying contract";
  if (mintPhase.value === "signing") return "Confirm in wallet";
  if (mintPhase.value === "pending") return "Minting";
  if (mintPhase.value === "confirmed") return "Minted";
  if (mintExhausted.value) return "Mint complete";
  return snapshot.value ? `Mint ${tokenAmount(snapshot.value.mintAmount, snapshot.value.decimals)} ${snapshot.value.symbol}` : "Load contract";
});
const createLabel = computed(() => {
  if (!wallet.address.value) return "Connect wallet";
  if (createPhase.value === "compiling") return "Compiling package";
  if (createPhase.value === "signing") return "Confirm in wallet";
  if (createPhase.value === "pending") return "Deploying SRC20";
  if (createPhase.value === "confirmed") return "Done";
  return "Create SRC20";
});

function clearContract() {
  ++loadVersion;
  loading.value = false;
  contractId.value = null;
  snapshot.value = null;
  mintPhase.value = "idle";
}

async function loadContract() {
  if (mintBusy.value) return;
  clearContract();
  const version = loadVersion;
  const target = addressInput.value.trim();
  loading.value = true;
  try {
    const verified = await verifyOpenMintSRC20(target);
    if (version !== loadVersion) return;
    snapshot.value = verified;
    contractId.value = target;
    await router.replace({ query: { ...route.query, contract: target } });
  } catch (cause) {
    if (version !== loadVersion) return;
    snapshot.value = null;
    contractId.value = null;
    toast.error(friendlyError(cause));
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function mint() {
  if (mintBusy.value || loading.value) return;
  if (!wallet.address.value || !wallet.signer.value) {
    await wallet.connect();
    return;
  }
  if (!snapshot.value || !contractId.value) {
    return;
  }
  const target = contractId.value;
  const version = loadVersion;
  mintPhase.value = "verifying";
  try {
    // Recheck the pinned package and read ABI directly onchain before signing.
    snapshot.value = await verifyOpenMintSRC20(target);
    if (snapshot.value.totalSupply + snapshot.value.mintAmount > snapshot.value.cap) {
      mintPhase.value = "idle";
      return;
    }
    mintPhase.value = "signing";
    await mintSRC20(wallet.signer.value, wallet.address.value, target, () => { mintPhase.value = "pending"; });
    mintPhase.value = "confirmed";
    toast.success("SRC20 minted.");
  } catch (cause) {
    mintPhase.value = "idle";
    toast.error(friendlyError(cause));
    return;
  }
  // A read failure must not misreport a confirmed mint as a failed transaction.
  try {
    const refreshed = await verifyOpenMintSRC20(target);
    if (version === loadVersion) snapshot.value = refreshed;
  } catch {
    if (version === loadVersion) toast.error("Mint confirmed. Reload the contract to refresh its supply.");
  }
}

async function copy(value: string) {
  await navigator.clipboard?.writeText(value);
  copied.value = value;
  if (copyTimer) window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => { copied.value = null; }, 1_500);
}

function openCreator() {
  if (createPhase.value === "confirmed") {
    createPhase.value = "idle";
    createdProgram.value = null;
    submittedHash.value = null;
    name.value = "";
    symbol.value = "";
    supply.value = "";
    mintAmount.value = "";
  }
  creatorOpen.value = true;
  void nextTick(() => nameInput.value?.focus());
}

function closeCreator() {
  if (!createBusy.value) creatorOpen.value = false;
}

async function createToken() {
  if (!wallet.address.value || !wallet.signer.value) {
    await wallet.connect();
    return;
  }
  createPhase.value = "compiling";
  createdProgram.value = null;
  submittedHash.value = null;
  try {
    const prepared = await prepareSRC20({ name: name.value, symbol: symbol.value, cap: supply.value, mintAmount: mintAmount.value });
    createPhase.value = "signing";
    const deployment = await deployMiniContract(
      wallet.signer.value,
      wallet.address.value,
      prepared.build.packageBytes,
      prepared.constructorArgs,
      24_000,
      (hash) => { submittedHash.value = hash; createPhase.value = "pending"; }
    );
    createdProgram.value = deployment.programId;
    createPhase.value = "confirmed";
    toast.success("SRC20 created.");
  } catch (cause) {
    createPhase.value = "idle";
    toast.error(friendlyError(cause));
  }
}

async function submitCreator() {
  if (createPhase.value === "confirmed") {
    closeCreator();
    addressInput.value = createdProgram.value ?? "";
    await loadContract();
    return;
  }
  await createToken();
}

function onKeydown(event: KeyboardEvent) {
  if (creatorOpen.value && event.key === "Escape") closeCreator();
}

watch(creatorOpen, (open) => { document.body.style.overflow = open ? "hidden" : ""; });
watch(addressInput, clearContract, { flush: "sync" });
onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  if (requestedContract) void loadContract();
});
onBeforeUnmount(() => {
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onKeydown);
  ++loadVersion;
  if (copyTimer) window.clearTimeout(copyTimer);
});
</script>

<template>
  <main class="page minter-page">
    <header class="minter-heading">
      <div><h1>Minter</h1><p>Enter a contract address to mint SRC20.</p></div>
      <button class="create-token-button" type="button" :disabled="mintBusy" @click="openCreator"><Plus :size="15" />Create SRC20</button>
    </header>

    <section class="minter-shell">
      <form class="contract-loader" @submit.prevent="loadContract">
        <label for="mint-contract">Contract address</label>
        <div>
          <input id="mint-contract" v-model="addressInput" :disabled="mintBusy" autocomplete="off" autocapitalize="off" :spellcheck="false" placeholder="0x…" aria-describedby="mint-contract-help" />
          <button type="submit" :disabled="mintBusy || loading || !addressInput.trim()" aria-label="Load contract" title="Load contract"><LoaderCircle v-if="loading" class="spin" :size="18" /><Search v-else :size="18" /></button>
        </div>
        <p id="mint-contract-help">Only SRC20 contracts deployed from Swaputer’s public mint template are supported.</p>
      </form>

      <div class="minter-stage">
        <section v-if="snapshot && contractId" class="minter-workspace">
          <div class="token-facts">
            <header><div><h2>{{ snapshot.name }}</h2><p>{{ snapshot.symbol }} · OpenMint SRC20</p></div><span class="verified-contract"><ShieldCheck :size="13" />Verified</span></header>
            <div class="contract-row"><span>Contract</span><code>{{ short(contractId, 18, 14) }}</code><button type="button" aria-label="Copy contract address" @click="copy(contractId)"><Check v-if="copied === contractId" :size="14" /><Copy v-else :size="14" /></button></div>
            <dl>
              <div><dt>Standard</dt><dd>SRC20</dd></div>
              <div><dt>Decimals</dt><dd>{{ snapshot.decimals }}</dd></div>
              <div><dt>Mint amount</dt><dd>{{ tokenAmount(snapshot.mintAmount, snapshot.decimals) }} {{ snapshot.symbol }}</dd></div>
              <div><dt>Total minted</dt><dd>{{ tokenAmount(snapshot.totalSupply, snapshot.decimals) }} {{ snapshot.symbol }}</dd></div>
              <div><dt>Max supply</dt><dd>{{ tokenAmount(snapshot.cap, snapshot.decimals) }} {{ snapshot.symbol }}</dd></div>
            </dl>
            <div v-if="progress !== null" class="supply-progress">
              <div class="supply-progress-label"><span>Mint progress</span><strong>{{ progress.toFixed(2) }}%</strong></div>
              <div class="supply-progress-track" role="progressbar" aria-label="Mint progress" :aria-valuenow="progress" :aria-valuemin="0" :aria-valuemax="100"><div :style="{ width: `${progress}%` }" /></div>
            </div>
          </div>

          <aside class="mint-ticket">
            <h2>Mint SRC20</h2>
            <dl>
              <div><dt>Recipient</dt><dd>{{ wallet.address.value ? short(wallet.address.value, 8, 6) : 'Not connected' }}</dd></div>
              <div><dt>You receive</dt><dd>{{ tokenAmount(snapshot.mintAmount, snapshot.decimals) }} {{ snapshot.symbol }}</dd></div>
              <div><dt>Network</dt><dd>{{ NETWORK.displayName }}</dd></div>
              <div><dt>Execution fee</dt><dd>Estimated at confirmation</dd></div>
            </dl>
            <button class="mint-action" type="button" :disabled="loading || mintPhase === 'verifying' || mintPhase === 'signing' || mintPhase === 'pending' || mintExhausted" @click="mint">
              <LoaderCircle v-if="loading || mintPhase === 'verifying' || mintPhase === 'signing' || mintPhase === 'pending'" class="spin" :size="16" />
              <Check v-else-if="mintPhase === 'confirmed'" :size="16" />
              {{ mintLabel }}
            </button>
            <p>Eligibility is checked again onchain before signing.</p>
          </aside>
        </section>

        <section v-else-if="loading" class="minter-empty minter-empty--loading" aria-live="polite">
          <LoaderCircle class="spin" :size="22" /><div><h2>Verifying contract</h2><p>Checking the immutable package identity and public mint ABI.</p></div>
        </section>
        <section v-else class="minter-empty">
          <div><h2>Enter a contract address</h2><p>We’ll verify the public mint template and ABI before loading the token.</p></div>
        </section>
      </div>
    </section>

    <AppFooter />
  </main>

  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="creatorOpen" class="token-modal-backdrop" @mousedown.self="closeCreator">
        <form class="token-modal" role="dialog" aria-modal="true" aria-labelledby="create-src20-title" @submit.prevent="submitCreator">
          <header><h2 id="create-src20-title">Create SRC20</h2><button type="button" aria-label="Close token creator" :disabled="createBusy" @click="closeCreator"><X :size="18" /></button></header>
          <div class="token-modal-fields">
            <label><span>Name</span><input ref="nameInput" v-model="name" required maxlength="31" autocomplete="off" placeholder="e.g. My Token" /></label>
            <label><span>Symbol</span><input v-model="symbol" required maxlength="12" autocomplete="off" placeholder="e.g. MTK" /></label>
            <label><span>Total supply</span><input v-model="supply" required inputmode="decimal" autocomplete="off" placeholder="0" /></label>
            <label><span>Amount per mint</span><input v-model="mintAmount" required inputmode="decimal" autocomplete="off" placeholder="0" /></label>
          </div>
          <div class="token-modal-decimals"><span>Decimals</span><strong>18</strong><LockKeyhole :size="14" /></div>
          <p class="token-modal-note">The token package is compiled and deployed as an SVM Mini Contract.</p>
          <p v-if="createdProgram" class="token-modal-result" role="status"><Check :size="14" /><span>Created</span><code>{{ short(createdProgram, 12, 10) }}</code><button type="button" aria-label="Copy created contract" @click="copy(createdProgram)"><Copy :size="13" /></button></p>
          <p v-else-if="submittedHash" class="token-modal-result token-modal-result--pending" role="status"><LoaderCircle class="spin" :size="14" /><span>Transaction submitted</span><code>{{ short(submittedHash, 10, 8) }}</code></p>
          <div class="token-modal-actions">
            <button class="token-modal-cancel" type="button" :disabled="createBusy" @click="closeCreator">Cancel</button>
            <button class="token-modal-submit" type="submit" :disabled="createBusy"><LoaderCircle v-if="createBusy" class="spin" :size="15" /><Check v-else-if="createPhase === 'confirmed'" :size="15" /><Plus v-else :size="15" />{{ createLabel }}</button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.minter-page { padding-top: 0; }
.minter-heading { min-height: 118px; padding: 24px 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.minter-heading h1 { margin: 0; font-size: clamp(34px, 3vw, 42px); line-height: .95; font-weight: 680; letter-spacing: -.06em; }
.minter-heading p { margin: 9px 0 0; color: #373a40; font-size: 13px; }
.create-token-button { height: 40px; padding: 0 16px; border: 1px solid var(--blue); background: var(--blue); color: #fff; display: inline-flex; align-items: center; justify-content: center; gap: 7px; font-size: 11px; font-weight: 620; }
.create-token-button:hover { background: #123fd7; }
.contract-loader { margin-bottom: 18px; }
.contract-loader > label { display: block; margin-bottom: 7px; color: #55585e; font-size: 10px; font-weight: 690; letter-spacing: .02em; }
.contract-loader > div { display: grid; grid-template-columns: 1fr 176px; gap: 8px; }
.contract-loader input { min-width: 0; height: 42px; padding: 0 13px; border: 1px solid var(--ink); outline: 0; font-family: var(--font-mono); font-size: 11px; }
.contract-loader input:focus { box-shadow: inset 0 -3px var(--blue); }
.contract-loader > div button { border: 1px solid var(--ink); background: #fff; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 11px; font-weight: 620; }
.contract-loader > div button:hover:not(:disabled) { background: var(--ink); color: #fff; }
.contract-detection { margin: 8px 0 0; display: flex; align-items: center; gap: 8px; color: var(--muted); font-family: var(--font-mono); font-size: 9px; }
.contract-detection span { width: 7px; height: 7px; background: var(--rule); }
.contract-detection--ready { color: var(--ink); }
.contract-detection--ready span { background: var(--blue); }
.minter-error { margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--red); color: var(--red); font-family: var(--font-mono); font-size: 10px; }
.minter-workspace { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(310px, .85fr); border: 1px solid var(--ink); }
.token-facts { padding: 18px; }
.token-facts > header { min-height: 58px; padding-bottom: 14px; display: flex; align-items: center; }
.token-facts h2 { margin: 0; font-size: 22px; font-weight: 660; letter-spacing: -.04em; }
.token-facts header p { margin: 4px 0 0; color: var(--muted); font-size: 10px; }
.contract-row { min-height: 42px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); display: grid; grid-template-columns: 92px minmax(0, 1fr) 30px; align-items: center; gap: 10px; font-size: 10px; }
.contract-row > span { color: var(--muted); }
.contract-row code { text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contract-row button { width: 30px; height: 30px; border: 0; background: transparent; display: grid; place-items: center; }
.token-facts dl { margin: 0; }
.token-facts dl > div { min-height: 38px; display: grid; grid-template-columns: 38% 62%; border-bottom: 1px solid #afb1b5; align-items: stretch; font-size: 11px; }
.token-facts dt { display: flex; align-items: center; }
.token-facts dd { min-width: 0; margin: 0; padding: 8px 0 8px 16px; border-left: 1px solid #afb1b5; display: flex; align-items: center; font-family: var(--font-mono); }
.mint-ticket { padding: 18px; border-left: 1px solid var(--ink); }
.mint-ticket h2 { margin: 0 0 12px; padding-bottom: 10px; border-bottom: 1px solid var(--ink); font-size: 12px; letter-spacing: .02em; }
.mint-ticket dl { margin: 0 0 18px; }
.mint-ticket dl div { min-height: 48px; border-bottom: 1px solid #afb1b5; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.mint-ticket dt { font-size: 10px; }
.mint-ticket dd { margin: 0; max-width: 58%; text-align: right; font-family: var(--font-mono); font-size: 10px; }
.mint-action { width: 100%; min-height: 44px; border: 0; background: var(--blue); color: #fff; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; font-weight: 620; }
.mint-action:hover:not(:disabled) { background: #123fd7; }
.mint-ticket > p { margin: 13px 0 0; color: var(--muted); font-size: 9px; }
.minter-empty { min-height: 166px; padding: 24px; border: 1px solid var(--ink); display: flex; align-items: center; gap: 20px; }
.minter-empty > span { width: 52px; height: 52px; border: 1px solid var(--ink); border-radius: 50%; display: grid; place-items: center; font-family: var(--font-mono); font-size: 11px; }
.minter-empty h2 { margin: 0; font-size: 18px; }
.minter-empty p { max-width: 460px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }

.token-modal-backdrop { position: fixed; inset: 0; z-index: 100; padding: 24px; background: rgba(17,18,20,.25); display: grid; place-items: center; }
.token-modal { width: min(560px, 100%); max-height: calc(100vh - 48px); overflow-y: auto; border: 1px solid var(--ink); background: #fff; box-shadow: 0 10px 34px rgba(17,18,20,.09); }
.token-modal > header { height: 54px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--ink); display: flex; align-items: center; justify-content: space-between; }
.token-modal > header h2 { margin: 0; font-size: 18px; font-weight: 660; letter-spacing: -.035em; }
.token-modal > header button { width: 34px; height: 34px; border: 1px solid var(--ink); background: #fff; display: grid; place-items: center; }
.token-modal-fields { padding: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px 18px; }
.token-modal-fields label { display: grid; gap: 7px; font-size: 11px; }
.token-modal-fields input { min-width: 0; height: 42px; padding: 0 11px; border: 1px solid #9a9ca1; outline: 0; font-size: 11px; }
.token-modal-fields label:nth-child(n+3) input { font-family: var(--font-mono); }
.token-modal-fields input:focus { border-color: var(--ink); box-shadow: inset 0 -3px var(--blue); }
.token-modal-decimals { min-height: 46px; margin: 0 20px 18px; padding: 0 12px; border: 1px solid var(--ink); display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; font-size: 11px; }
.token-modal-decimals strong { font-family: var(--font-mono); font-size: 12px; font-weight: 550; }
.token-modal-error, .token-modal-result { min-height: 40px; margin: 0 20px 18px; padding: 8px 11px; border: 1px solid currentColor; display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 9px; }
.token-modal-error { color: var(--red); }
.token-modal-result { color: var(--green); }
.token-modal-result code { margin-left: auto; color: var(--muted); }
.token-modal-result button { border: 0; background: transparent; color: inherit; }
.token-modal-result--pending { color: var(--muted); }
.token-modal-submit { width: 100%; min-height: 46px; border: 0; border-top: 1px solid var(--ink); background: var(--blue); color: #fff; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; font-weight: 620; }
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 150ms ease; }
.modal-fade-enter-active .token-modal, .modal-fade-leave-active .token-modal { transition: transform 150ms ease, opacity 150ms ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-from .token-modal, .modal-fade-leave-to .token-modal { opacity: 0; transform: translateY(8px); }

@media (max-width: 899px) {
  .minter-workspace { grid-template-columns: 1fr; }
  .mint-ticket { border-left: 0; border-top: 1px solid var(--ink); }
}
@media (max-width: 620px) {
  .minter-heading { align-items: flex-start; flex-direction: column; gap: 18px; padding: 24px 0; }
  .create-token-button { width: 100%; }
  .contract-loader > div { grid-template-columns: 1fr 46px; }
  .contract-loader > div button { font-size: 0; }
  .token-facts, .mint-ticket { padding: 14px; }
  .token-modal-backdrop { padding: 12px; align-items: start; overflow-y: auto; }
  .token-modal { margin: 12px 0; max-height: none; }
  .token-modal-fields { grid-template-columns: 1fr; gap: 13px; }
}
</style>
<style scoped src="./MinterView.ui.css"></style>
