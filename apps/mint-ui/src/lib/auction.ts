import {
  AbiCoder,
  Contract,
  ZeroAddress,
  getAddress,
  id,
  type ContractRunner,
  type ContractTransactionReceipt,
  type Signer
} from "ethers";
import auctionEscrowSource from "../../../../tooling/tinysol/programs/auction-escrow/AuctionEscrow.tiny.sol?raw";
import {
  AUCTION_FACTORY_ABI,
  AUCTION_HOUSE_ABI,
  BASE_SEPOLIA,
  ROUTER_ABI,
  SRC20_AUCTION,
  SWAPVM
} from "../config";
import { deployMiniContract, previewMiniContractDeployment } from "./deployer";
import { compileStudioSource } from "./studio";
import {
  VM_ACTION_TYPES,
  buildCallAction,
  kernelContract,
  readAccountId,
  readProvider
} from "./swapvm";

export type AuctionStatus = "open" | "settled" | "cancelled";

export interface AuctionLot {
  readonly id: bigint;
  readonly seller: string;
  readonly highestBidder: string;
  readonly endTime: bigint;
  readonly status: AuctionStatus;
  readonly bidCount: bigint;
  readonly amount: bigint;
  readonly reservePriceWei: bigint;
  readonly highestBidWei: bigint;
  readonly vmEthAmount: bigint;
  readonly minimumNextBidWei: bigint;
}

export interface AuctionState {
  readonly factoryAddress: string | null;
  readonly auctionHouseAddress: string | null;
  readonly escrowId: string | null;
  readonly lots: readonly AuctionLot[];
  readonly claimableEth: bigint;
}

export interface CreateAuctionInput {
  readonly amount: bigint;
  readonly reservePriceWei: bigint;
  readonly vmEthAmount: bigint;
  readonly endTime: bigint;
}

const abiCoder = AbiCoder.defaultAbiCoder();
// The hardened escrow measures the token balance before and after movement,
// so it needs room for both nested static calls and the transfer itself.
const ESCROW_BYTE_GAS_LIMIT = 8_000;
const ESCROW_DEPLOY_BYTE_GAS_LIMIT = 16_000;
const UINT128_MAX = (1n << 128n) - 1n;

interface RawAuction {
  readonly seller?: unknown;
  readonly highestBidder?: unknown;
  readonly endTime?: unknown;
  readonly status?: unknown;
  readonly bidCount?: unknown;
  readonly amount?: unknown;
  readonly reservePriceWei?: unknown;
  readonly highestBidWei?: unknown;
  readonly vmEthAmount?: unknown;
  readonly [key: number]: unknown;
}

let escrowBuildPromise: ReturnType<typeof compileStudioSource> | null = null;

function escrowBuild() {
  escrowBuildPromise ??= compileStudioSource(auctionEscrowSource, "AuctionEscrow.tiny.sol");
  return escrowBuildPromise;
}

function configuredFactoryAddress(): string | null {
  if (!SRC20_AUCTION.enabled) return null;
  try {
    return getAddress(SRC20_AUCTION.factoryAddress);
  } catch {
    return null;
  }
}

function factory(runner: ContractRunner = readProvider): Contract {
  const address = configuredFactoryAddress();
  if (!address) throw new Error("The SRC20 auction factory is not configured for this release.");
  return new Contract(address, AUCTION_FACTORY_ABI, runner);
}

function auctionHouse(address: string, runner: ContractRunner = readProvider): Contract {
  return new Contract(getAddress(address), AUCTION_HOUSE_ABI, runner);
}

function safeBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && value.trim() !== "") {
    try { return BigInt(value); } catch { return null; }
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    try { return BigInt((value as { toString(): string }).toString()); } catch { return null; }
  }
  return null;
}

function safeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { return getAddress(value); } catch { return null; }
}

function normalizeTuple(raw: unknown): RawAuction | null {
  if (!raw || typeof raw !== "object") return null;
  const top = raw as RawAuction;
  if (top.seller !== undefined || top[0] !== undefined) return top;
  const nested = (raw as { [key: number]: unknown })[0];
  return nested && typeof nested === "object" ? nested as RawAuction : null;
}

function decodeStatus(value: unknown): AuctionStatus | null {
  const status = safeBigInt(value);
  if (status === 1n) return "open";
  if (status === 2n) return "settled";
  if (status === 3n) return "cancelled";
  return null;
}

export function decodeAuctionLot(idValue: bigint, raw: unknown, minimumNextBidWei: bigint): AuctionLot | null {
  const tuple = normalizeTuple(raw);
  if (!tuple) return null;
  const seller = safeAddress(tuple.seller ?? tuple[0]);
  const highestBidder = safeAddress(tuple.highestBidder ?? tuple[1]);
  const endTime = safeBigInt(tuple.endTime ?? tuple[2]);
  const status = decodeStatus(tuple.status ?? tuple[3]);
  const bidCount = safeBigInt(tuple.bidCount ?? tuple[4]);
  const amount = safeBigInt(tuple.amount ?? tuple[5]);
  const reservePriceWei = safeBigInt(tuple.reservePriceWei ?? tuple[6]);
  const highestBidWei = safeBigInt(tuple.highestBidWei ?? tuple[7]);
  const vmEthAmount = safeBigInt(tuple.vmEthAmount ?? tuple[8]);
  if (
    !seller || !highestBidder || endTime === null || !status || bidCount === null || amount === null
    || reservePriceWei === null || highestBidWei === null || vmEthAmount === null
  ) return null;
  return {
    id: idValue,
    seller,
    highestBidder,
    endTime,
    status,
    bidCount,
    amount,
    reservePriceWei,
    highestBidWei,
    vmEthAmount,
    minimumNextBidWei
  };
}

async function verifyFactoryBindings(contract: Contract): Promise<void> {
  const [router, kernel, worldId, escrowCodeHash] = await Promise.all([
    contract.getFunction("router").staticCall() as Promise<string>,
    contract.getFunction("kernel").staticCall() as Promise<string>,
    contract.getFunction("worldId").staticCall() as Promise<string>,
    contract.getFunction("escrowCodeHash").staticCall() as Promise<string>
  ]);
  if (
    getAddress(router) !== getAddress(SWAPVM.router)
    || getAddress(kernel) !== getAddress(SWAPVM.kernel)
    || worldId.toLowerCase() !== SWAPVM.worldId.toLowerCase()
    || escrowCodeHash.toLowerCase() !== SRC20_AUCTION.escrowCodeHash.toLowerCase()
  ) throw new Error("The auction factory bindings do not match this Swaputer World.");
}

async function verifyHouseBindings(contract: Contract): Promise<string> {
  const [router, kernel, worldId, token, escrow, escrowCodeHash] = await Promise.all([
    contract.getFunction("router").staticCall() as Promise<string>,
    contract.getFunction("kernel").staticCall() as Promise<string>,
    contract.getFunction("worldId").staticCall() as Promise<string>,
    contract.getFunction("token").staticCall() as Promise<string>,
    contract.getFunction("escrow").staticCall() as Promise<string>,
    contract.getFunction("escrowCodeHash").staticCall() as Promise<string>
  ]);
  if (
    getAddress(router) !== getAddress(SWAPVM.router)
    || getAddress(kernel) !== getAddress(SWAPVM.kernel)
    || worldId.toLowerCase() !== SWAPVM.worldId.toLowerCase()
    || token.toLowerCase() !== SWAPVM.programId.toLowerCase()
    || escrowCodeHash.toLowerCase() !== SRC20_AUCTION.escrowCodeHash.toLowerCase()
  ) throw new Error("The auction house bindings do not match the active SRC20 program.");
  return escrow;
}

async function currentHouseAddress(contract = factory()): Promise<string | null> {
  const value = (await contract.getFunction("auctionHouseFor").staticCall(SWAPVM.programId)) as string;
  return getAddress(value) === ZeroAddress ? null : getAddress(value);
}

export async function readAuctionState(account?: string | null): Promise<AuctionState> {
  const factoryAddress = configuredFactoryAddress();
  if (!factoryAddress) return { factoryAddress: null, auctionHouseAddress: null, escrowId: null, lots: [], claimableEth: 0n };
  const factoryContract = factory();
  await verifyFactoryBindings(factoryContract);
  const houseAddress = await currentHouseAddress(factoryContract);
  if (!houseAddress) return { factoryAddress, auctionHouseAddress: null, escrowId: null, lots: [], claimableEth: 0n };
  const house = auctionHouse(houseAddress);
  const escrowId = await verifyHouseBindings(house);
  const count = (await house.getFunction("auctionCount").staticCall()) as bigint;
  const floor = count > BigInt(SRC20_AUCTION.maxVisibleAuctions)
    ? count - BigInt(SRC20_AUCTION.maxVisibleAuctions) + 1n
    : 1n;
  const ids: bigint[] = [];
  for (let auctionId = count; auctionId >= floor && auctionId > 0n; auctionId -= 1n) ids.push(auctionId);
  const rows = await Promise.all(ids.map(async (auctionId) => {
    const [raw, minimum] = await Promise.all([
      house.getFunction("getAuction").staticCall(auctionId),
      house.getFunction("minimumNextBid").staticCall(auctionId) as Promise<bigint>
    ]);
    return decodeAuctionLot(auctionId, raw, minimum);
  }));
  const claimableEth = account
    ? await house.getFunction("claimableEth").staticCall(getAddress(account)) as bigint
    : 0n;
  return {
    factoryAddress,
    auctionHouseAddress: houseAddress,
    escrowId,
    lots: rows.filter((row): row is AuctionLot => row !== null),
    claimableEth
  };
}

async function confirmed(transactionPromise: Promise<{ hash: string; wait(): Promise<ContractTransactionReceipt | null> }>) {
  const transaction = await transactionPromise;
  console.info("[auction] tx submitted", { hash: transaction.hash });
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Auction transaction was not confirmed successfully.");
  return receipt;
}

async function signedEscrowEnvelope(
  signer: Signer,
  actor: string,
  escrowId: string,
  payload: string,
  recipient: string,
  houseAddress: string,
  vmEthAmount: bigint,
  byteGasLimit = ESCROW_BYTE_GAS_LIMIT
) {
  const actorId = await readAccountId(actor);
  const nonce = await kernelContract().getFunction("nonces").staticCall(SWAPVM.worldId, actorId) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const { typedAction: action } = buildCallAction(actor, payload, nonce, deadline, byteGasLimit, {
    recipient,
    authorizedExecutor: houseAddress,
    exactEthAmountIn: vmEthAmount,
    targetOrCodeHash: escrowId
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

export function encodeAuctionEscrowPayload(signature: "deposit(bytes32,uint256)" | "release(bytes32,uint256)", accountId: string, amount: bigint): string {
  return `${id(signature).slice(0, 10)}${abiCoder.encode(["bytes32", "uint256"], [accountId, amount]).slice(2)}`;
}

async function readAllowance(ownerId: string, spenderId: string): Promise<bigint> {
  const payload = `${id("allowance(bytes32,bytes32)").slice(0, 10)}${abiCoder
    .encode(["bytes32", "bytes32"], [ownerId, spenderId])
    .slice(2)}`;
  const [output] = await kernelContract().getFunction("staticCall").staticCall(
    SWAPVM.worldId,
    SWAPVM.programId,
    payload,
    2_000
  ) as [string, bigint];
  return abiCoder.decode(["uint256"], output)[0] as bigint;
}

async function approveEscrow(signer: Signer, actor: string, escrowId: string, amount: bigint, vmEthAmount: bigint) {
  const actorId = await readAccountId(actor);
  const nonce = await kernelContract().getFunction("nonces").staticCall(SWAPVM.worldId, actorId) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const payload = encodeAuctionEscrowPayload("deposit(bytes32,uint256)", escrowId, amount)
    .replace(id("deposit(bytes32,uint256)").slice(0, 10), id("approve(bytes32,uint256)").slice(0, 10));
  const { typedAction: action } = buildCallAction(actor, payload, nonce, deadline, SWAPVM.approvalByteGasLimit, {
    recipient: actor,
    authorizedExecutor: actor,
    exactEthAmountIn: vmEthAmount,
    targetOrCodeHash: SWAPVM.programId
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
  const envelope = {
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
  const router = new Contract(SWAPVM.router, ROUTER_ABI, signer);
  await confirmed(router.getFunction("buyVMExactInput")(
    SWAPVM.worldId,
    SWAPVM.sqrtPriceLimitX96,
    envelope,
    { value: vmEthAmount }
  ));
}

async function ensureAuctionHouse(signer: Signer, actor: string): Promise<{ houseAddress: string; escrowId: string }> {
  const factoryContract = factory(signer);
  await verifyFactoryBindings(factoryContract);
  const existing = await currentHouseAddress(factoryContract);
  if (existing) {
    const escrowId = await verifyHouseBindings(auctionHouse(existing));
    return { houseAddress: existing, escrowId };
  }

  const build = await escrowBuild();
  if (build.codeHash.toLowerCase() !== SRC20_AUCTION.escrowCodeHash.toLowerCase()) {
    throw new Error("The bundled AuctionEscrow source does not match the canonical factory code hash.");
  }
  const preview = await previewMiniContractDeployment(actor, build.packageBytes);
  const tokenCodeHash = await kernelContract().getFunction("programCodeHash").staticCall(
    SWAPVM.worldId,
    SWAPVM.programId
  ) as string;
  const predictedHouse = await factoryContract.getFunction("predictAuctionHouse").staticCall(
    SWAPVM.programId,
    tokenCodeHash,
    preview.programId
  ) as string;
  const constructorArgs = abiCoder.encode(["bytes32", "address"], [SWAPVM.programId, predictedHouse]);
  await deployMiniContract(
    signer,
    actor,
    build.packageBytes,
    constructorArgs,
    ESCROW_DEPLOY_BYTE_GAS_LIMIT,
    SRC20_AUCTION.defaultVMInputWei
  );
  await confirmed(factoryContract.getFunction("createAuctionHouse")(
    SWAPVM.programId,
    tokenCodeHash,
    preview.programId
  ));
  const deployed = await currentHouseAddress(factoryContract);
  if (!deployed || getAddress(deployed) !== getAddress(predictedHouse)) {
    throw new Error("Auction house deployment did not match the deterministic address.");
  }
  return { houseAddress: deployed, escrowId: preview.programId };
}

function validateCreate(input: CreateAuctionInput) {
  if (input.amount <= 0n || input.amount > UINT128_MAX) throw new Error("Auction amount must fit uint128 and be greater than zero.");
  if (input.reservePriceWei <= 0n || input.reservePriceWei > UINT128_MAX) throw new Error("Reserve price must fit uint128 and be greater than zero.");
  if (input.vmEthAmount <= 0n || input.vmEthAmount > UINT128_MAX) throw new Error("VM execution budget must fit uint128 and be greater than zero.");
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (input.endTime <= now || input.endTime > now + 30n * 24n * 60n * 60n) throw new Error("Auction duration must be between now and 30 days.");
}

export async function createAuction(signer: Signer, input: CreateAuctionInput): Promise<ContractTransactionReceipt> {
  validateCreate(input);
  const actor = await signer.getAddress();
  const { houseAddress, escrowId } = await ensureAuctionHouse(signer, actor);
  const actorId = await readAccountId(actor);
  if (await readAllowance(actorId, escrowId) < input.amount) {
    await approveEscrow(signer, actor, escrowId, input.amount, input.vmEthAmount);
  }
  const payload = encodeAuctionEscrowPayload("deposit(bytes32,uint256)", actorId, input.amount);
  const envelope = await signedEscrowEnvelope(
    signer,
    actor,
    escrowId,
    payload,
    actor,
    houseAddress,
    input.vmEthAmount
  );
  return confirmed(auctionHouse(houseAddress, signer).getFunction("createAuction")(
    input.amount,
    input.reservePriceWei,
    input.vmEthAmount,
    input.endTime,
    envelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: input.vmEthAmount }
  ));
}

export async function bidOnAuction(signer: Signer, lot: AuctionLot, amountWei: bigint) {
  if (amountWei < lot.minimumNextBidWei) throw new Error("Bid is below the minimum next bid.");
  const state = await readAuctionState();
  if (!state.auctionHouseAddress) throw new Error("Auction house is not deployed.");
  return confirmed(auctionHouse(state.auctionHouseAddress, signer).getFunction("bid")(lot.id, { value: amountWei }));
}

export async function settleAuction(signer: Signer, lot: AuctionLot) {
  const actor = await signer.getAddress();
  const state = await readAuctionState(actor);
  if (!state.auctionHouseAddress || !state.escrowId) throw new Error("Auction house is not deployed.");
  if (lot.highestBidder === ZeroAddress) throw new Error("This auction has no winning bidder.");
  const winnerId = await readAccountId(lot.highestBidder);
  const payload = encodeAuctionEscrowPayload("release(bytes32,uint256)", winnerId, lot.amount);
  const envelope = await signedEscrowEnvelope(
    signer,
    actor,
    state.escrowId,
    payload,
    lot.highestBidder,
    state.auctionHouseAddress,
    lot.vmEthAmount
  );
  return confirmed(auctionHouse(state.auctionHouseAddress, signer).getFunction("settleAuction")(
    lot.id,
    envelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: lot.vmEthAmount }
  ));
}

export async function cancelAuction(signer: Signer, lot: AuctionLot) {
  const actor = await signer.getAddress();
  const state = await readAuctionState(actor);
  if (!state.auctionHouseAddress || !state.escrowId) throw new Error("Auction house is not deployed.");
  const actorId = await readAccountId(actor);
  const payload = encodeAuctionEscrowPayload("release(bytes32,uint256)", actorId, lot.amount);
  const envelope = await signedEscrowEnvelope(
    signer,
    actor,
    state.escrowId,
    payload,
    actor,
    state.auctionHouseAddress,
    lot.vmEthAmount
  );
  return confirmed(auctionHouse(state.auctionHouseAddress, signer).getFunction("cancelAuction")(
    lot.id,
    envelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: lot.vmEthAmount }
  ));
}

export async function withdrawAuctionEth(signer: Signer) {
  const state = await readAuctionState(await signer.getAddress());
  if (!state.auctionHouseAddress) throw new Error("Auction house is not deployed.");
  return confirmed(auctionHouse(state.auctionHouseAddress, signer).getFunction("withdrawEth")());
}
