import { tokenAmount } from "./format";
import { subscribeExplorerRealtime } from "./realtime";

export const EXPLORER_API = String(
  import.meta.env.VITE_SVM_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:8080" : "/api")
).replace(/\/+$/, "");

export interface IndexerStatus {
  chainId: number;
  kernelAddress: string;
  worldId: string;
  nextBlock: number;
  canonicalTip: number | null;
  finalizedTip: number | null;
  executions: number;
  accounts: number;
  events: number;
  deployments: number;
  errors: number;
  updatedAt: string;
}

export interface TransactionSummary {
  hash: string;
  blockNumber: number;
  blockTime: string;
  executionHeight: number;
  actor: string;
  rootTarget: string;
  executedBytes: number;
  canonical: boolean;
  finalized: boolean;
}

export interface LatestEvent {
  transactionHash: string;
  blockNumber: number;
  blockTime: string;
  emitter: string;
  event: string;
}

export interface EventDetail {
  index: number;
  emitter: string;
  topics: string[];
  data: string;
  kind: string;
}

export interface ExecutionDetail {
  id: number;
  ethereumLogIndex: number;
  worldId: string;
  executionHeight: number;
  actor: string;
  rootTarget: string;
  executedBytes: number;
  tokenBurned: string;
  grossTokenOut: string;
  netTokenOut: string;
  rawReceipt: string;
  receiptVersion?: number;
  receiptFlags?: number;
  events: EventDetail[];
}

export interface TransactionDetail {
  hash: string;
  blockNumber: number;
  blockHash: string;
  blockTime: string;
  transactionIndex: number;
  sender: string;
  recipient?: string;
  nonce: number;
  valueWei: string;
  status: number;
  gasUsed: string;
  input: string;
  canonical: boolean;
  finalized: boolean;
  executions: ExecutionDetail[];
}

export interface TokenSummary {
  programId: string;
  codeHash: string;
  creator: string;
  deploymentBlock: number;
  name: string;
  symbol: string;
  decimals: number;
  cap: string;
  mintAmount: string;
  totalSupply: string;
  holderCount: number;
  canonical: boolean;
  finalized: boolean;
}

export interface ContractSummary {
  programId: string;
  codeHash: string;
  creator: string;
  deploymentBlock: number;
  creationTransactionHash: string;
  canonical: boolean;
  finalized: boolean;
}

export interface ContractDetail extends ContractSummary {
  token?: TokenSummary;
}

export interface TokenHolder {
  accountId: string;
  evmAddress?: string;
  balance: string;
}

export interface TransferDetail {
  transactionHash: string;
  blockNumber: number;
  blockTime: string;
  sender: string;
  recipient: string;
  amount: string;
  mint: boolean;
  burn: boolean;
  finalized: boolean;
}

export interface AddressBalance {
  programId: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  totalSupply: string;
}

export interface AddressDetail {
  query: string;
  accountId: string;
  evmAddress?: string;
  transactionCount?: number;
  balances: AddressBalance[];
  transactions: TransactionSummary[];
}

type Items<T> = { items: T[] };
export type CursorPage<T> = Items<T> & { nextCursor?: string };
type SearchResult = { type: "transaction" | "address" | "contract"; route: string };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${EXPLORER_API}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new Error(body?.error?.code || `INDEXER_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const explorerApi = {
  status: () => get<IndexerStatus>("/v1/status"),
  transactions: (limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<TransactionSummary>>(`/v1/transactions?${params}`);
  },
  events: (limit = 50) => get<Items<LatestEvent>>(`/v1/events?limit=${limit}`).then((value) => value.items),
  transaction: (hash: string) => get<TransactionDetail>(`/v1/transactions/${encodeURIComponent(hash)}`),
  address: (address: string) => get<AddressDetail>(`/v1/addresses/${encodeURIComponent(address)}`),
  addressTransactions: (address: string, limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<TransactionSummary>>(`/v1/addresses/${encodeURIComponent(address)}/transactions?${params}`);
  },
  contracts: (limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<ContractSummary>>(`/v1/contracts?${params}`);
  },
  contract: (program: string) => get<ContractDetail>(`/v1/contracts/${encodeURIComponent(program)}`),
  contractTransactions: (program: string, limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<TransactionSummary>>(`/v1/contracts/${encodeURIComponent(program)}/transactions?${params}`);
  },
  holders: (program: string, limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<TokenHolder>>(`/v1/src20/${encodeURIComponent(program)}/holders?${params}`);
  },
  transfers: (program: string, limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<TransferDetail>>(`/v1/src20/${encodeURIComponent(program)}/transfers?${params}`);
  },
  search: (query: string) => get<SearchResult>(`/v1/search?q=${encodeURIComponent(query)}`)
};

export function subscribeExplorer(onEvent: () => void): () => void {
  return subscribeExplorerRealtime(EXPLORER_API, onEvent);
}

export function shortHex(value: string, left = 7, right = 5): string {
  if (!value || value.length <= left + right + 1) return value || "—";
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function formatAge(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    try { return BigInt(value).toLocaleString("en-US"); }
    catch { /* fall through for malformed numeric strings */ }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US") : "—";
}

export function formatUnitsExact(value: string, decimals: number, precision = 6): string {
  return tokenAmount(value, decimals, precision);
}
