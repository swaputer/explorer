import {
  AbiCoder,
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  ZeroHash,
  concat,
  decodeBytes32String,
  getAddress,
  hexlify,
  id,
  isAddress,
  keccak256,
  toBeHex,
  type ContractRunner,
  type ContractTransactionReceipt,
  type Signer
} from "ethers";
import { HOOK_ABI, KERNEL_ABI, NETWORK, SETH, SETH_VAULT_ABI, SWAPVM } from "./config";
import {
  UNIVERSAL_ROUTER_ABI,
  encodeDirectSVMUniversalRouterSwap,
  resolveVMExecutionBinding,
  type VMExecutionRoute,
  type VMEnvelope
} from "./universalRouter";
export type { VMExecutionRoute } from "./universalRouter";

const abi = AbiCoder.defaultAbiCoder();
export const readProvider = new JsonRpcProvider(NETWORK.rpcUrl, NETWORK.chainId, { staticNetwork: true });

export interface WalletConnection { readonly provider: BrowserProvider; readonly signer: Signer; readonly address: string }
export interface TokenSnapshot { readonly name: string; readonly symbol: string; readonly decimals: number; readonly mintAmount: bigint; readonly cap: bigint; readonly totalSupply: bigint }
export interface BridgeSnapshot { readonly balance: bigint; readonly totalSupply: bigint; readonly lockedEth: bigint; readonly backingSurplus: bigint; readonly solvent: boolean }
export interface ProtocolFeeConfig { readonly feeBps: number; readonly controller: string }

export function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    const nested = error as Error & { shortMessage?: string; reason?: string };
    return nested.shortMessage || nested.reason || nested.message;
  }
  return "The requested operation could not be completed.";
}

export function short(value: string, start = 6, end = 4): string {
  return value ? `${value.slice(0, start)}…${value.slice(-end)}` : "—";
}

export async function connectWallet(): Promise<WalletConnection> {
  if (!window.ethereum) throw new Error("No compatible browser wallet was detected.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(NETWORK.chainId)) {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: NETWORK.chainIdHex }]);
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.send("wallet_addEthereumChain", [{
        chainId: NETWORK.chainIdHex,
        chainName: NETWORK.chainName,
        nativeCurrency: NETWORK.nativeCurrency,
        rpcUrls: [NETWORK.rpcUrl],
        blockExplorerUrls: [NETWORK.explorerUrl]
      }]);
    }
  }
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

function requireProtocol(): void {
  if (!SWAPVM.enabled) throw new Error("Mainnet protocol addresses are not configured for this build.");
}

function requireDirectProtocol(): void {
  requireProtocol();
  if (!SWAPVM.directEnabled) {
    throw new Error("The official Uniswap Universal Router is not configured for this Swaputer release.");
  }
}

export function kernelContract(runner: ContractRunner = readProvider): Contract {
  requireProtocol();
  return new Contract(SWAPVM.kernel, KERNEL_ABI, runner);
}

export async function readProtocolFeeConfig(): Promise<ProtocolFeeConfig> {
  requireProtocol();
  const hook = new Contract(SWAPVM.hook, HOOK_ABI, readProvider);
  const [feeBps, controller] = await Promise.all([
    hook.getFunction("protocolFeeBps").staticCall() as Promise<bigint>,
    hook.getFunction("feeController").staticCall() as Promise<string>
  ]);
  return { feeBps: Number(feeBps), controller: getAddress(controller) };
}

export async function readAccountId(address: string): Promise<string> {
  return await kernelContract().getFunction("eoaAccountId").staticCall(getAddress(address)) as string;
}

async function vmRead(target: string, signature: string, inputTypes: readonly string[] = [], values: readonly unknown[] = [], limit = 3_000) {
  requireProtocol();
  if (!/^0x[0-9a-fA-F]{64}$/.test(target)) throw new Error("Enter a valid 32-byte Mini Contract address.");
  const encoded = inputTypes.length ? abi.encode([...inputTypes], [...values]) : "0x";
  const payload = `${id(signature).slice(0, 10)}${encoded.slice(2)}`;
  const [output, bytesUsed] = await kernelContract().getFunction("staticCall").staticCall(SWAPVM.worldId, target, payload, limit) as [string, bigint];
  return { output, bytesUsed };
}

async function readUint(target: string, signature: string, inputTypes: readonly string[] = [], values: readonly unknown[] = []): Promise<bigint> {
  const { output } = await vmRead(target, signature, inputTypes, values);
  return abi.decode(["uint256"], output)[0] as bigint;
}

async function readText(target: string, signature: string): Promise<string> {
  const { output } = await vmRead(target, signature);
  return decodeBytes32String(abi.decode(["bytes32"], output)[0] as string);
}

export async function readTokenSnapshot(target: string): Promise<TokenSnapshot> {
  const [name, symbol, decimals, mintAmount, cap, totalSupply] = await Promise.all([
    readText(target, "name()"),
    readText(target, "symbol()"),
    readUint(target, "decimals()"),
    readUint(target, "mintAmount()"),
    readUint(target, "cap()"),
    readUint(target, "totalSupply()")
  ]);
  return { name, symbol, decimals: Number(decimals), mintAmount, cap, totalSupply };
}

export function validateOpenMintSRC20Snapshot(snapshot: TokenSnapshot): void {
  if (!snapshot.name.trim() || !snapshot.symbol.trim()) throw new Error("This SRC20 does not expose valid token metadata.");
  if (snapshot.decimals !== 18) throw new Error("This SRC20 does not use the supported 18-decimal interface.");
  if (snapshot.cap <= 0n || snapshot.mintAmount <= 0n || snapshot.mintAmount > snapshot.cap) {
    throw new Error("This SRC20 does not expose valid public mint parameters.");
  }
  if (snapshot.totalSupply < 0n || snapshot.totalSupply > snapshot.cap) {
    throw new Error("This SRC20 reports an invalid supply state.");
  }
}

export async function verifyOpenMintSRC20(target: string): Promise<TokenSnapshot> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(target)) throw new Error("Enter a valid 32-byte contract address.");
  const codeHash = await kernelContract().getFunction("programCodeHash").staticCall(SWAPVM.worldId, target) as string;
  if (codeHash.toLowerCase() !== SWAPVM.openMintSRC20CodeHash.toLowerCase()) {
    throw new Error("This contract is not a Swaputer OpenMint SRC20.");
  }
  const snapshot = await readTokenSnapshot(target);
  validateOpenMintSRC20Snapshot(snapshot);
  return snapshot;
}

export const VM_ACTION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  VMAction: [
    { name: "op", type: "uint8" }, { name: "worldId", type: "bytes32" },
    { name: "actor", type: "address" }, { name: "targetOrCodeHash", type: "bytes32" },
    { name: "payloadHash", type: "bytes32" }, { name: "byteGasLimit", type: "uint32" },
    { name: "minNetTokenOut", type: "uint128" }, { name: "exactEthAmountIn", type: "uint128" },
    { name: "sqrtPriceLimitX96", type: "uint160" }, { name: "recipient", type: "address" },
    { name: "router", type: "address" }, { name: "authorizedExecutor", type: "address" },
    { name: "nonce", type: "uint64" }, { name: "deadline", type: "uint64" }
  ]
};

export interface CallOptions {
  readonly recipient?: string;
  readonly authorizedExecutor?: string;
  readonly exactEthAmountIn?: bigint;
  readonly byteGasLimit?: number;
  readonly executionRoute?: VMExecutionRoute;
}

async function signedEnvelope(
  signer: Signer,
  actorAddress: string,
  operation: 1 | 2,
  target: string,
  payload: string,
  options: CallOptions = {}
) {
  const executionRoute = options.executionRoute ?? "universal-router";
  if (executionRoute === "universal-router") requireDirectProtocol();
  else requireProtocol();
  const actor = getAddress(actorAddress);
  const actorId = await readAccountId(actor);
  const nonce = await kernelContract().getFunction("nonces").staticCall(SWAPVM.worldId, actorId) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const vmInput = options.exactEthAmountIn ?? SWAPVM.vmInputWei!;
  const binding = resolveVMExecutionBinding(
    executionRoute,
    actor,
    SWAPVM.universalRouter,
    SWAPVM.router,
    options.authorizedExecutor
  );
  const action = {
    op: operation,
    worldId: SWAPVM.worldId,
    actor,
    targetOrCodeHash: target,
    payloadHash: keccak256(payload),
    byteGasLimit: options.byteGasLimit ?? 20_000,
    minNetTokenOut: SWAPVM.minNetTokenOut,
    exactEthAmountIn: vmInput,
    sqrtPriceLimitX96: SWAPVM.sqrtPriceLimitX96!,
    recipient: options.recipient ?? actor,
    router: binding.router,
    authorizedExecutor: binding.authorizedExecutor,
    nonce,
    deadline
  };
  const signature = await signer.signTypedData({
    name: "Swaputer", version: SWAPVM.protocolVersion, chainId: NETWORK.chainId,
    verifyingContract: SWAPVM.kernel, salt: SWAPVM.worldId
  }, VM_ACTION_TYPES, action);
  return {
    envelope: {
      op: action.op, worldId: action.worldId, actor: action.actor, targetOrCodeHash: action.targetOrCodeHash,
      payload, byteGasLimit: action.byteGasLimit, minNetTokenOut: action.minNetTokenOut,
      nonce: action.nonce, deadline: action.deadline, recipient: action.recipient,
      authorizedExecutor: action.authorizedExecutor, signature
    },
    vmInput,
    deadline,
    executionRoute
  };
}

async function signedCallEnvelope(signer: Signer, actorAddress: string, target: string, payload: string, options: CallOptions = {}) {
  return signedEnvelope(signer, actorAddress, 2, target, payload, options);
}

export async function buildSignedCallEnvelope(signer: Signer, actorAddress: string, target: string, payload: string, options: CallOptions = {}) {
  return signedCallEnvelope(signer, actorAddress, target, payload, options);
}

async function executeDirectSVMEnvelope(
  signer: Signer,
  envelope: VMEnvelope,
  vmInput: bigint,
  deadline: bigint,
  onSubmitted?: (hash: string) => void
): Promise<ContractTransactionReceipt> {
  requireDirectProtocol();
  const swap = encodeDirectSVMUniversalRouterSwap(envelope, {
    gasToken: SWAPVM.gasToken,
    hook: SWAPVM.hook,
    fee: SWAPVM.poolFee,
    tickSpacing: SWAPVM.tickSpacing
  }, vmInput);
  const router = new Contract(SWAPVM.universalRouter, UNIVERSAL_ROUTER_ABI, signer);
  const transaction = await router.getFunction("execute")(
    swap.commands,
    swap.inputs,
    deadline,
    { value: swap.value }
  );
  return confirmed(transaction, onSubmitted);
}

export async function readMiniUint(target: string, signature: string, inputTypes: readonly string[] = [], values: readonly unknown[] = []): Promise<bigint> {
  return readUint(target, signature, inputTypes, values);
}

async function confirmed(transaction: { hash: string; wait(): Promise<ContractTransactionReceipt | null> }, onSubmitted?: (hash: string) => void) {
  onSubmitted?.(transaction.hash);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("The transaction was not confirmed successfully.");
  return receipt;
}

export async function writeMiniContract(
  signer: Signer,
  actor: string,
  target: string,
  signature: string,
  inputTypes: readonly string[],
  values: readonly unknown[],
  byteGasLimit = 20_000,
  onSubmitted?: (hash: string) => void
): Promise<ContractTransactionReceipt> {
  const encoded = inputTypes.length ? abi.encode([...inputTypes], [...values]) : "0x";
  const payload = `${id(signature).slice(0, 10)}${encoded.slice(2)}`;
  const { envelope, vmInput, deadline } = await signedCallEnvelope(signer, actor, target, payload, { byteGasLimit });
  return executeDirectSVMEnvelope(signer, envelope, vmInput, deadline, onSubmitted);
}

export async function readMiniContract(target: string, signature: string, inputTypes: readonly string[], outputTypes: readonly string[], values: readonly unknown[]) {
  const { output, bytesUsed } = await vmRead(target, signature, inputTypes, values, 20_000);
  const decoded = outputTypes.length ? abi.decode([...outputTypes], output) : [];
  return { values: Array.from(decoded).map((item) => typeof item === "bigint" ? item.toString() : String(item)), bytesUsed };
}

export async function mintSRC20(signer: Signer, actor: string, target: string, onSubmitted?: (hash: string) => void) {
  const accountId = await readAccountId(actor);
  return writeMiniContract(signer, actor, target, "mint(bytes32)", ["bytes32"], [accountId], 2_000, onSubmitted);
}

function vault(runner: ContractRunner = readProvider): Contract {
  if (!SETH.enabled || !isAddress(SETH.vaultAddress)) throw new Error("The mainnet sETH bridge is not configured for this build.");
  return new Contract(getAddress(SETH.vaultAddress), SETH_VAULT_ABI, runner);
}

async function verifyBridgeBindings(contract: Contract): Promise<void> {
  const [router, kernel, worldId, seth, codeHash] = await Promise.all([
    contract.getFunction("router").staticCall() as Promise<string>, contract.getFunction("kernel").staticCall() as Promise<string>,
    contract.getFunction("worldId").staticCall() as Promise<string>, contract.getFunction("seth").staticCall() as Promise<string>,
    contract.getFunction("sethCodeHash").staticCall() as Promise<string>
  ]);
  if (getAddress(router) !== getAddress(SWAPVM.router) || getAddress(kernel) !== getAddress(SWAPVM.kernel)
    || worldId.toLowerCase() !== SWAPVM.worldId.toLowerCase() || seth.toLowerCase() !== SETH.programId.toLowerCase()
    || codeHash.toLowerCase() !== SETH.codeHash.toLowerCase()) throw new Error("The configured sETH vault does not match this Swaputer release.");
}

export async function readBridgeSnapshot(address?: string | null): Promise<BridgeSnapshot> {
  const contract = vault();
  await verifyBridgeBindings(contract);
  const accountId = address ? await readAccountId(address) : null;
  const [balance, totalSupply, lockedEth, backingSurplus, solvent] = await Promise.all([
    accountId ? readUint(SETH.programId, "balanceOf(bytes32)", ["bytes32"], [accountId]) : 0n,
    readUint(SETH.programId, "totalSupply()"),
    contract.getFunction("lockedEth").staticCall() as Promise<bigint>,
    contract.getFunction("backingSurplus").staticCall() as Promise<bigint>,
    contract.getFunction("isSolvent").staticCall() as Promise<boolean>
  ]);
  return { balance, totalSupply, lockedEth, backingSurplus, solvent };
}

export async function bridgeETH(
  direction: "deposit" | "redeem", signer: Signer, actorAddress: string, recipientAddress: string,
  amount: bigint, vmInput: bigint, onSubmitted?: (hash: string) => void
): Promise<ContractTransactionReceipt> {
  if (amount <= 0n || vmInput <= 0n) throw new Error("Enter an amount greater than zero.");
  const actor = getAddress(actorAddress);
  const recipient = getAddress(recipientAddress);
  if (recipient === ZeroAddress) throw new Error("The recipient cannot be the zero address.");
  const contract = vault(signer);
  await verifyBridgeBindings(contract);
  const payload = direction === "deposit"
    ? `${id("bridgeMint(bytes32,uint256)").slice(0, 10)}${abi.encode(["bytes32", "uint256"], [await readAccountId(recipient), amount]).slice(2)}`
    : `${id("bridgeBurn(uint256)").slice(0, 10)}${abi.encode(["uint256"], [amount]).slice(2)}`;
  const { envelope } = await signedCallEnvelope(signer, actor, SETH.programId, payload, {
    recipient,
    authorizedExecutor: getAddress(SETH.vaultAddress),
    exactEthAmountIn: vmInput,
    byteGasLimit: SETH.byteGasLimit,
    executionRoute: "swaputer-router"
  });
  const tx = direction === "deposit"
    ? await contract.getFunction("deposit")(amount, vmInput, envelope, SWAPVM.sqrtPriceLimitX96!, { value: amount + vmInput })
    : await contract.getFunction("redeem")(amount, vmInput, recipient, envelope, SWAPVM.sqrtPriceLimitX96!, { value: vmInput });
  return confirmed(tx, onSubmitted);
}

const PACKAGE_HEADER_BYTES = 44;
export interface PackageInspection { readonly packageHex: string; readonly packageLength: number; readonly codeLength: number; readonly codeHash: string; readonly abiHash: string }
export interface DeploymentPreview { readonly actorId: string; readonly creatorNonce: bigint; readonly programId: string; readonly codeHash: string }

function readU16(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
export function inspectPackage(input: Uint8Array): PackageInspection {
  const bytes = new Uint8Array(input);
  if (bytes.length < PACKAGE_HEADER_BYTES || hexlify(bytes.slice(0, 4)) !== "0x53564d31") throw new Error("Select a valid SVM1 package.");
  const codeLength = readU16(bytes, 10);
  if (codeLength !== bytes.length - PACKAGE_HEADER_BYTES || codeLength < 1 || codeLength > 16_384) throw new Error("The SVM code length is invalid.");
  return { packageHex: hexlify(bytes), packageLength: bytes.length, codeLength, abiHash: hexlify(bytes.slice(12, 44)), codeHash: keccak256(bytes) };
}

export async function previewDeployment(actorAddress: string, packageBytes: Uint8Array): Promise<DeploymentPreview> {
  const inspected = inspectPackage(packageBytes);
  const actorId = await readAccountId(actorAddress);
  const creatorNonce = await kernelContract().getFunction("creatorNonce").staticCall(SWAPVM.worldId, actorId) as bigint;
  const programId = await kernelContract().getFunction("contractAccountId").staticCall(SWAPVM.worldId, actorId, creatorNonce, inspected.codeHash) as string;
  return { actorId, creatorNonce, programId, codeHash: inspected.codeHash };
}

export async function deployMiniContract(
  signer: Signer, actorAddress: string, packageBytes: Uint8Array, constructorArgs = "0x", byteGasLimit = 20_000,
  onSubmitted?: (hash: string) => void
): Promise<DeploymentPreview & { readonly receipt: ContractTransactionReceipt }> {
  requireProtocol();
  const preview = await previewDeployment(actorAddress, packageBytes);
  const compactArgs = constructorArgs.trim() || "0x";
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(compactArgs)) throw new Error("Constructor arguments must be complete hexadecimal bytes.");
  const inspected = inspectPackage(packageBytes);
  const payload = hexlify(concat([toBeHex(inspected.packageLength, 4), inspected.packageHex, compactArgs]));
  const actor = getAddress(actorAddress);
  const { envelope, vmInput, deadline } = await signedEnvelope(
    signer,
    actor,
    1,
    preview.codeHash,
    payload,
    { byteGasLimit }
  );
  const receipt = await executeDirectSVMEnvelope(signer, envelope, vmInput, deadline, onSubmitted);
  const installed = await kernelContract().getFunction("programCodeHash").staticCall(SWAPVM.worldId, preview.programId) as string;
  if (installed === ZeroHash || installed.toLowerCase() !== preview.codeHash.toLowerCase()) throw new Error("The deployed package could not be verified.");
  return { ...preview, receipt };
}
