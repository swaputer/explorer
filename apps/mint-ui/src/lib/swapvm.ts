import {
  AbiCoder,
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  decodeBytes32String,
  getAddress,
  id,
  keccak256,
  type ContractTransactionReceipt,
  type ContractRunner,
  type Signer
} from "ethers";
import { BASE_SEPOLIA, KERNEL_ABI, ROUTER_ABI, SWAPVM } from "../config";

export interface TokenSnapshot {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly mintAmount: bigint;
  readonly cap: bigint;
  readonly totalSupply: bigint;
  readonly executionHeight: bigint;
}

export const readProvider = new JsonRpcProvider(BASE_SEPOLIA.rpcUrl, BASE_SEPOLIA.chainId, {
  staticNetwork: true
});
const abiCoder = AbiCoder.defaultAbiCoder();

export function kernelContract(runner: ContractRunner = readProvider): Contract {
  return new Contract(SWAPVM.kernel, KERNEL_ABI, runner);
}

async function vmRead(selector: string, argumentsHex = "0x"): Promise<{ output: string; bytesUsed: bigint }> {
  const input = `${selector}${argumentsHex.slice(2)}`;
  const fn = kernelContract().getFunction("staticCall");
  const [output, bytesUsed] = (await fn.staticCall(
    SWAPVM.worldId,
    SWAPVM.programId,
    input,
    2_000
  )) as [string, bigint];
  return { output, bytesUsed };
}

async function readUint(signature: string, encodedArgs = "0x"): Promise<bigint> {
  const { output } = await vmRead(id(signature).slice(0, 10), encodedArgs);
  return abiCoder.decode(["uint256"], output)[0] as bigint;
}

async function readBytes32(signature: string): Promise<string> {
  const { output } = await vmRead(id(signature).slice(0, 10));
  const value = abiCoder.decode(["bytes32"], output)[0] as string;
  return decodeBytes32String(value);
}

export async function readTokenSnapshot(): Promise<TokenSnapshot> {
  const [name, symbol, decimals, mintAmount, cap, totalSupply, executionHeight] = await Promise.all([
    readBytes32("name()"),
    readBytes32("symbol()"),
    readUint("decimals()"),
    readUint("mintAmount()"),
    readUint("cap()"),
    readUint("totalSupply()"),
    kernelContract().getFunction("executionHeight").staticCall(SWAPVM.worldId) as Promise<bigint>
  ]);
  return { name, symbol, decimals: Number(decimals), mintAmount, cap, totalSupply, executionHeight };
}

export async function readAccountId(address: string): Promise<string> {
  return (await kernelContract().getFunction("eoaAccountId").staticCall(address)) as string;
}

export async function readBalance(address: string): Promise<bigint> {
  const accountId = await readAccountId(getAddress(address));
  return readUint("balanceOf(bytes32)", abiCoder.encode(["bytes32"], [accountId]));
}

export async function connectWallet(): Promise<{ provider: BrowserProvider; signer: Signer; address: string }> {
  if (!window.ethereum) throw new Error("No browser wallet detected. Install a wallet that supports Base Sepolia.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(BASE_SEPOLIA.chainId)) {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: BASE_SEPOLIA.chainIdHex }]);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw error;
      await provider.send("wallet_addEthereumChain", [
        {
          chainId: BASE_SEPOLIA.chainIdHex,
          chainName: BASE_SEPOLIA.name,
          nativeCurrency: BASE_SEPOLIA.nativeCurrency,
          rpcUrls: [BASE_SEPOLIA.rpcUrl],
          blockExplorerUrls: [BASE_SEPOLIA.explorerUrl]
        }
      ]);
    }
  }
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export const VM_ACTION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  VMAction: [
    { name: "op", type: "uint8" },
    { name: "worldId", type: "bytes32" },
    { name: "actor", type: "address" },
    { name: "targetOrCodeHash", type: "bytes32" },
    { name: "payloadHash", type: "bytes32" },
    { name: "byteGasLimit", type: "uint32" },
    { name: "minNetTokenOut", type: "uint128" },
    { name: "exactEthAmountIn", type: "uint128" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
    { name: "recipient", type: "address" },
    { name: "router", type: "address" },
    { name: "authorizedExecutor", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "deadline", type: "uint64" }
  ]
};

export function buildMintPayload(actorId: string): string {
  return `${id("mint(bytes32)").slice(0, 10)}${abiCoder.encode(["bytes32"], [actorId]).slice(2)}`;
}

export function buildMintAction(address: string, actorId: string, nonce: bigint, deadline: bigint) {
  const payload = buildMintPayload(actorId);
  return buildCallAction(address, payload, nonce, deadline, SWAPVM.mintByteGasLimit);
}

export function buildTransferPayload(recipientId: string, amount: bigint): string {
  return `${id("transfer(bytes32,uint256)").slice(0, 10)}${abiCoder.encode(["bytes32", "uint256"], [recipientId, amount]).slice(2)}`;
}

export function buildTransferAction(
  address: string,
  recipientId: string,
  amount: bigint,
  nonce: bigint,
  deadline: bigint
) {
  const payload = buildTransferPayload(recipientId, amount);
  return buildCallAction(address, payload, nonce, deadline, SWAPVM.transferByteGasLimit);
}

export interface CallActionOptions {
  readonly recipient?: string;
  readonly authorizedExecutor?: string;
  readonly exactEthAmountIn?: bigint;
  readonly byteGasLimit?: number;
  readonly targetOrCodeHash?: string;
}

export function buildCallAction(
  address: string,
  payload: string,
  nonce: bigint,
  deadline: bigint,
  byteGasLimit: number,
  options: CallActionOptions = {}
) {
  return {
    payload,
    typedAction: {
      op: 2,
      worldId: SWAPVM.worldId,
      actor: address,
      targetOrCodeHash: options.targetOrCodeHash ?? SWAPVM.programId,
      payloadHash: keccak256(payload),
      byteGasLimit: options.byteGasLimit ?? byteGasLimit,
      minNetTokenOut: SWAPVM.minNetTokenOut,
      exactEthAmountIn: options.exactEthAmountIn ?? SWAPVM.buyInputWei,
      sqrtPriceLimitX96: SWAPVM.sqrtPriceLimitX96,
      recipient: options.recipient ?? address,
      router: SWAPVM.router,
      authorizedExecutor: options.authorizedExecutor ?? address,
      nonce,
      deadline
    }
  };
}

async function submitCall(
  signer: Signer,
  address: string,
  payload: string,
  byteGasLimit: number,
  onSubmitted?: (transactionHash: string) => void
): Promise<ContractTransactionReceipt> {
  const actorId = await readAccountId(address);
  const nonce = (await kernelContract().getFunction("nonces").staticCall(SWAPVM.worldId, actorId)) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const { typedAction: action } = buildCallAction(address, payload, nonce, deadline, byteGasLimit);
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
  const transaction = await router.getFunction("buyVMExactInput")(
    SWAPVM.worldId,
    SWAPVM.sqrtPriceLimitX96,
    envelope,
    {
      value: SWAPVM.buyInputWei
    }
  );
  onSubmitted?.(transaction.hash as string);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("VM transaction was not confirmed successfully.");
  return receipt;
}

export async function mintTokens(
  signer: Signer,
  address: string,
  onSubmitted?: (transactionHash: string) => void
): Promise<ContractTransactionReceipt> {
  const actorId = await readAccountId(address);
  return submitCall(signer, address, buildMintPayload(actorId), SWAPVM.mintByteGasLimit, onSubmitted);
}

export async function transferTokens(
  signer: Signer,
  address: string,
  recipientAddress: string,
  amount: bigint,
  onSubmitted?: (transactionHash: string) => void
): Promise<ContractTransactionReceipt> {
  let recipient: string;
  try {
    recipient = getAddress(recipientAddress.trim());
  } catch {
    throw new Error("Recipient address is invalid.");
  }
  if (recipient === ZeroAddress) throw new Error("Recipient cannot be the zero address.");
  if (amount <= 0n) throw new Error("Transfer amount must be greater than zero.");
  const recipientId = await readAccountId(recipient);
  return submitCall(
    signer,
    address,
    buildTransferPayload(recipientId, amount),
    SWAPVM.transferByteGasLimit,
    onSubmitted
  );
}

export function friendlyError(error: unknown): string {
  const candidate = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
    info?: { error?: { message?: string } };
  };
  const message = candidate.shortMessage ?? candidate.reason ?? candidate.info?.error?.message ?? candidate.message;
  if (!message) return "The request failed. Please retry.";
  if (message.includes("user rejected") || message.includes("ACTION_REJECTED")) return "Wallet request cancelled.";
  if (message.includes("invalid address") || message.includes("Recipient address is invalid"))
    return "Invalid recipient or market address. Please use a valid 0x... address and check wallet connection.";
  if (message.includes("Not enough available SRC20 for this sell order"))
    return "Not enough available SRC20 for this sell order.";
  if (message.includes("insufficient funds")) return "Not enough Base Sepolia ETH for the mint transaction.";
  return message.replace(/^execution reverted:?\s*/i, "Transaction reverted: ");
}
