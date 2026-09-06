import { id } from "ethers";
import { tokenAmount } from "./format";
import { subscribeExplorerRealtime } from "./realtime";

export const EXPLORER_API = String(import.meta.env.VITE_SVM_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");

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
  amount?: string;
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

export type ContractStandard = "src20" | "unclassified";

export interface ContractSummary {
  programId: string;
  codeHash: string;
  creator: string;
  deploymentBlock: number;
  standard: ContractStandard;
  name?: string;
  symbol?: string;
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

export interface MarketSummary {
  programId: string;
  marketAddress: string;
  escrowId: string;
  name: string;
  symbol: string;
  decimals: number;
  bestBidWei?: string;
  bestAskWei?: string;
  openOrders: number;
  lastTradeTime?: string;
}

export interface MarketOrder {
  orderId: string;
  programId: string;
  marketAddress: string;
  side: "buy" | "sell";
  status: "open" | "filled" | "cancelled" | "expired";
  maker: string;
  taker?: string;
  amount: string;
  unitPriceWei: string;
  priceWei: string;
  vmEthAmount: string;
  expiry: number;
  blockNumber: number;
  transactionHash: string;
  finalized: boolean;
}

export interface MarketTrade {
  orderId: string;
  programId: string;
  marketAddress: string;
  side: "buy" | "sell";
  seller: string;
  buyer: string;
  amount: string;
  priceWei: string;
  unitPriceWei: string;
  blockNumber: number;
  blockTime: string;
  transactionHash: string;
  finalized: boolean;
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
  contracts: (standard: "all" | ContractStandard = "all", limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ standard, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<ContractSummary>>(`/v1/contracts?${params}`);
  },
  contract: (program: string) => get<ContractDetail>(`/v1/contracts/${encodeURIComponent(program)}`),
  contractTransactions: (program: string, limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<TransactionSummary>>(`/v1/contracts/${encodeURIComponent(program)}/transactions?${params}`);
  },
  tokens: (limit = 50) => get<Items<TokenSummary>>(`/v1/src20?limit=${limit}`).then((value) => value.items),
  token: (program: string) => get<TokenSummary>(`/v1/src20/${encodeURIComponent(program)}`),
  openMintTokens: (limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<TokenSummary>>(`/v1/minter/src20?${params}`);
  },
  openMintToken: (program: string) => get<TokenSummary>(`/v1/minter/src20/${encodeURIComponent(program)}`),
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
  markets: (limit = 100) => get<Items<MarketSummary>>(`/v1/market?limit=${limit}`).then((value) => value.items),
  market: (program: string) => get<MarketSummary>(`/v1/market/${encodeURIComponent(program)}`),
  marketOrders: (program: string, options: { status?: string; side?: string; maker?: string; limit?: number; cursor?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.side) params.set("side", options.side);
    if (options.maker) params.set("maker", options.maker);
    if (options.cursor) params.set("cursor", options.cursor);
    params.set("limit", String(options.limit ?? 100));
    return get<CursorPage<MarketOrder>>(`/v1/market/${encodeURIComponent(program)}/orders?${params}`);
  },
  marketTrades: (program: string, limit = 100, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return get<CursorPage<MarketTrade>>(`/v1/market/${encodeURIComponent(program)}/trades?${params}`);
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

export function eventName(event: EventDetail): string {
  const topic = event.topics[0]?.toLowerCase();
  if (topic === id("Transfer(bytes32,bytes32,uint256)").toLowerCase()) return "Transfer";
  if (topic === id("Approval(bytes32,bytes32,uint256)").toLowerCase()) return "Approval";
  return event.kind === "application" ? "ApplicationEvent" : event.kind;
}
