import { AbiCoder, ZeroAddress, getAddress } from "ethers";

const abi = AbiCoder.defaultAbiCoder();

export const V4_SWAP_COMMAND = "0x10";
export const DIRECT_SVM_ACTIONS = "0x060c0f";
export type VMExecutionRoute = "universal-router" | "swaputer-router";

export const UNIVERSAL_ROUTER_ABI = [
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"
] as const;

const VM_ENVELOPE_TYPE =
  "tuple(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature)";
const EXACT_INPUT_SINGLE_TYPE =
  "tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)";

export interface VMEnvelope {
  readonly op: number;
  readonly worldId: string;
  readonly actor: string;
  readonly targetOrCodeHash: string;
  readonly payload: string;
  readonly byteGasLimit: number;
  readonly minNetTokenOut: bigint;
  readonly nonce: bigint;
  readonly deadline: bigint;
  readonly recipient: string;
  readonly authorizedExecutor: string;
  readonly signature: string;
}

export interface UniversalRouterPool {
  readonly gasToken: string;
  readonly hook: string;
  readonly fee: number;
  readonly tickSpacing: number;
}

export interface UniversalRouterSwap {
  readonly commands: typeof V4_SWAP_COMMAND;
  readonly inputs: readonly [string];
  readonly value: bigint;
}

export function resolveVMExecutionBinding(
  route: VMExecutionRoute,
  actor: string,
  universalRouter: string,
  swaputerRouter: string,
  authorizedExecutor?: string
): { readonly router: string; readonly authorizedExecutor: string } {
  if (route === "universal-router") {
    if (authorizedExecutor && getAddress(authorizedExecutor) !== ZeroAddress) {
      throw new Error("Direct Universal Router actions cannot bind a custom executor.");
    }
    return { router: getAddress(universalRouter), authorizedExecutor: ZeroAddress };
  }
  return {
    router: getAddress(swaputerRouter),
    authorizedExecutor: getAddress(authorizedExecutor ?? actor)
  };
}

/**
 * Encodes a direct ETH -> SVM Gas Token swap for Uniswap Universal Router v2.
 * The SVM envelope is passed through the pool's hookData unchanged.
 */
export function encodeDirectSVMUniversalRouterSwap(
  envelope: VMEnvelope,
  pool: UniversalRouterPool,
  amountIn: bigint
): UniversalRouterSwap {
  if (amountIn <= 0n) throw new Error("The SVM execution payment must be greater than zero.");
  if (envelope.authorizedExecutor.toLowerCase() !== ZeroAddress) {
    throw new Error("Direct Universal Router actions cannot bind a custom executor.");
  }
  if (!Number.isInteger(pool.fee) || pool.fee < 0 || pool.fee > 0xffffff) {
    throw new Error("The configured Uniswap pool fee is invalid.");
  }
  if (!Number.isInteger(pool.tickSpacing) || pool.tickSpacing < -0x800000 || pool.tickSpacing > 0x7fffff) {
    throw new Error("The configured Uniswap tick spacing is invalid.");
  }

  const gasToken = getAddress(pool.gasToken);
  const hook = getAddress(pool.hook);
  const hookData = abi.encode([VM_ENVELOPE_TYPE], [envelope]);
  const swap = abi.encode([EXACT_INPUT_SINGLE_TYPE], [{
    poolKey: {
      currency0: ZeroAddress,
      currency1: gasToken,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks: hook
    },
    zeroForOne: true,
    amountIn,
    amountOutMinimum: envelope.minNetTokenOut,
    minHopPriceX36: 0n,
    hookData
  }]);

  const settleAll = abi.encode(["address", "uint256"], [ZeroAddress, amountIn]);
  const takeAll = abi.encode(["address", "uint256"], [gasToken, envelope.minNetTokenOut]);
  const input = abi.encode(["bytes", "bytes[]"], [DIRECT_SVM_ACTIONS, [swap, settleAll, takeAll]]);

  return { commands: V4_SWAP_COMMAND, inputs: [input], value: amountIn };
}
