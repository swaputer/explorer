<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { formatEther, parseEther } from "ethers";
import { ChevronDown, Copy, LoaderCircle } from "@lucide/vue";
import AppFooter from "@/components/AppFooter.vue";
import { useWallet } from "@/composables/useWallet";
import { toast } from "@/composables/useToast";
import { SETH } from "@/lib/config";
import { nativeAmount } from "@/lib/format";
import { bridgeETH, friendlyError, readBridgeSnapshot, readProtocolFeeConfig, type BridgeSnapshot, type ProtocolFeeConfig } from "@/lib/protocol";

type Direction = "deposit" | "redeem";
const wallet = useWallet();
const direction = ref<Direction>("deposit");
const amount = ref("");
const advanced = ref(false);
const vmBudget = ref(SETH.vmInputWei ? formatEther(SETH.vmInputWei) : "");
const snapshot = ref<BridgeSnapshot | null>(null);
const feeConfig = ref<ProtocolFeeConfig | null>(null);
const loading = ref(false);
const phase = ref<"idle" | "signing" | "pending" | "confirmed">("idle");
const transactionHash = ref<string | null>(null);

const numericAmount = computed(() => {
  try { return amount.value.trim() ? parseEther(amount.value.trim()) : 0n; } catch { return 0n; }
});
const amountLabel = computed(() => direction.value === "deposit" ? "You deposit" : "You redeem");
const outputLabel = computed(() => direction.value === "deposit" ? "You receive" : "You receive");
const inputAsset = computed(() => direction.value === "deposit" ? "ETH" : "sETH");
const outputAsset = computed(() => direction.value === "deposit" ? "sETH" : "ETH");
const balance = computed(() => {
  if (!wallet.address.value) return "—";
  if (direction.value === "redeem" && snapshot.value) return nativeAmount(snapshot.value.balance, 6);
  return "Connected";
});
const actionLabel = computed(() => {
  if (!wallet.address.value) return "Connect wallet";
  if (phase.value === "signing") return "Confirm in wallet";
  if (phase.value === "pending") return "Transaction pending";
  return direction.value === "deposit" ? "Deposit ETH" : "Redeem sETH";
});
const parsedVMBudget = computed(() => {
  try { return vmBudget.value ? parseEther(vmBudget.value) : 0n; } catch { return 0n; }
});
const vmProtocolFee = computed(() => parsedVMBudget.value * BigInt(feeConfig.value?.feeBps ?? 0) / 10_000n);
const vmPoolInput = computed(() => parsedVMBudget.value - vmProtocolFee.value);

const displayEther = (value?: bigint): string => value === undefined ? "—" : nativeAmount(value, 6);

async function refresh() {
  if (!SETH.enabled) return;
  loading.value = true;
  try {
    const [bridge, fees] = await Promise.all([
      readBridgeSnapshot(wallet.address.value),
      readProtocolFeeConfig().catch(() => null)
    ]);
    snapshot.value = bridge;
    feeConfig.value = fees;
  } catch (cause) {
    toast.error(friendlyError(cause));
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!wallet.address.value || !wallet.signer.value) {
    await wallet.connect();
    return;
  }
  if (!SETH.enabled || SETH.vmInputWei === null) {
    toast.error("The mainnet bridge contracts are not configured for this build.");
    return;
  }
  if (numericAmount.value <= 0n) {
    toast.error("Enter an amount greater than zero.");
    return;
  }
  let budget: bigint;
  try { budget = advanced.value && vmBudget.value ? parseEther(vmBudget.value) : SETH.vmInputWei; }
  catch { toast.error("Enter a valid VM budget."); return; }
  phase.value = "signing";
  transactionHash.value = null;
  try {
    await bridgeETH(direction.value, wallet.signer.value, wallet.address.value, wallet.address.value, numericAmount.value, budget, (hash: string) => {
      transactionHash.value = hash;
      phase.value = "pending";
    });
    phase.value = "confirmed";
    amount.value = "";
    toast.success("Bridge transaction confirmed.");
    await refresh();
  } catch (cause) {
    phase.value = "idle";
    toast.error(friendlyError(cause));
  }
}

onMounted(refresh);
watch(() => wallet.address.value, refresh);
const copyTransaction = () => { if (transactionHash.value) void navigator.clipboard?.writeText(transactionHash.value); };
</script>

<template>
  <main class="page page--bridge">
    <section class="page-heading">
      <h1>Bridge</h1>
      <p>Move value into a programmable world.</p>
    </section>

    <section class="bridge-layout">
      <div class="bridge-instrument">
        <div class="mode-tabs" role="tablist" aria-label="Bridge direction">
          <button type="button" :class="{ active: direction === 'deposit' }" @click="direction = 'deposit'">Deposit ETH</button>
          <button type="button" :class="{ active: direction === 'redeem' }" @click="direction = 'redeem'">Redeem sETH</button>
        </div>
        <div class="bridge-fields">
          <div class="amount-block">
            <label for="bridge-amount">{{ amountLabel }}</label>
            <div class="amount-row">
              <input id="bridge-amount" v-model="amount" inputmode="decimal" autocomplete="off" placeholder="0.0000" />
              <div class="asset-select asset-select--static"><span class="asset-glyph">{{ inputAsset === 'ETH' ? '◆' : 'S' }}</span>{{ inputAsset }}</div>
            </div>
            <span class="balance-label">Balance&nbsp;&nbsp;{{ balance }}</span>
          </div>
          <div class="exchange-rule"><span />1 ETH = 1 sETH<span /></div>
          <div class="amount-block amount-block--output">
            <label>{{ outputLabel }}</label>
            <div class="amount-row">
              <output>{{ amount || '0.0000' }}</output>
              <div class="asset-select asset-select--static"><span class="asset-glyph">{{ outputAsset === 'ETH' ? '◆' : 'S' }}</span>{{ outputAsset }}</div>
            </div>
          </div>
        </div>
        <button class="primary-action" type="button" :disabled="phase === 'signing' || phase === 'pending'" @click="submit">
          <LoaderCircle v-if="phase === 'signing' || phase === 'pending'" class="spin" :size="20" />{{ actionLabel }}
        </button>
        <button class="advanced-row" type="button" @click="advanced = !advanced">
          <span>Advanced settings</span><span>{{ advanced ? 'Hide' : 'VM budget: Auto' }} <ChevronDown :class="{ 'advanced-chevron--open': advanced }" :size="17" /></span>
        </button>
        <div v-if="advanced" class="advanced-panel">
          <label>Execution budget (ETH)<input v-model="vmBudget" inputmode="decimal" /></label>
          <dl v-if="feeConfig">
            <div><dt>Protocol fee ({{ feeConfig.feeBps / 100 }}%)</dt><dd>{{ displayEther(vmProtocolFee) }} ETH</dd></div>
            <div><dt>Pool input after fee</dt><dd>{{ displayEther(vmPoolInput) }} ETH</dd></div>
          </dl>
        </div>
      </div>

      <aside class="atomic-path">
        <h2>Atomic path</h2>
        <ol>
          <li><span>01</span><div><strong>ETH</strong><p>ETH enters the Swaputer vault.</p></div></li>
          <li><span>02</span><div><strong>Vault</strong><p>The vault records the deposit and mints sETH.</p></div></li>
          <li><span>03</span><div><strong>sETH</strong><p>sETH is issued to your address.</p></div></li>
        </ol>
        <p class="atomic-note">One transaction. No relayer. No waiting period.</p>
      </aside>
    </section>

    <section class="reserve-ledger">
      <h2>Reserve state</h2>
      <div class="reserve-grid">
        <div><span>Locked ETH</span><strong>{{ loading ? '···' : displayEther(snapshot?.lockedEth) }}</strong><small>ETH</small></div>
        <div><span>sETH Supply</span><strong>{{ loading ? '···' : displayEther(snapshot?.totalSupply) }}</strong><small>sETH</small></div>
        <div><span>Surplus</span><strong>{{ loading ? '···' : displayEther(snapshot?.backingSurplus) }}</strong><small>ETH</small></div>
        <div><span>Solvent</span><strong>{{ snapshot ? (snapshot.solvent ? 'Yes' : 'No') : '—' }}</strong><small>On-chain</small></div>
      </div>
      <p>sETH supply never exceeds ETH held by the vault.</p>
      <button v-if="transactionHash" class="transaction-link" type="button" @click="copyTransaction"><Copy :size="13" /> Copy transaction hash</button>
    </section>

    <AppFooter />
  </main>
</template>
