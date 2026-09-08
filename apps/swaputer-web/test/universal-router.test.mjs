import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as ethers from "ethers";
import * as universalRouterLib from "../src/lib/universalRouter.ts";

const { AbiCoder, Interface, ZeroAddress, getAddress } = ethers;
const {
  DIRECT_SVM_ACTIONS,
  UNIVERSAL_ROUTER_ABI,
  V4_SWAP_COMMAND,
  encodeDirectSVMUniversalRouterSwap,
  resolveVMExecutionBinding
} = universalRouterLib;

const abi = AbiCoder.defaultAbiCoder();
const actor = getAddress(`0x${"11".repeat(20)}`);
const universalRouter = getAddress(`0x${"22".repeat(20)}`);
const swaputerRouter = getAddress(`0x${"33".repeat(20)}`);
const executor = getAddress(`0x${"44".repeat(20)}`);
const gasToken = getAddress(`0x${"55".repeat(20)}`);
const hook = getAddress(`0x${"66".repeat(20)}`);
const worldId = `0x${"77".repeat(32)}`;
const target = `0x${"88".repeat(32)}`;
const actorId = `0x${"11".repeat(32)}`;
const programId = `0x${"aa".repeat(32)}`;

const envelope = {
  op: 2,
  worldId,
  actor,
  targetOrCodeHash: target,
  payload: "0x12345678",
  byteGasLimit: 2_000,
  minNetTokenOut: 1n,
  nonce: 7n,
  deadline: 2_000_000_000n,
  recipient: actor,
  authorizedExecutor: ZeroAddress,
  signature: `0x${"99".repeat(65)}`
};

const envelopeType =
  "tuple(uint8 op,bytes32 worldId,address actor,bytes32 targetOrCodeHash,bytes payload,uint32 byteGasLimit,uint128 minNetTokenOut,uint64 nonce,uint64 deadline,address recipient,address authorizedExecutor,bytes signature)";
const exactInputType =
  "tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)";

function protocolHarness() {
  const source = readFileSync(new URL("../src/lib/protocol.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const capture = { action: null, execute: null };
  const config = {
    NETWORK: { rpcUrl: "http://127.0.0.1:8545", chainId: 84_532 },
    SWAPVM: {
      enabled: true,
      directEnabled: true,
      protocolVersion: "1.2",
      worldId,
      kernel: getAddress(`0x${"ab".repeat(20)}`),
      router: swaputerRouter,
      universalRouter,
      hook,
      gasToken,
      poolFee: 3_000,
      tickSpacing: 60,
      vmInputWei: 1_000_000_000_000n,
      sqrtPriceLimitX96: 4_295_128_740n,
      minNetTokenOut: 1n
    },
    SETH: {},
    HOOK_ABI: [],
    KERNEL_ABI: [],
    SETH_VAULT_ABI: []
  };

  class FakeJsonRpcProvider {}
  class FakeContract {
    constructor(address) { this.address = getAddress(address); }
    getFunction(name) {
      const invoke = async (...args) => {
        if (name !== "execute") throw new Error(`Unexpected transaction function: ${name}`);
        capture.execute = { address: this.address, args };
        return { hash: `0x${"12".repeat(32)}`, wait: async () => ({ status: 1 }) };
      };
      invoke.staticCall = async (...args) => {
        if (name === "eoaAccountId") return actorId;
        if (name === "nonces") return 7n;
        if (name === "creatorNonce") return 3n;
        if (name === "contractAccountId") return programId;
        if (name === "programCodeHash") return capture.action?.targetOrCodeHash ?? target;
        throw new Error(`Unexpected static function: ${name}(${args.length})`);
      };
      return invoke;
    }
  }

  const context = {
    exports: {},
    require(name) {
      if (name === "ethers") return {
        ...ethers,
        Contract: FakeContract,
        JsonRpcProvider: FakeJsonRpcProvider,
        hexlify: value => ethers.hexlify(typeof value === "string" ? value : Uint8Array.from(value)),
        keccak256: value => ethers.keccak256(typeof value === "string" ? value : Uint8Array.from(value))
      };
      if (name === "./config") return config;
      if (name === "./universalRouter") return universalRouterLib;
      throw new Error(`Unexpected module: ${name}`);
    }
  };
  vm.runInNewContext(compiled, context);
  const signer = {
    signTypedData: async (_domain, _types, action) => {
      capture.action = action;
      return `0x${"99".repeat(65)}`;
    }
  };
  return { api: context.exports, capture, config, signer };
}

test("direct SVM actions bind signatures to the official router and no executor", () => {
  assert.deepEqual(
    resolveVMExecutionBinding("universal-router", actor, universalRouter, swaputerRouter),
    { router: universalRouter, authorizedExecutor: ZeroAddress }
  );
  assert.throws(
    () => resolveVMExecutionBinding("universal-router", actor, universalRouter, swaputerRouter, executor),
    /cannot bind a custom executor/
  );
});

test("executor-bound applications remain bound to the Swaputer router", () => {
  assert.deepEqual(
    resolveVMExecutionBinding("swaputer-router", actor, universalRouter, swaputerRouter, executor),
    { router: swaputerRouter, authorizedExecutor: executor }
  );
});

test("encodes the official V4_SWAP exact-input action with hookData", () => {
  const amountIn = 1_000_000_000_000n;
  const encoded = encodeDirectSVMUniversalRouterSwap(envelope, {
    gasToken,
    hook,
    fee: 3_000,
    tickSpacing: 60
  }, amountIn);

  assert.equal(encoded.commands, V4_SWAP_COMMAND);
  assert.equal(encoded.commands, "0x10");
  assert.equal(encoded.value, amountIn);
  assert.equal(encoded.inputs.length, 1);

  const [actions, params] = abi.decode(["bytes", "bytes[]"], encoded.inputs[0]);
  assert.equal(actions, DIRECT_SVM_ACTIONS);
  assert.equal(actions, "0x060c0f");
  assert.equal(params.length, 3);

  const [swap] = abi.decode([exactInputType], params[0]);
  assert.equal(swap.poolKey.currency0, ZeroAddress);
  assert.equal(swap.poolKey.currency1, gasToken);
  assert.equal(swap.poolKey.fee, 3_000n);
  assert.equal(swap.poolKey.tickSpacing, 60n);
  assert.equal(swap.poolKey.hooks, hook);
  assert.equal(swap.zeroForOne, true);
  assert.equal(swap.amountIn, amountIn);
  assert.equal(swap.amountOutMinimum, 1n);
  assert.equal(swap.minHopPriceX36, 0n);

  const [decodedEnvelope] = abi.decode([envelopeType], swap.hookData);
  assert.equal(decodedEnvelope.worldId, worldId);
  assert.equal(decodedEnvelope.targetOrCodeHash, target);
  assert.equal(decodedEnvelope.authorizedExecutor, ZeroAddress);

  const [settleCurrency, settleMaximum] = abi.decode(["address", "uint256"], params[1]);
  assert.equal(settleCurrency, ZeroAddress);
  assert.equal(settleMaximum, amountIn);
  const [takeCurrency, takeMinimum] = abi.decode(["address", "uint256"], params[2]);
  assert.equal(takeCurrency, gasToken);
  assert.equal(takeMinimum, 1n);

  const iface = new Interface(UNIVERSAL_ROUTER_ABI);
  assert.equal(iface.getFunction("execute").selector, "0x3593564c");
  const calldata = iface.encodeFunctionData("execute", [encoded.commands, encoded.inputs, envelope.deadline]);
  const transaction = iface.parseTransaction({ data: calldata, value: encoded.value });
  assert.equal(transaction.name, "execute");
  assert.equal(transaction.args[0], "0x10");
  assert.equal(transaction.args[2], envelope.deadline);
});

test("direct CALL signs for and executes through the official Universal Router", async () => {
  const { api, capture, config, signer } = protocolHarness();
  await api.writeMiniContract(
    signer,
    actor,
    target,
    "mint(bytes32)",
    ["bytes32"],
    [actorId],
    2_000
  );

  assert.equal(capture.action.op, 2);
  assert.equal(capture.action.router, config.SWAPVM.universalRouter);
  assert.equal(capture.action.authorizedExecutor, ZeroAddress);
  assert.equal(capture.execute.address, config.SWAPVM.universalRouter);
  assert.equal(capture.execute.args[0], "0x10");
  assert.equal(capture.execute.args[1].length, 1);
  assert.equal(capture.execute.args[2], capture.action.deadline);
  assert.equal(capture.execute.args[3].value, config.SWAPVM.vmInputWei);
});

test("direct DEPLOY uses the same official route with a zero executor", async () => {
  const { api, capture, config, signer } = protocolHarness();
  const packageBytes = new Uint8Array(45);
  packageBytes.set([0x53, 0x56, 0x4d, 0x31]);
  packageBytes[11] = 1;
  packageBytes[44] = 1;

  const deployed = await api.deployMiniContract(signer, actor, packageBytes, "0x", 20_000);
  assert.equal(deployed.programId, programId);
  assert.equal(capture.action.op, 1);
  assert.equal(capture.action.router, config.SWAPVM.universalRouter);
  assert.equal(capture.action.authorizedExecutor, ZeroAddress);
  assert.equal(capture.execute.address, config.SWAPVM.universalRouter);
  assert.equal(capture.execute.args[0], "0x10");
});

test("executor-bound envelopes are still signed for the custom Swaputer Router", async () => {
  const { api, capture, config, signer } = protocolHarness();
  const built = await api.buildSignedCallEnvelope(signer, actor, target, "0x12345678", {
    authorizedExecutor: executor,
    executionRoute: "swaputer-router"
  });
  assert.equal(capture.action.router, config.SWAPVM.router);
  assert.equal(capture.action.authorizedExecutor, executor);
  assert.equal(built.envelope.authorizedExecutor, executor);
  assert.equal(capture.execute, null);
});

test("shared protocol helpers retain the executor-bound route", () => {
  const protocolSource = readFileSync(new URL("../src/lib/protocol.ts", import.meta.url), "utf8");
  assert.match(protocolSource, /executionRoute: "swaputer-router"/);
  assert.doesNotMatch(protocolSource, /getFunction\("buyVMExactInput"\)/);
  assert.match(protocolSource, /new Contract\(SWAPVM\.universalRouter, UNIVERSAL_ROUTER_ABI, signer\)/);
});

test("web config derives the direct pool key from the active release", () => {
  const source = readFileSync(new URL("../src/lib/config.ts", import.meta.url), "utf8");
  assert.match(source, /candidateRelease\.upstream\?\.uniswapV4/);
  assert.match(source, /uniswapV4\.universalRouter/);
  assert.match(source, /poolFee: uniswapV4\?\.poolFee/);
  assert.match(source, /tickSpacing: uniswapV4\?\.tickSpacing/);
  assert.match(source, /gasToken/);
});
