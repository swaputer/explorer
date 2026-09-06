import {
  AbiCoder,
  Contract,
  ZeroAddress,
  getAddress,
  id,
  isAddress,
  type ContractRunner,
  type ContractTransactionReceipt,
  type Signer
} from "ethers";
import { BASE_SEPOLIA, SETH_BRIDGE, SETH_VAULT_ABI, SWAPVM } from "../config";
import { VM_ACTION_TYPES, buildCallAction, kernelContract, readAccountId, readProvider } from "./swapvm";

const abiCoder = AbiCoder.defaultAbiCoder();
const UINT128_MAX = (1n << 128n) - 1n;

export interface SETHBridgeSnapshot {
  readonly balance: bigint;
  readonly totalSupply: bigint;
  readonly lockedEth: bigint;
  readonly backingSurplus: bigint;
  readonly solvent: boolean;
}

export type BridgeDirection = "deposit" | "redeem";

export function configuredSETHVaultAddress(): string | null {
  if (!SETH_BRIDGE.enabled || !isAddress(SETH_BRIDGE.vaultAddress)) return null;
  return getAddress(SETH_BRIDGE.vaultAddress);
}

export function encodeBridgeMintPayload(recipientAccountId: string, amount: bigint): string {
  return `${id("bridgeMint(bytes32,uint256)").slice(0, 10)}${abiCoder
    .encode(["bytes32", "uint256"], [recipientAccountId, amount])
    .slice(2)}`;
}

export function encodeBridgeBurnPayload(amount: bigint): string {
  return `${id("bridgeBurn(uint256)").slice(0, 10)}${abiCoder.encode(["uint256"], [amount]).slice(2)}`;
}

export function validateBridgeAmount(amount: bigint, vmEthAmount: bigint): void {
  if (amount <= 0n) throw new Error("Bridge amount must be greater than zero.");
  if (vmEthAmount <= 0n) throw new Error("VM execution budget must be greater than zero.");
  if (amount > UINT128_MAX || vmEthAmount > UINT128_MAX) throw new Error("Bridge values must fit uint128.");
}

function vault(runner: ContractRunner = readProvider): Contract {
  const address = configuredSETHVaultAddress();
  if (!address) throw new Error("The sETH bridge is not configured for this release.");
  return new Contract(address, SETH_VAULT_ABI, runner);
}

async function verifyBindings(contract: Contract): Promise<void> {
  const [router, kernel, worldId, seth, codeHash] = await Promise.all([
    contract.getFunction("router").staticCall() as Promise<string>,
    contract.getFunction("kernel").staticCall() as Promise<string>,
    contract.getFunction("worldId").staticCall() as Promise<string>,
    contract.getFunction("seth").staticCall() as Promise<string>,
    contract.getFunction("sethCodeHash").staticCall() as Promise<string>
  ]);
  if (
    getAddress(router) !== getAddress(SWAPVM.router)
    || getAddress(kernel) !== getAddress(SWAPVM.kernel)
    || worldId.toLowerCase() !== SWAPVM.worldId.toLowerCase()
    || seth.toLowerCase() !== SETH_BRIDGE.programId.toLowerCase()
    || codeHash.toLowerCase() !== SETH_BRIDGE.codeHash.toLowerCase()
  ) throw new Error("Configured sETH Vault does not match the pinned SwapVM release.");
}

async function readSETHUint(signature: string, encodedArgs = "0x"): Promise<bigint> {
  const input = `${id(signature).slice(0, 10)}${encodedArgs.slice(2)}`;
  const [output] = (await kernelContract().getFunction("staticCall").staticCall(
    SWAPVM.worldId,
    SETH_BRIDGE.programId,
    input,
    2_000
  )) as [string, bigint];
  return abiCoder.decode(["uint256"], output)[0] as bigint;
}

export async function readSETHBridgeSnapshot(address?: string | null): Promise<SETHBridgeSnapshot> {
  const contract = vault();
  await verifyBindings(contract);
  const accountId = address ? await readAccountId(getAddress(address)) : null;
  const [balance, totalSupply, lockedEth, backingSurplus, solvent] = await Promise.all([
    accountId ? readSETHUint("balanceOf(bytes32)", abiCoder.encode(["bytes32"], [accountId])) : 0n,
    readSETHUint("totalSupply()"),
    contract.getFunction("lockedEth").staticCall() as Promise<bigint>,
    contract.getFunction("backingSurplus").staticCall() as Promise<bigint>,
    contract.getFunction("isSolvent").staticCall() as Promise<boolean>
  ]);
  return { balance, totalSupply, lockedEth, backingSurplus, solvent };
}

async function signedEnvelope(
  signer: Signer,
  actor: string,
  recipient: string,
  payload: string,
  vmEthAmount: bigint
) {
  const actorId = await readAccountId(actor);
  const nonce = (await kernelContract().getFunction("nonces").staticCall(SWAPVM.worldId, actorId)) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const vaultAddress = configuredSETHVaultAddress();
  if (!vaultAddress) throw new Error("The sETH bridge is not configured for this release.");
  const { typedAction: action } = buildCallAction(actor, payload, nonce, deadline, SETH_BRIDGE.byteGasLimit, {
    recipient,
    authorizedExecutor: vaultAddress,
    exactEthAmountIn: vmEthAmount,
    targetOrCodeHash: SETH_BRIDGE.programId
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

async function confirmed(
  transactionPromise: Promise<{ hash: string; wait(): Promise<ContractTransactionReceipt | null> }>,
  onSubmitted?: (transactionHash: string) => void
): Promise<ContractTransactionReceipt> {
  const transaction = await transactionPromise;
  onSubmitted?.(transaction.hash);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("sETH bridge transaction was not confirmed successfully.");
  return receipt;
}

export async function depositETH(
  signer: Signer,
  actorAddress: string,
  recipientAddress: string,
  amount: bigint,
  vmEthAmount: bigint,
  onSubmitted?: (transactionHash: string) => void
): Promise<ContractTransactionReceipt> {
  validateBridgeAmount(amount, vmEthAmount);
  const actor = getAddress(actorAddress);
  const recipient = getAddress(recipientAddress);
  if (recipient === ZeroAddress) throw new Error("Bridge recipient cannot be the zero address.");
  const contract = vault(signer);
  await verifyBindings(contract);
  const recipientId = await readAccountId(recipient);
  const envelope = await signedEnvelope(signer, actor, recipient, encodeBridgeMintPayload(recipientId, amount), vmEthAmount);
  return confirmed(contract.getFunction("deposit")(
    amount,
    vmEthAmount,
    envelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: amount + vmEthAmount }
  ), onSubmitted);
}

export async function redeemSETH(
  signer: Signer,
  actorAddress: string,
  recipientAddress: string,
  amount: bigint,
  vmEthAmount: bigint,
  onSubmitted?: (transactionHash: string) => void
): Promise<ContractTransactionReceipt> {
  validateBridgeAmount(amount, vmEthAmount);
  const actor = getAddress(actorAddress);
  const recipient = getAddress(recipientAddress);
  if (recipient === ZeroAddress) throw new Error("Bridge recipient cannot be the zero address.");
  const contract = vault(signer);
  await verifyBindings(contract);
  const envelope = await signedEnvelope(signer, actor, recipient, encodeBridgeBurnPayload(amount), vmEthAmount);
  return confirmed(contract.getFunction("redeem")(
    amount,
    vmEthAmount,
    recipient,
    envelope,
    SWAPVM.sqrtPriceLimitX96,
    { value: vmEthAmount }
  ), onSubmitted);
}
