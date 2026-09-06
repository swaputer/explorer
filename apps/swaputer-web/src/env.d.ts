/// <reference types="vite/client" />

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
}

interface Window {
  ethereum?: EthereumProvider;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

declare module "*.tiny.sol?raw" {
  const source: string;
  export default source;
}
