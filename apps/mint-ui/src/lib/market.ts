import {
  AbiCoder,
  Contract,
  getAddress,
  id,
  isAddress,
  type ContractTransactionReceipt,
  type ContractRunner,
  type Signer
} from "ethers";
import { BASE_SEPOLIA, MARKET_ABI, ROUTER_ABI, SRC20_MARKET, SWAPVM } from "../config";
import {
  VM_ACTION_TYPES,
  buildCallAction,
  buildTransferPayload,
  kernelContract,
  readAccountId,
  readProvider
} from "./swapvm";

export type OrderSide = "buy" | "sell";
export type OrderStatus = "open" | "filled" | "cancelled";

export interface MarketOrder {
  readonly id: bigint;
  readonly side: OrderSide;
  readonly status: OrderStatus;
  readonly maker: string;
  readonly taker: string;
  readonly amount: bigint;
  readonly unitPriceWei: bigint;
  readonly priceWei: bigint;
  readonly vmEthAmount: bigint;
  readonly expiry: bigint;
}

export interface CreateOrderInput {
  readonly side: OrderSide;
  readonly amount: bigint;
  readonly unitPriceWei: bigint;
  readonly vmEthAmount: bigint;
  readonly expiry: bigint;
}

const sides = ["buy", "sell"] as const;
const abiCoder = AbiCoder.defaultAbiCoder();
// Balance-delta verification adds two nested SRC20 static calls around each
// escrow movement. Keep the client budget aligned with the hardened artifact.
const MARKET_BYTE_GAS_LIMIT = 8_000;
export const MARKET_TOKEN_SCALE = 10n ** 18n;
const UINT128_MAX = (1n << 128n) - 1n;

type EnumValue = bigint | number | string | undefined | null;

interface RawOrder {
  readonly side?: EnumValue;
  readonly status?: EnumValue;
  readonly maker?: unknown;
  readonly taker?: unknown;
  readonly amount?: bigint;
  readonly unitPriceWei?: bigint;
  readonly priceWei?: bigint;
  readonly vmEthAmount?: bigint;
  readonly expiry?: bigint;
  readonly [key: number]: unknown;
}

function normalizeRawOrder(raw: unknown): RawOrder | null {
  if (raw === null || raw === undefined) return null;
  const candidate = raw as RawOrder;

  const asTopLevel = looksLikeOrderTuple(candidate);
  if (asTopLevel) return candidate;

  const nested = (raw as { [key: number]: unknown })[0] as RawOrder;
  if (nested && looksLikeOrderTuple(nested)) return nested;

  return null;
}

function looksLikeOrderTuple(order: RawOrder | null | undefined): order is RawOrder {
  if (!order || typeof order !== "object") return false;
  if (order.side !== undefined || order.status !== undefined || order.maker !== undefined || order.taker !== undefined) {
    return true;
  }
  return order[0] !== undefined && order[1] !== undefined && order[2] !== undefined && order[3] !== undefined;
}

function safeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function safeBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    try {
      return BigInt((value as { toString(): string }).toString());
    } catch {
      return null;
    }
  }
  return null;
}

function warnMalformedOrder(
  orderId: bigint | undefined,
  reason: string,
  raw: unknown,
  extra: Record<string, unknown> = {}
) {
  console.warn("[market] skipping malformed order", {
    orderId: orderId?.toString(),
    reason,
    raw,
    ...extra
  });
}

function parseStatusLike(status: EnumValue): bigint | number | null {
  if (typeof status === "bigint") return status;
  if (typeof status === "number") return Number.isInteger(status) ? status : null;
  if (typeof status === "string") {
    if (/^\d+$/.test(status)) return BigInt(status);
    const lower = status.toLowerCase();
    if (lower === "open") return 1n;
    if (lower === "filled") return 2n;
    if (lower === "cancelled" || lower === "canceled") return 3n;
  }
  return null;
}

function parseSideLike(side: EnumValue): OrderSide | null {
  if (typeof side === "string") {
    const lowered = side.toLowerCase();
    if (lowered === "buy") return "buy";
    if (lowered === "sell") return "sell";
  }
  const parsed = parseStatusLike(side);
  if (parsed === null) return null;
  const i = Number(parsed);
  if (!Number.isSafeInteger(i)) return null;
  return sides[i as 0 | 1] ?? null;
}

function decodeStatus(status: EnumValue): OrderStatus | null {
  const value = parseStatusLike(status);
  if (value === null) return null;
  const i = Number(value);
  if (!Number.isSafeInteger(i)) return null;

  if (i === 1) return "open";
  if (i === 2) return "filled";
  if (i === 3) return "cancelled";
  return null;
}

export function quoteOrderPriceWei(amount: bigint, unitPriceWei: bigint): bigint {
  if (amount <= 0n) throw new Error("Order amount must be greater than zero.");
  if (unitPriceWei <= 0n) throw new Error("Order unit price must be greater than zero.");
  if (amount > UINT128_MAX || unitPriceWei > UINT128_MAX) {
    throw new Error("Order amount and unit price must fit uint128.");
  }
  const priceWei = amount * unitPriceWei / MARKET_TOKEN_SCALE;
  if (priceWei <= 0n || priceWei > UINT128_MAX) throw new Error("Quoted order total is outside uint128.");
  return priceWei;
}

export function decodeMarketOrder(orderId: bigint, raw: unknown): MarketOrder | null {
  const order = normalizeRawOrder(raw);
  if (!order) return null;
  const maker = safeAddress(order.maker ?? order[0]);
  const taker = safeAddress(order.taker ?? order[1]);
  const expiry = safeBigInt(order.expiry ?? order[2]);
  const side = parseSideLike((order.side ?? order[3]) as EnumValue);
  const status = decodeStatus((order.status ?? order[4]) as EnumValue);
  const amount = safeBigInt(order.amount ?? order[5]);
  const unitPriceWei = safeBigInt(order.unitPriceWei ?? order[6]);
  const priceWei = safeBigInt(order.priceWei ?? order[7]);
  const vmEthAmount = safeBigInt(order.vmEthAmount ?? order[8]);
  if (
    !maker || !taker || amount === null || unitPriceWei === null || priceWei === null
    || vmEthAmount === null || expiry === null || !side || !status
  ) return null;
  return { id: orderId, side, status, maker, taker, amount, unitPriceWei, priceWei, vmEthAmount, expiry };
}

export function configuredMarketAddress(): string | null {
  if (!SRC20_MARKET.address || !isAddress(SRC20_MARKET.address)) return null;
  return getAddress(SRC20_MARKET.address);
}

function market(runner: ContractRunner = readProvider): Contract {
  const address = configuredMarketAddress();
  if (!address) throw new Error("The SRC20 market is not deployed for this Base Sepolia release.");
  return new Contract(address, MARKET_ABI, runner);
}

async function verifyBindings(contract: Contract): Promise<void> {
  const [router, kernel, worldId, token] = await Promise.all([
    contract.getFunction("router").staticCall() as Promise<string>,
    contract.getFunction("kernel").staticCall() as Promise<string>,
    contract.getFunction("worldId").staticCall() as Promise<string>,
    contract.getFunction("token").staticCall() as Promise<string>
  ]);
  if (
    getAddress(router) !== getAddress(SWAPVM.router) ||
    getAddress(kernel) !== getAddress(SWAPVM.kernel) ||
    worldId.toLowerCase() !== SWAPVM.worldId.toLowerCase() ||
    token.toLowerCase() !== SWAPVM.programId.toLowerCase()
  ) {
    console.error("[market] binding mismatch", {
      expected: {
        router: SWAPVM.router,
        kernel: SWAPVM.kernel,
        worldId: SWAPVM.worldId,
        token: SWAPVM.programId
      },
      actual: { router, kernel, worldId, token }
    });
    throw new Error("Configured market does not match the pinned SwapVM World, Router, Kernel, and SRC20 program.");
  }
  if (SRC20_MARKET.sellEscrowEnabled) {
    const [escrow, escrowCodeHash] = await Promise.all([
      contract.getFunction("escrow").staticCall() as Promise<string>,
      contract.getFunction("escrowCodeHash").staticCall() as Promise<string>
    ]);
    if (
      escrow.toLowerCase() !== SRC20_MARKET.escrowId.toLowerCase()
      || (SRC20_MARKET.escrowCodeHash
        && escrowCodeHash.toLowerCase() !== SRC20_MARKET.escrowCodeHash.toLowerCase())
    ) {
      throw new Error("Configured market escrow does not match the pinned MiniVM escrow program.");
    }
  }
}

export async function readOrders(): Promise<readonly MarketOrder[]> {
  const contract = market();
  await verifyBindings(contract);
  const count = (await contract.getFunction("orderCount").staticCall()) as bigint;
  const floor = count > BigInt(SRC20_MARKET.maxVisibleOrders)
    ? count - BigInt(SRC20_MARKET.maxVisibleOrders) + 1n
    : 1n;
  const ids: bigint[] = [];
  for (let id = count; id >= floor && id > 0n; id -= 1n) ids.push(id);
  const rawOrders = await Promise.all(ids.map((id) => contract.getFunction("getOrder").staticCall(id)));
  const parsed = rawOrders
    .map((raw, index) => {
    const orderId = ids[index];
    if (orderId === undefined) {
      warnMalformedOrder(orderId, "missing order id", raw);
      return;
    }
    try {
      const order = decodeMarketOrder(orderId, raw);
      if (!order) warnMalformedOrder(orderId, "unexpected or invalid getOrder return shape", raw);
      return order ?? undefined;
    } catch (cause) {
      warnMalformedOrder(orderId, "order decode exception", raw, { cause: String(cause) });
      return;
    }
    })
    .filter((order): order is MarketOrder => Boolean(order));

  return parsed as readonly MarketOrder[];
}

async function confirmed(transactionPromise: Promise<{ hash: string; wait(): Promise<ContractTransactionReceipt | null> }>) {
  const transaction = await transactionPromise;
  console.info("[market] tx submitted", { hash: transaction.hash });
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Market transaction was not confirmed successfully.");
  console.info("[market] tx confirmed", { hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber });
  return receipt;
}

export async function createOrder(signer: Signer, input: CreateOrderInput): Promise<ContractTransactionReceipt> {
  const contract = market(signer);
  await verifyBindings(contract);
  const priceWei = quoteOrderPriceWei(input.amount, input.unitPriceWei);
  if (input.side === "buy") {
    return confirmed(contract.getFunction("createBuyOrder")(
      input.amount,
      input.unitPriceWei,
      input.vmEthAmount,
      input.expiry,
      { value: priceWei + input.vmEthAmount }
    ));
  }
  requireSellEscrow();
  const seller = await signer.getAddress();
  const sellerId = await readAccountId(seller);
  const allowance = await readAllowance(sellerId, SRC20_MARKET.escrowId);
  if (allowance < input.amount) {
    const approvePayload = encodeMarketAccountAmountPayload("approve(bytes32,uint256)", SRC20_MARKET.escrowId, input.amount);
    const approveEnvelope = await signedProgramEnvelope(
      signer,
      seller,
      SWAPVM.programId,
      approvePayload,
      seller,
      seller,
      input.vmEthAmount,
      SWAPVM.approvalByteGasLimit
    );
    await submitDirectVM(signer, approveEnvelope, input.vmEthAmount);
  }
  const depositPayload = encodeMarketAccountAmountPayload("deposit(bytes32,uint256)", sellerId, input.amount);
  const depositEnvelope = await signedProgramEnvelope(
    signer,
    seller,
    SRC20_MARKET.escrowId,
    depositPayload,
    seller,
    configuredMarketAddressOrThrow(),
    input.vmEthAmount,
    MARKET_BYTE_GAS_LIMIT
  );
  return confirmed(contract.getFunction("createSellOrder")(
    input.amount,
    input.unitPriceWei,
    input.vmEthAmount,
    input.expiry,
    depositEnvelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: input.vmEthAmount }
  ));
}

async function signedTransferEnvelope(
  signer: Signer,
  seller: string,
  buyer: string,
  amount: bigint,
  vmEthAmount: bigint
) {
  const buyerId = await readAccountId(buyer);
  const payload = buildTransferPayload(buyerId, amount);
  return signedProgramEnvelope(
    signer,
    seller,
    SWAPVM.programId,
    payload,
    buyer,
    configuredMarketAddressOrThrow(),
    vmEthAmount,
    SWAPVM.transferByteGasLimit
  );
}

async function signedProgramEnvelope(
  signer: Signer,
  actor: string,
  targetOrCodeHash: string,
  payload: string,
  recipient: string,
  authorizedExecutor: string,
  vmEthAmount: bigint,
  byteGasLimit: number
) {
  const actorId = await readAccountId(actor);
  const nonce = (await kernelContract().getFunction("nonces").staticCall(SWAPVM.worldId, actorId)) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const { typedAction: action } = buildCallAction(actor, payload, nonce, deadline, byteGasLimit, {
    recipient,
    authorizedExecutor,
    exactEthAmountIn: vmEthAmount,
    targetOrCodeHash
  });
  const signature = await signer.signTypedData(
    {
      name: "Swaputer",
      version: SWAPVM.protocolVersion,
      chainId: BASE_SEPOLIA.chainId,
      verifyingContract: SWAPVM.kernel,
      salt: SWAPVM.worldId
    },
    VM_ACTION_TYPES,
    action
  );
  return {
    op: action.op,
    worldId: action.worldId,
    actor: action.actor,
    targetOrCodeHash: action.targetOrCodeHash,
    payload,
    byteGasLimit: action.byteGasLimit,
    minNetTokenOut: action.minNetTokenOut,
    nonce: action.nonce,
    deadline: action.deadline,
    recipient: action.recipient,
    authorizedExecutor: action.authorizedExecutor,
    signature
  };
}

function configuredMarketAddressOrThrow(): string {
  const address = configuredMarketAddress();
  if (!address) throw new Error("The SRC20 market is not configured.");
  return address;
}

function requireSellEscrow(): void {
  if (
    !SRC20_MARKET.sellEscrowEnabled
    || !/^0x[0-9a-fA-F]{64}$/.test(SRC20_MARKET.escrowId)
    || !/^0x[0-9a-fA-F]{64}$/.test(SRC20_MARKET.escrowCodeHash)
  ) {
    throw new Error("Sell escrow is not enabled for this SwapVM release.");
  }
}

export function encodeMarketAccountAmountPayload(signature: string, account: string, amount: bigint): string {
  return `${id(signature).slice(0, 10)}${abiCoder.encode(["bytes32", "uint256"], [account, amount]).slice(2)}`;
}

async function readAllowance(owner: string, spender: string): Promise<bigint> {
  const payload = `${id("allowance(bytes32,bytes32)").slice(0, 10)}${abiCoder
    .encode(["bytes32", "bytes32"], [owner, spender])
    .slice(2)}`;
  const [output] = (await kernelContract().getFunction("staticCall").staticCall(
    SWAPVM.worldId,
    SWAPVM.programId,
    payload,
    2_000
  )) as [string, bigint];
  return abiCoder.decode(["uint256"], output)[0] as bigint;
}

async function submitDirectVM(
  signer: Signer,
  envelope: Awaited<ReturnType<typeof signedProgramEnvelope>>,
  vmEthAmount: bigint
): Promise<ContractTransactionReceipt> {
  const router = new Contract(SWAPVM.router, ROUTER_ABI, signer);
  return confirmed(router.getFunction("buyVMExactInput")(
    SWAPVM.worldId,
    SWAPVM.sqrtPriceLimitX96,
    envelope,
    { value: vmEthAmount }
  ));
}

export async function cancelOrder(signer: Signer, order: MarketOrder): Promise<ContractTransactionReceipt> {
  const contract = market(signer);
  await verifyBindings(contract);
  if (order.side === "buy") return confirmed(contract.getFunction("cancelOrder")(order.id));
  requireSellEscrow();
  const seller = await signer.getAddress();
  const sellerId = await readAccountId(seller);
  const payload = encodeMarketAccountAmountPayload("release(bytes32,uint256)", sellerId, order.amount);
  const envelope = await signedProgramEnvelope(
    signer,
    seller,
    SRC20_MARKET.escrowId,
    payload,
    seller,
    configuredMarketAddressOrThrow(),
    order.vmEthAmount,
    MARKET_BYTE_GAS_LIMIT
  );
  return confirmed(contract.getFunction("cancelSellOrder")(
    order.id,
    envelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: order.vmEthAmount }
  ));
}

export async function settleOrder(
  signer: Signer,
  seller: string,
  order: MarketOrder
): Promise<ContractTransactionReceipt> {
  const contract = market(signer);
  await verifyBindings(contract);
  if (order.side === "buy") {
    const buyer = order.maker;
    const envelope = await signedTransferEnvelope(signer, seller, buyer, order.amount, order.vmEthAmount);
    return confirmed(contract.getFunction("fillBuyOrder")(order.id, envelope, SWAPVM.sqrtPriceLimitX96));
  }
  requireSellEscrow();
  const buyerId = await readAccountId(seller);
  const payload = encodeMarketAccountAmountPayload("release(bytes32,uint256)", buyerId, order.amount);
  const envelope = await signedProgramEnvelope(
    signer,
    seller,
    SRC20_MARKET.escrowId,
    payload,
    seller,
    configuredMarketAddressOrThrow(),
    order.vmEthAmount,
    MARKET_BYTE_GAS_LIMIT
  );
  return confirmed(contract.getFunction("settleSellOrder")(
    order.id,
    envelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: order.priceWei + order.vmEthAmount }
  ));
}
