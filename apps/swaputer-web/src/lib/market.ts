import {
  AbiCoder,
  Contract,
  ZeroAddress,
  getAddress,
  id,
  isAddress,
  type ContractTransactionReceipt,
	 type ContractRunner,
  type Signer
} from "ethers";
import marketEscrowSource from "../../../../tooling/tinysol/programs/market-escrow/MarketEscrow.tiny.sol?raw";
import { MARKET, MARKET_ABI, MARKET_FACTORY_ABI, SWAPVM } from "./config";
import {
  buildSignedCallEnvelope,
  deployMiniContract,
  kernelContract,
  previewDeployment,
  readAccountId,
  readMiniUint,
  readProvider,
  writeMiniContract
} from "./protocol";

const ESCROW_BYTE_GAS_LIMIT = 8_000;
import { compileStudioSource, encodeConstructorArguments, type StudioBuild } from "./studio";
import type { MarketOrder } from "./explorer";

const abi = AbiCoder.defaultAbiCoder();
const TOKEN_SCALE = 10n ** 18n;
let escrowBuildPromise: Promise<StudioBuild> | null = null;

function requireMarket(): void {
  if (!MARKET.enabled || !isAddress(MARKET.factoryAddress)) throw new Error("The SRC20 market factory is not configured.");
}

function factory(runner: ContractRunner = readProvider) {
  requireMarket();
  return new Contract(getAddress(MARKET.factoryAddress), MARKET_FACTORY_ABI, runner);
}

function market(address: string, runner: ContractRunner = readProvider) {
  if (!isAddress(address) || getAddress(address) === ZeroAddress) throw new Error("This SRC20 does not have a market yet.");
  return new Contract(getAddress(address), MARKET_ABI, runner);
}

async function confirmed(transaction: { wait(): Promise<ContractTransactionReceipt | null> }, error: string) {
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error(error);
  return receipt;
}

function callPayload(signature: string, types: readonly string[], values: readonly unknown[]): string {
  const encoded = types.length ? abi.encode([...types], [...values]) : "0x";
  return `${id(signature).slice(0, 10)}${encoded.slice(2)}`;
}

export function quotePriceWei(amount: bigint, unitPriceWei: bigint): bigint {
  if (amount <= 0n || unitPriceWei <= 0n) throw new Error("Amount and price must be greater than zero.");
  const value = amount * unitPriceWei / TOKEN_SCALE;
  if (value <= 0n) throw new Error("The quoted total is too small.");
  return value;
}

export async function marketAddressFor(program: string): Promise<string | null> {
  const value = await factory().getFunction("marketFor").staticCall(program) as string;
  return getAddress(value) === ZeroAddress ? null : getAddress(value);
}

export async function marketBindingFor(program: string): Promise<{ marketAddress: string; escrowId: string } | null> {
  const marketAddress = await marketAddressFor(program);
  if (!marketAddress) return null;
  const escrowId = await market(marketAddress).getFunction("escrow").staticCall() as string;
  return { marketAddress, escrowId };
}

async function escrowBuild(): Promise<StudioBuild> {
  escrowBuildPromise ??= compileStudioSource(marketEscrowSource, "MarketEscrow.tiny.sol");
  const result = await escrowBuildPromise;
  if (result.codeHash.toLowerCase() !== MARKET.escrowCodeHash.toLowerCase()) {
    throw new Error("Market escrow package identity check failed.");
  }
  return result;
}

export async function createMarketForToken(
  signer: Signer,
  actor: string,
  program: string,
  onPhase?: (phase: "deploying-escrow" | "creating-market", hash?: string) => void
): Promise<string> {
  requireMarket();
  const build = await escrowBuild();
  const preview = await previewDeployment(actor, build.packageBytes);
  const tokenCodeHash = await kernelContract().getFunction("programCodeHash").staticCall(SWAPVM.worldId, program) as string;
  if (tokenCodeHash === "0x" + "00".repeat(32)) throw new Error("The SRC20 mini contract is not deployed in this SVM world.");
  const predicted = await factory().getFunction("predictMarket").staticCall(program, tokenCodeHash, preview.programId) as string;
  const constructorArgs = encodeConstructorArguments(["bytes32", "address"], [program, getAddress(predicted)]);
  onPhase?.("deploying-escrow");
  await deployMiniContract(signer, actor, build.packageBytes, constructorArgs, 16_000, (hash) => onPhase?.("deploying-escrow", hash));
  onPhase?.("creating-market");
  const tx = await factory(signer).getFunction("createMarket")(program, tokenCodeHash, preview.programId);
  await confirmed(tx, "Market creation was not confirmed.");
  const created = await marketAddressFor(program);
  if (!created || created.toLowerCase() !== String(predicted).toLowerCase()) throw new Error("The created market binding could not be verified.");
  return created;
}

export async function createOrder(
  signer: Signer,
  actor: string,
  program: string,
  marketAddress: string,
  escrowId: string,
  side: "buy" | "sell",
  amount: bigint,
  unitPriceWei: bigint,
  vmETHAmount: bigint,
  expiry: bigint
): Promise<ContractTransactionReceipt> {
  const contract = market(marketAddress, signer);
  const total = quotePriceWei(amount, unitPriceWei);
  if (side === "buy") {
    const tx = await contract.getFunction("createBuyOrder")(amount, unitPriceWei, vmETHAmount, expiry, { value: total + vmETHAmount });
    return confirmed(tx, "Buy order creation was not confirmed.");
  }
  const sellerId = await readAccountId(actor);
  const allowance = await readMiniUint(program, "allowance(bytes32,bytes32)", ["bytes32", "bytes32"], [sellerId, escrowId]);
  if (allowance < amount) {
    await writeMiniContract(signer, actor, program, "approve(bytes32,uint256)", ["bytes32", "uint256"], [escrowId, amount], 2_000);
  }
  const payload = callPayload("deposit(bytes32,uint256)", ["bytes32", "uint256"], [sellerId, amount]);
  const { envelope } = await buildSignedCallEnvelope(signer, actor, escrowId, payload, {
    recipient: actor,
    authorizedExecutor: getAddress(marketAddress),
    exactEthAmountIn: vmETHAmount,
    byteGasLimit: ESCROW_BYTE_GAS_LIMIT,
    executionRoute: "swaputer-router"
  });
  const tx = await contract.getFunction("createSellOrder")(amount, unitPriceWei, vmETHAmount, expiry, envelope, SWAPVM.sqrtPriceLimitX96!, { value: vmETHAmount });
  return confirmed(tx, "Sell order creation was not confirmed.");
}

export async function settleOrder(signer: Signer, actor: string, order: MarketOrder, escrowId: string): Promise<ContractTransactionReceipt> {
  const contract = market(order.marketAddress, signer);
  const amount = BigInt(order.amount);
  const vmETHAmount = BigInt(order.vmEthAmount);
  if (order.side === "buy") {
    const buyerId = await readAccountId(order.maker);
    const payload = callPayload("transfer(bytes32,uint256)", ["bytes32", "uint256"], [buyerId, amount]);
    const { envelope } = await buildSignedCallEnvelope(signer, actor, order.programId, payload, {
      recipient: actor,
      authorizedExecutor: getAddress(order.marketAddress),
      exactEthAmountIn: vmETHAmount,
      byteGasLimit: ESCROW_BYTE_GAS_LIMIT,
      executionRoute: "swaputer-router"
    });
    const tx = await contract.getFunction("fillBuyOrder")(order.orderId, envelope, SWAPVM.sqrtPriceLimitX96!);
    return confirmed(tx, "Order fill was not confirmed.");
  }
  const buyerId = await readAccountId(actor);
  const payload = callPayload("release(bytes32,uint256)", ["bytes32", "uint256"], [buyerId, amount]);
  const { envelope } = await buildSignedCallEnvelope(signer, actor, escrowId, payload, {
    recipient: actor,
    authorizedExecutor: getAddress(order.marketAddress),
    exactEthAmountIn: vmETHAmount,
    byteGasLimit: ESCROW_BYTE_GAS_LIMIT,
    executionRoute: "swaputer-router"
  });
  const tx = await contract.getFunction("settleSellOrder")(order.orderId, envelope, SWAPVM.sqrtPriceLimitX96!, { value: BigInt(order.priceWei) + vmETHAmount });
  return confirmed(tx, "Order settlement was not confirmed.");
}

export async function cancelMarketOrder(signer: Signer, actor: string, order: MarketOrder, escrowId: string): Promise<ContractTransactionReceipt> {
  const contract = market(order.marketAddress, signer);
  if (order.side === "buy") return confirmed(await contract.getFunction("cancelOrder")(order.orderId), "Order cancellation was not confirmed.");
  const actorId = await readAccountId(actor);
  const amount = BigInt(order.amount);
  const vmETHAmount = MARKET.defaultVMInputWei;
  const payload = callPayload("release(bytes32,uint256)", ["bytes32", "uint256"], [actorId, amount]);
  const { envelope } = await buildSignedCallEnvelope(signer, actor, escrowId, payload, {
    recipient: actor,
    authorizedExecutor: getAddress(order.marketAddress),
    exactEthAmountIn: vmETHAmount,
    byteGasLimit: ESCROW_BYTE_GAS_LIMIT,
    executionRoute: "swaputer-router"
  });
  const tx = await contract.getFunction("cancelSellOrder")(order.orderId, envelope, SWAPVM.sqrtPriceLimitX96!, { value: vmETHAmount });
  return confirmed(tx, "Order cancellation was not confirmed.");
}
