<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Check, ChevronDown, Copy, FileCode2, LoaderCircle, Plus, Save, Terminal, TriangleAlert } from "@lucide/vue";
import CodeEditor from "@/components/CodeEditor.vue";
import { useWallet } from "@/composables/useWallet";
import { toast } from "@/composables/useToast";
import { NETWORK, OFFICIAL_FEATURES, SWAPVM } from "@/lib/config";
import { deployMiniContract, friendlyError, readMiniContract, short, writeMiniContract } from "@/lib/protocol";
import {
  EMPTY_CONTRACT,
  STUDIO_TEMPLATES,
  compileStudioSource,
  encodeConstructorArguments,
  formatStudioError,
  parseScalar,
  type StudioBuild,
  type StudioFunction
} from "@/lib/studio";

type InspectorTab = "build" | "deploy" | "interact";
type BuildPhase = "idle" | "compiling" | "success" | "error";
const STORAGE_KEY = "swaputer.studio.source.v1";
const wallet = useWallet();
const templateId = ref("counter");
const fileName = ref("counter.tsol");
const source = ref(localStorage.getItem(STORAGE_KEY) || STUDIO_TEMPLATES[0]!.source);
const build = ref<StudioBuild | null>(null);
const buildPhase = ref<BuildPhase>("idle");
const buildError = ref<string | null>(null);
const saved = ref(true);
const inspectorTab = ref<InspectorTab>("deploy");
const constructorValues = ref<string[]>([]);
const byteGasLimit = ref("20000");
const deployPhase = ref<"idle" | "signing" | "pending" | "confirmed">("idle");
const targetId = ref("");
const functionArgs = ref<Record<string, string[]>>({});
const functionResults = ref<Record<string, string>>({});
const activeFunction = ref<string | null>(null);
const consoleEntries = ref<string[]>(["Studio ready"]);
let compileTimer: number | undefined;

const encodedConstructor = computed(() => {
  if (!build.value) return { value: "0x", error: null as string | null };
  try { return { value: encodeConstructorArguments(build.value.constructorTypes, constructorValues.value), error: null }; }
  catch (cause) { return { value: "0x", error: friendlyError(cause) }; }
});
const deployed = computed(() => deployPhase.value === "confirmed" && /^0x[0-9a-fA-F]{64}$/.test(targetId.value));

async function compile(foreground = true) {
  if (foreground) buildPhase.value = "compiling";
  try {
    const result = await compileStudioSource(source.value, fileName.value);
    build.value = result;
    buildPhase.value = "success";
    buildError.value = null;
    constructorValues.value = result.constructorTypes.map(() => "");
    functionArgs.value = Object.fromEntries(result.functions.map((fn) => [fn.selector, fn.inputs.map(() => "")]));
    if (foreground) consoleEntries.value.push(`Build succeeded · ${result.packageLength} package bytes`);
  } catch (cause) {
    console.error("[studio] compilation failed", cause);
    build.value = null;
    buildPhase.value = "error";
    buildError.value = await formatStudioError(cause);
    if (foreground) consoleEntries.value.push("Build failed");
  }
}

function chooseTemplate(id: string) {
  const template = STUDIO_TEMPLATES.find((item) => item.id === id);
  if (!template) return;
  templateId.value = id;
  fileName.value = template.fileName;
  source.value = template.source;
  saved.value = false;
}

function newFile() {
  templateId.value = "";
  fileName.value = "my-contract.tsol";
  source.value = EMPTY_CONTRACT;
  saved.value = false;
}

function save() {
  localStorage.setItem(STORAGE_KEY, source.value);
  saved.value = true;
  consoleEntries.value.push("Saved locally");
}

async function deploy() {
  if (!wallet.address.value || !wallet.signer.value) {
    await wallet.connect();
    return;
  }
  if (!build.value) { await compile(); return; }
  if (encodedConstructor.value.error) { toast.error(encodedConstructor.value.error); return; }
  const limit = Number(byteGasLimit.value);
  if (!Number.isInteger(limit) || limit <= 0) { toast.error("Enter a valid byte gas limit."); return; }
  deployPhase.value = "signing";
  consoleEntries.value.push("Waiting for deployment signature");
  try {
    const result = await deployMiniContract(
      wallet.signer.value,
      wallet.address.value,
      build.value.packageBytes,
      encodedConstructor.value.value,
      limit,
      (_hash: string) => { deployPhase.value = "pending"; consoleEntries.value.push("Deployment submitted"); }
    );
    targetId.value = result.programId;
    deployPhase.value = "confirmed";
    inspectorTab.value = "interact";
    consoleEntries.value.push(`Deployment confirmed · ${short(result.programId, 12, 10)}`);
    toast.success("Mini contract deployed.");
  } catch (cause) {
    deployPhase.value = "idle";
    toast.error(friendlyError(cause));
    consoleEntries.value.push("Deployment failed");
  }
}

function parsedArgs(fn: StudioFunction): unknown[] {
  const values = functionArgs.value[fn.selector] ?? [];
  return fn.inputs.map((type, index) => parseScalar(type, values[index] ?? ""));
}

async function invoke(fn: StudioFunction) {
  if (!build.value) return;
  if (!/^0x[0-9a-fA-F]{64}$/.test(targetId.value.trim())) {
    functionResults.value[fn.selector] = "Enter a valid 32-byte Mini Contract address.";
    return;
  }
  activeFunction.value = fn.selector;
  functionResults.value[fn.selector] = fn.view ? "Calling…" : "Preparing transaction…";
  try {
    const args = parsedArgs(fn);
    if (fn.view) {
      const result = await readMiniContract(targetId.value.trim(), fn.signature, fn.inputs, fn.outputs, args);
      functionResults.value[fn.selector] = result.values.length ? result.values.join(", ") : `Success · ${result.bytesUsed} bytes used`;
      consoleEntries.value.push(`${fn.signature} called`);
    } else {
      if (!wallet.address.value || !wallet.signer.value) {
        await wallet.connect();
        functionResults.value[fn.selector] = "Wallet connected. Send the transaction again.";
        return;
      }
      const receipt = await writeMiniContract(wallet.signer.value, wallet.address.value, targetId.value.trim(), fn.signature, fn.inputs, args, Number(byteGasLimit.value), (hash: string) => {
        functionResults.value[fn.selector] = `Pending · ${short(hash, 10, 8)}`;
      });
      functionResults.value[fn.selector] = `Confirmed · block ${receipt.blockNumber}`;
      consoleEntries.value.push(`${fn.signature} confirmed`);
    }
  } catch (cause) {
    functionResults.value[fn.selector] = friendlyError(cause);
  } finally {
    activeFunction.value = null;
  }
}

const copy = (value: string) => void navigator.clipboard?.writeText(value);

watch(source, () => {
  saved.value = false;
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(() => void compile(false), 700);
});
onMounted(() => void compile(false));
</script>

<template>
  <main class="studio-page">
    <section class="studio-mobile-gate">
      <Terminal :size="32" />
      <h1>Studio requires a desktop screen</h1>
      <p>Open Swaputer Studio on a larger display to write, compile, deploy and operate mini contracts.</p>
      <RouterLink :to="OFFICIAL_FEATURES.seth ? '/bridge' : '/'">Return to {{ OFFICIAL_FEATURES.seth ? 'Bridge' : 'Explorer' }}</RouterLink>
    </section>

    <section class="studio-desktop">
      <div class="studio-workspace">
        <aside class="studio-explorer">
          <div class="studio-product-title">TinySol Studio</div>
          <h2>TEMPLATES</h2>
          <button v-for="template in STUDIO_TEMPLATES" :key="template.id" type="button" :class="{ active: templateId === template.id }" @click="chooseTemplate(template.id)"><FileCode2 :size="17" /><span><strong>{{ template.name }}</strong><small>{{ template.description }}</small></span></button>
          <div class="explorer-rule" />
          <h2>FILES</h2>
          <button class="active" type="button"><FileCode2 :size="17" /><span><strong>{{ fileName }}</strong></span></button>
          <button type="button"><FileCode2 :size="17" /><span><strong>README.md</strong></span></button>
          <button class="new-file" type="button" @click="newFile"><Plus :size="18" />New file</button>
        </aside>

        <section class="studio-editor-column">
          <div class="editor-toolbar">
            <button type="button" @click="newFile"><Plus :size="18" />New</button>
            <button type="button" @click="save"><Save :size="18" />{{ saved ? 'Saved' : 'Save' }}</button>
            <label><select v-model="templateId" @change="chooseTemplate(templateId)"><option v-for="template in STUDIO_TEMPLATES" :key="template.id" :value="template.id">{{ template.name }}</option></select><ChevronDown :size="16" /></label>
            <button class="compile-button" type="button" :disabled="buildPhase === 'compiling'" @click="compile()"><LoaderCircle v-if="buildPhase === 'compiling'" class="spin" :size="18" /><span v-else>▷</span>Compile</button>
          </div>
          <div class="editor-tab"><span>{{ fileName }}</span><small><i />{{ saved ? 'Saved locally' : 'Unsaved' }}</small></div>
          <CodeEditor v-model="source" />
          <div class="studio-console">
            <header><span>CONSOLE</span><button type="button" @click="consoleEntries = []">Clear</button></header>
            <div><p v-for="(entry, index) in consoleEntries.slice(-4)" :key="`${entry}-${index}`"><Check :size="14" />{{ entry }}</p></div>
          </div>
        </section>

        <aside class="studio-inspector">
          <nav>
            <button v-for="tab in (['build','deploy','interact'] as InspectorTab[])" :key="tab" type="button" :class="{ active: inspectorTab === tab }" @click="inspectorTab = tab">{{ tab.toUpperCase() }}</button>
          </nav>

          <div v-if="inspectorTab === 'build'" class="inspector-body">
            <div :class="['build-banner', `build-banner--${buildPhase}`]">
              <Check v-if="buildPhase === 'success'" :size="21" />
              <LoaderCircle v-else-if="buildPhase === 'compiling'" class="spin" :size="21" />
              <TriangleAlert v-else-if="buildPhase === 'error'" :size="21" />
              <span><strong>{{ buildPhase === 'success' ? 'Build succeeded' : buildPhase === 'compiling' ? 'Compiling' : buildPhase === 'error' ? 'Build failed' : 'Ready to build' }}</strong><small>{{ buildError || (build ? `${build.functions.length} external functions` : 'Compile the current source') }}</small></span>
            </div>
            <dl class="inspector-metrics">
              <div><dt>Code size</dt><dd>{{ build ? `${build.codeLength} B` : '—' }}</dd></div>
              <div><dt>Package size</dt><dd>{{ build ? `${build.packageLength} B` : '—' }}</dd></div>
              <div><dt>Functions</dt><dd>{{ build?.functions.length ?? '—' }}</dd></div>
              <div><dt>Constructor</dt><dd>{{ build?.constructorTypes.length ? `${build.constructorTypes.length} args` : 'none' }}</dd></div>
            </dl>
            <div class="hash-block"><span>Package hash</span><code>{{ build ? short(build.codeHash, 18, 14) : '—' }}</code><button type="button" :disabled="!build" @click="build && copy(build.codeHash)"><Copy :size="15" /></button></div>
            <div class="function-index"><h3>Functions</h3><div v-for="fn in build?.functions" :key="fn.selector"><code>{{ fn.signature }}</code><span>{{ fn.view ? 'read' : 'write' }}</span></div></div>
            <button class="inspector-primary" type="button" :disabled="!build" @click="inspectorTab = 'deploy'">Continue to deploy</button>
          </div>

          <div v-else-if="inspectorTab === 'deploy'" class="inspector-body deploy-panel">
            <div class="panel-intro"><h2>{{ build?.contractName || 'Compile first' }}</h2><p>Constructor arguments are encoded from the compiled ABI.</p></div>
            <div v-if="build?.constructorTypes.length" class="constructor-fields">
              <label v-for="(type, index) in build.constructorTypes" :key="`${type}-${index}`"><span>Argument {{ index + 1 }}</span><small>{{ type }}</small><input v-model="constructorValues[index]" :placeholder="type" spellcheck="false" /></label>
            </div>
            <p v-else class="no-constructor">This contract has no constructor arguments.</p>
            <label class="encoded-args"><span>Encoded constructor data</span><textarea :value="encodedConstructor.error || encodedConstructor.value" readonly /></label>
            <label class="gas-input"><span>Byte gas limit</span><input v-model="byteGasLimit" inputmode="numeric" /></label>
            <dl class="deploy-summary"><div><dt>Network</dt><dd>{{ NETWORK.displayName }}</dd></div><div><dt>Wallet</dt><dd>{{ wallet.address.value ? short(wallet.address.value) : 'Not connected' }}</dd></div></dl>
            <button class="inspector-primary" type="button" :disabled="deployPhase === 'signing' || deployPhase === 'pending' || !build" @click="deploy"><LoaderCircle v-if="deployPhase === 'signing' || deployPhase === 'pending'" class="spin" :size="17" />{{ !wallet.address.value ? 'Connect wallet' : deployPhase === 'signing' ? 'Confirm signature' : deployPhase === 'pending' ? 'Deploying' : 'Deploy contract' }}</button>
          </div>

          <div v-else class="inspector-body interact-panel">
            <div class="status-strip"><span><Check :size="15" />{{ buildPhase === 'success' ? `Build passed · ${build?.codeLength} B` : 'Build required' }}</span><span><Check v-if="deployed" :size="15" />{{ deployed ? `Deployed · ${NETWORK.displayName}` : 'Address required' }}</span></div>
            <label class="target-input"><span>MINI CONTRACT ADDRESS</span><div><input v-model="targetId" spellcheck="false" placeholder="0x…" /><button type="button" :disabled="!targetId" @click="copy(targetId)"><Copy :size="15" /></button></div></label>
            <a v-if="deployed" :href="`${NETWORK.explorerUrl}/address/${SWAPVM.kernel}`" target="_blank" rel="noreferrer">View protocol transaction</a>
            <div v-if="!build" class="interact-empty">Compile the matching source to generate the contract interaction form.</div>
            <section v-for="fn in build?.functions" :key="fn.selector" class="function-card">
              <header><span>{{ fn.view ? 'READ' : 'WRITE' }}</span><code>{{ fn.signature }}</code></header>
              <label v-for="(type, index) in fn.inputs" :key="`${fn.selector}-${index}`"><span>Argument {{ index + 1 }}</span><small>{{ type }}</small><input v-model="functionArgs[fn.selector]![index]" :placeholder="type" spellcheck="false" /></label>
              <button :class="{ primary: !fn.view }" type="button" :disabled="activeFunction === fn.selector" @click="invoke(fn)"><LoaderCircle v-if="activeFunction === fn.selector" class="spin" :size="15" />{{ fn.view ? 'Call' : 'Send transaction' }}</button>
              <output v-if="functionResults[fn.selector]">{{ functionResults[fn.selector] }}</output>
            </section>
          </div>
        </aside>
      </div>

      <footer class="studio-statusbar"><span>TinySol 0.3</span><span>{{ fileName }}</span><span>UTF-8</span><span><i />{{ buildPhase === 'error' ? 'Build error' : 'Ready' }}</span></footer>
    </section>
  </main>
</template>
