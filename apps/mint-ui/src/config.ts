import activeRelease from "../../../deployments/active/base-sepolia.json";

const environment = (name: string): string => String(import.meta.env[name] ?? "").trim();
const pinned = (name: string, expected: string): string => {
  const configured = environment(name);
  if (configured && configured.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${name} does not match ${activeRelease.release.name}.`);
  }
  return expected;
};

export const BASE_SEPOLIA = Object.freeze({
  chainId: activeRelease.network.chainId,
  chainIdHex: "0x14a34",
  name: activeRelease.network.name,
  rpcUrl: "https://base-sepolia-rpc.publicnode.com",
  explorerUrl: activeRelease.network.explorerUrl,
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }
});

export const SWAPVM = Object.freeze({
  protocolVersion: pinned("VITE_SWAPVM_PROTOCOL_VERSION", activeRelease.release.protocolVersion),
  worldId: pinned("VITE_SWAPVM_WORLD_ID", activeRelease.core.worldId),
  kernel: pinned("VITE_SWAPVM_KERNEL_ADDRESS", activeRelease.core.kernel),
  router: pinned("VITE_SWAPVM_ROUTER_ADDRESS", activeRelease.core.router),
  hook: pinned("VITE_SWAPVM_HOOK_ADDRESS", activeRelease.core.hook),
  programId: pinned("VITE_SWAPVM_SRC20_ID", activeRelease.programs.defaultSrc20.programId),
  buyInputWei: BigInt(activeRelease.parameters.vmInputWei),
  sqrtPriceLimitX96: BigInt(activeRelease.parameters.sqrtPriceLimitX96),
  mintByteGasLimit: 400,
  transferByteGasLimit: 500,
  approvalByteGasLimit: 1_000,
  minNetTokenOut: BigInt(activeRelease.parameters.minNetTokenOut)
});

const configuredMarketAddress =
  pinned("VITE_SWAPVM_MARKET_ADDRESS", activeRelease.applications.referenceMarket);
const configuredEscrowId = pinned("VITE_SWAPVM_MARKET_ESCROW_ID", activeRelease.programs.marketEscrow.referenceProgramId);
const configuredEscrowCodeHash = pinned("VITE_SWAPVM_MARKET_ESCROW_CODE_HASH", activeRelease.programs.marketEscrow.codeHash);

export const SRC20_MARKET = Object.freeze({
  address: configuredMarketAddress,
  escrowId: configuredEscrowId,
  escrowCodeHash: configuredEscrowCodeHash,
  sellEscrowEnabled:
    SWAPVM.protocolVersion === "1.2"
    && Boolean(configuredEscrowId)
    && Boolean(configuredEscrowCodeHash),
  defaultVMInputWei: 1_000_000_000_000n,
  defaultExpirySeconds: 24 * 60 * 60,
  maxVisibleOrders: 100
});

const activeAuctionExample = (activeRelease.applications as unknown as {
  auctionExample?: { factory: string; escrowCodeHash: string; indexed: false };
}).auctionExample;
const configuredAuctionFactory = activeAuctionExample
  ? pinned("VITE_SWAPUTER_AUCTION_FACTORY", activeAuctionExample.factory)
  : environment("VITE_SWAPUTER_AUCTION_FACTORY");
const configuredAuctionEscrowCodeHash = activeAuctionExample
  ? pinned("VITE_SWAPUTER_AUCTION_ESCROW_CODE_HASH", activeAuctionExample.escrowCodeHash)
  : environment("VITE_SWAPUTER_AUCTION_ESCROW_CODE_HASH");

export const SRC20_AUCTION = Object.freeze({
  factoryAddress: configuredAuctionFactory,
  escrowCodeHash: configuredAuctionEscrowCodeHash,
  enabled:
    SWAPVM.protocolVersion === "1.2"
    && /^0x[0-9a-fA-F]{40}$/.test(configuredAuctionFactory)
    && /^0x[0-9a-fA-F]{64}$/.test(configuredAuctionEscrowCodeHash),
  defaultVMInputWei: 1_000_000_000_000n,
  defaultDurationSeconds: 24 * 60 * 60,
  maxVisibleAuctions: 100
});

const configuredSETHVaultAddress = pinned("VITE_SWAPVM_SETH_VAULT_ADDRESS", activeRelease.applications.sethVault);
const configuredSETHId = pinned("VITE_SWAPVM_SETH_ID", activeRelease.programs.seth.programId);
const configuredSETHCodeHash = pinned("VITE_SWAPVM_SETH_CODE_HASH", activeRelease.programs.seth.codeHash);

export const SETH_BRIDGE = Object.freeze({
  vaultAddress: configuredSETHVaultAddress,
  programId: configuredSETHId,
  codeHash: configuredSETHCodeHash,
  enabled:
    SWAPVM.protocolVersion === "1.2"
    && /^0x[0-9a-fA-F]{40}$/.test(configuredSETHVaultAddress)
    && /^0x[0-9a-fA-F]{64}$/.test(configuredSETHId)
    && /^0x[0-9a-fA-F]{64}$/.test(configuredSETHCodeHash),
  defaultVMInputWei: 1_000_000_000_000n,
  byteGasLimit: activeRelease.parameters.sethByteGasLimit
});

export const KERNEL_ABI = [
  "function eoaAccountId(address account) view returns (bytes32)",
  "function creatorNonce(bytes32 worldId, bytes32 creator) view returns (uint64)",
  "function contractAccountId(bytes32 worldId,bytes32 creator,uint64 creationNonce,bytes32 codeHash) pure returns (bytes32)",
  "function nonces(bytes32 worldId, bytes32 actor) view returns (uint64)",
  "function executionHeight(bytes32 worldId) view returns (uint64)",
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
  "function netNativeAfterFee(uint256 grossNativeAmount) view returns (uint256)"
] as const;

export const MARKET_ABI = [
  "function router() view returns (address)",
  "function kernel() view returns (address)",
  "function worldId() view returns (bytes32)",
  "function token() view returns (bytes32)",
  "function escrow() view returns (bytes32)",
  "function escrowCodeHash() view returns (bytes32)",
  "function escrowedTokenAmount() view returns (uint256)",
  "function activeSellAmount(address maker) view returns (uint256)",
  "function orderCount() view returns (uint256)",
  "function getOrder(uint256 orderId) view returns ((address maker,address taker,uint64 expiry,uint8 side,uint8 status,uint128 amount,uint128 unitPriceWei,uint128 priceWei,uint128 vmEthAmount))",
  "function createBuyOrder(uint128 amount,uint128 unitPriceWei,uint128 vmEthAmount,uint64 expiry) payable returns (uint256 orderId)",
  "function createSellOrder(uint128 amount,uint128 unitPriceWei,uint128 vmEthAmount,uint64 expiry,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) depositEnvelope,uint160 sqrtPriceLimitX96) payable returns (uint256 orderId)",
  "function fillBuyOrder(uint256 orderId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96)",
  "function settleSellOrder(uint256 orderId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96) payable",
  "function cancelOrder(uint256 orderId)",
  "function cancelSellOrder(uint256 orderId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) envelope,uint160 sqrtPriceLimitX96) payable",
] as const;

export const AUCTION_FACTORY_ABI = [
  "function router() view returns (address)",
  "function kernel() view returns (address)",
  "function worldId() view returns (bytes32)",
  "function escrowCodeHash() view returns (bytes32)",
  "function auctionHouseFor(bytes32 token) view returns (address)",
  "function predictAuctionHouse(bytes32 token,bytes32 tokenCodeHash,bytes32 escrow) view returns (address)",
  "function createAuctionHouse(bytes32 token,bytes32 tokenCodeHash,bytes32 escrow) returns (address auctionHouse)"
] as const;

export const AUCTION_HOUSE_ABI = [
  "function router() view returns (address)",
  "function kernel() view returns (address)",
  "function worldId() view returns (bytes32)",
  "function token() view returns (bytes32)",
  "function escrow() view returns (bytes32)",
  "function escrowCodeHash() view returns (bytes32)",
  "function auctionCount() view returns (uint256)",
  "function getAuction(uint256 auctionId) view returns ((address seller,address highestBidder,uint64 endTime,uint8 status,uint32 bidCount,uint128 amount,uint128 reservePriceWei,uint128 highestBidWei,uint128 vmEthAmount))",
  "function minimumNextBid(uint256 auctionId) view returns (uint256)",
  "function claimableEth(address account) view returns (uint256)",
  "function createAuction(uint128 amount,uint128 reservePriceWei,uint128 vmEthAmount,uint64 endTime,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) depositEnvelope,uint160 sqrtPriceLimitX96) payable returns (uint256 auctionId)",
  "function bid(uint256 auctionId) payable",
  "function settleAuction(uint256 auctionId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) releaseEnvelope,uint160 sqrtPriceLimitX96) payable",
  "function cancelAuction(uint256 auctionId,(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature) releaseEnvelope,uint160 sqrtPriceLimitX96) payable",
  "function withdrawEth()"
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
