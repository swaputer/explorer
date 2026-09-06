import activeRelease from "../../../../deployments/active/base-sepolia.json";
import { resolveOfficialFeatureScope } from "./releaseScope";

interface UniswapV4Release {
  readonly universalRouter: string;
  readonly poolFee: number;
  readonly tickSpacing: number;
}

const candidateRelease = activeRelease as typeof activeRelease & {
  readonly upstream?: { readonly uniswapV4?: UniswapV4Release };
};

const value = (name: string): string => String(import.meta.env[name] ?? "").trim();
const pinned = (name: string, expected: string): string => {
  const configured = value(name);
  if (configured && configured.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${name} does not match ${activeRelease.release.name}.`);
  }
  return expected;
};
export const NETWORK = Object.freeze({
  chainId: Number(pinned("VITE_CHAIN_ID", String(activeRelease.network.chainId))),
  get chainIdHex() { return `0x${this.chainId.toString(16)}`; },
  chainName: pinned("VITE_CHAIN_NAME", activeRelease.network.name),
  displayName: pinned("VITE_CHAIN_NAME", activeRelease.network.name),
  rpcUrl: value("VITE_RPC_URL") || "https://base-sepolia-rpc.publicnode.com",
  explorerUrl: pinned("VITE_EXPLORER_URL", activeRelease.network.explorerUrl),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
});

export const OFFICIAL_FEATURES = resolveOfficialFeatureScope(activeRelease.release.environment);

const worldId = pinned("VITE_SWAPVM_WORLD_ID", activeRelease.core.worldId);
const kernel = pinned("VITE_SWAPVM_KERNEL_ADDRESS", activeRelease.core.kernel);
const router = pinned("VITE_SWAPVM_ROUTER_ADDRESS", activeRelease.core.router);
const hook = pinned("VITE_SWAPVM_HOOK_ADDRESS", activeRelease.core.hook);
const gasToken = pinned("VITE_SWAPVM_GAS_TOKEN_ADDRESS", activeRelease.core.gasToken);
const uniswapV4 = candidateRelease.upstream?.uniswapV4;
const universalRouter = uniswapV4
  ? pinned("VITE_UNISWAP_UNIVERSAL_ROUTER_ADDRESS", uniswapV4.universalRouter)
  : "";
const vmInputWei = BigInt(pinned("VITE_SWAPVM_VM_INPUT_WEI", activeRelease.parameters.vmInputWei));
const sqrtPriceLimitX96 = BigInt(pinned("VITE_SWAPVM_SQRT_PRICE_LIMIT_X96", activeRelease.parameters.sqrtPriceLimitX96));

export const SWAPVM = Object.freeze({
  protocolVersion: pinned("VITE_SWAPVM_PROTOCOL_VERSION", activeRelease.release.protocolVersion),
  worldId,
  kernel,
  router,
  hook,
  gasToken,
  universalRouter,
  poolFee: uniswapV4?.poolFee ?? 0,
  tickSpacing: uniswapV4?.tickSpacing ?? 0,
  defaultSRC20: pinned("VITE_SWAPVM_SRC20_ID", activeRelease.programs.defaultSrc20.programId),
  openMintSRC20CodeHash: pinned("VITE_SWAPVM_OPEN_MINT_SRC20_CODE_HASH", activeRelease.programs.openMintSrc20CodeHash),
  vmInputWei,
  sqrtPriceLimitX96,
  minNetTokenOut: BigInt(pinned("VITE_SWAPVM_MIN_NET_TOKEN_OUT", activeRelease.parameters.minNetTokenOut)),
  enabled:
    /^0x[0-9a-fA-F]{64}$/.test(worldId)
    && /^0x[0-9a-fA-F]{40}$/.test(kernel)
    && /^0x[0-9a-fA-F]{40}$/.test(router)
    && /^0x[0-9a-fA-F]{40}$/.test(hook)
    && /^0x[0-9a-fA-F]{40}$/.test(gasToken)
    && /^0x[0-9a-fA-F]{64}$/.test(activeRelease.programs.openMintSrc20CodeHash),
  directEnabled:
    /^0x[0-9a-fA-F]{40}$/.test(universalRouter)
    && Number.isInteger(uniswapV4?.poolFee)
    && Number.isInteger(uniswapV4?.tickSpacing)
});

const marketFactoryAddress = pinned("VITE_SWAPVM_MARKET_FACTORY_ADDRESS", activeRelease.applications.marketFactory);
const marketEscrowCodeHash = pinned("VITE_SWAPVM_MARKET_ESCROW_CODE_HASH", activeRelease.programs.marketEscrow.codeHash);
export const MARKET = Object.freeze({
  factoryAddress: marketFactoryAddress,
  escrowCodeHash: marketEscrowCodeHash,
  defaultVMInputWei: BigInt(pinned("VITE_SWAPVM_MARKET_VM_INPUT_WEI", activeRelease.parameters.vmInputWei)),
  defaultExpirySeconds: Number(pinned("VITE_SWAPVM_MARKET_EXPIRY_SECONDS", String(activeRelease.parameters.marketExpirySeconds))),
  enabled: SWAPVM.enabled && /^0x[0-9a-fA-F]{40}$/.test(marketFactoryAddress) && /^0x[0-9a-fA-F]{64}$/.test(marketEscrowCodeHash)
});

const vaultAddress = pinned("VITE_SWAPVM_SETH_VAULT_ADDRESS", activeRelease.applications.sethVault);
const sethId = pinned("VITE_SWAPVM_SETH_ID", activeRelease.programs.seth.programId);
const sethCodeHash = pinned("VITE_SWAPVM_SETH_CODE_HASH", activeRelease.programs.seth.codeHash);

export const SETH = Object.freeze({
  vaultAddress,
  programId: sethId,
  codeHash: sethCodeHash,
  byteGasLimit: Number(pinned("VITE_SWAPVM_SETH_BYTE_GAS_LIMIT", String(activeRelease.parameters.sethByteGasLimit))),
  vmInputWei: BigInt(pinned("VITE_SWAPVM_SETH_VM_INPUT_WEI", activeRelease.parameters.vmInputWei)),
  enabled:
    SWAPVM.enabled
    && /^0x[0-9a-fA-F]{40}$/.test(vaultAddress)
    && /^0x[0-9a-fA-F]{64}$/.test(sethId)
    && /^0x[0-9a-fA-F]{64}$/.test(sethCodeHash)
});

export const KERNEL_ABI = [
  "function eoaAccountId(address account) view returns (bytes32)",
  "function creatorNonce(bytes32 worldId, bytes32 creator) view returns (uint64)",
  "function contractAccountId(bytes32 worldId,bytes32 creator,uint64 creationNonce,bytes32 codeHash) pure returns (bytes32)",
  "function nonces(bytes32 worldId, bytes32 actor) view returns (uint64)",
  "function programCodeHash(bytes32 worldId,bytes32 target) view returns (bytes32)",
  "function staticCall(bytes32 worldId, bytes32 target, bytes input, uint32 byteLimit) view returns (bytes output, uint32 bytesUsed)"
] as const;

export const ROUTER_ABI = [
  "function buyVMExactInput(bytes32 worldId, uint160 sqrtPriceLimitX96, (uint8 op, bytes32 worldId, address actor, bytes32 targetOrCodeHash, bytes payload, uint32 byteGasLimit, uint128 minNetTokenOut, uint64 nonce, uint64 deadline, address recipient, address authorizedExecutor, bytes signature) envelope) payable returns (int256 delta)"
] as const;

export const HOOK_ABI = [
  "function protocolFeeBps() view returns (uint16)",
  "function feeController() view returns (address)",
  "function protocolFee(uint256 grossNativeAmount) view returns (uint256)",
  "function netNativeAfterFee(uint256 grossNativeAmount) view returns (uint256)",
  "function feeAdmin() view returns (address)",
  "function accruedProtocolFees() view returns (uint256)",
  "function boundPoolId() view returns (bytes32)",
  "function poolBound() view returns (bool)"
] as const;

export const MARKET_FACTORY_ABI = [
  "function marketFor(bytes32 token) view returns (address)",
  "function predictMarket(bytes32 token,bytes32 tokenCodeHash,bytes32 escrow) view returns (address)",
  "function createMarket(bytes32 token,bytes32 tokenCodeHash,bytes32 escrow) returns (address market)"
] as const;

export const MARKET_ABI = [
  "function token() view returns (bytes32)",
  "function escrow() view returns (bytes32)",
  "function orderCount() view returns (uint256)",
  "function getOrder(uint256 orderId) view returns ((address maker,address taker,uint64 expiry,uint8 side,uint8 status,uint128 amount,uint128 unitPriceWei,uint128 priceWei,uint128 vmEthAmount))",
  "function createBuyOrder(uint128 amount,uint128 unitPriceWei,uint128 vmEthAmount,uint64 expiry) payable returns (uint256 orderId)",
  "function createSellOrder(uint128 amount,uint128 unitPriceWei,uint128 vmEthAmount,uint64 expiry,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) depositEnvelope,uint160 sqrtPriceLimitX96) payable returns (uint256 orderId)",
  "function fillBuyOrder(uint256 orderId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96)",
  "function settleSellOrder(uint256 orderId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96) payable",
  "function cancelOrder(uint256 orderId)",
  "function cancelSellOrder(uint256 orderId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96) payable"
] as const;

export const SETH_VAULT_ABI = [
  "function router() view returns (address)",
  "function kernel() view returns (address)",
  "function worldId() view returns (bytes32)",
  "function seth() view returns (bytes32)",
  "function sethCodeHash() view returns (bytes32)",
  "function lockedEth() view returns (uint256)",
  "function backingSurplus() view returns (uint256)",
  "function isSolvent() view returns (bool)",
  "function deposit(uint128 amount,uint128 vmEthAmount,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96) payable",
  "function redeem(uint128 amount,uint128 vmEthAmount,address recipient,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96) payable"
] as const;
