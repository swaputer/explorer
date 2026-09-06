import { computed, ref, shallowRef } from "vue";
import type { BrowserProvider, Signer } from "ethers";
import { connectWallet, friendlyError } from "@/lib/protocol";
import { toast } from "@/composables/useToast";

const address = ref<string | null>(null);
// ethers instances carry private fields. They must not be wrapped in Vue's
// deep reactive Proxy or ethers will reject the proxied instance at call time.
const provider = shallowRef<BrowserProvider | null>(null);
const signer = shallowRef<Signer | null>(null);
const connecting = ref(false);

export function useWallet() {
  const connect = async () => {
    if (connecting.value) return;
    connecting.value = true;
    try {
      const wallet = await connectWallet();
      address.value = wallet.address;
      provider.value = wallet.provider;
      signer.value = wallet.signer;
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      connecting.value = false;
    }
  };

  return {
    address,
    provider,
    signer,
    connecting,
    connected: computed(() => Boolean(address.value)),
    connect
  };
}
