import {
  Contract,
  ZeroHash,
  concat,
  getAddress,
  getBytes,
  hexlify,
  keccak256,
  toBeHex,
  type ContractTransactionReceipt,
  type Signer
} from "ethers";
import { BASE_SEPOLIA, ROUTER_ABI, SWAPVM } from "../config";
import { VM_ACTION_TYPES, kernelContract } from "./swapvm";

const PACKAGE_HEADER_BYTES = 44;
const MAX_CODE_BYTES = 16_384;
const MAX_CONSTRUCTOR_BYTES = 65_536 - PACKAGE_HEADER_BYTES - MAX_CODE_BYTES - 4;
const MAX_UINT32 = 0xffff_ffff;
const MAX_UINT128 = (1n << 128n) - 1n;

export interface SvmPackageInspection {
  readonly packageHex: string;
  readonly packageLength: number;
  readonly codeLength: number;
  readonly constructorEntry: number;
  readonly runtimeEntry: number;
  readonly abiHash: string;
  readonly codeHash: string;
}

export interface DeploymentPreview {
  readonly actorId: string;
  readonly creatorNonce: bigint;
  readonly programId: string;
  readonly codeHash: string;
}

export interface DeploymentResult extends DeploymentPreview {
  readonly receipt: ContractTransactionReceipt;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

export function inspectSvmPackage(input: Uint8Array): SvmPackageInspection {
  const bytes = new Uint8Array(input);
  if (bytes.length < PACKAGE_HEADER_BYTES) throw new Error("SVM package is shorter than the 44-byte v1 header.");
  if (hexlify(bytes.slice(0, 4)) !== "0x53564d31") throw new Error("Invalid SVM package magic. Expected SVM1.");
  const version = readU16(bytes, 4);
  if (version !== 1) throw new Error(`Unsupported SVM package version ${version}.`);
  const constructorEntry = readU16(bytes, 6);
  const runtimeEntry = readU16(bytes, 8);
  const codeLength = readU16(bytes, 10);
  const actualCodeLength = bytes.length - PACKAGE_HEADER_BYTES;
  if (codeLength !== actualCodeLength) {
    throw new Error(`SVM package length mismatch: header declares ${codeLength} code bytes, file contains ${actualCodeLength}.`);
  }
  if (codeLength === 0 || codeLength > MAX_CODE_BYTES) throw new Error("SVM code must contain 1 to 16,384 bytes.");
  if (constructorEntry >= codeLength || runtimeEntry >= codeLength) {
    throw new Error("SVM constructor or runtime entrypoint is outside the code section.");
  }
  return Object.freeze({
    packageHex: hexlify(bytes),
    packageLength: bytes.length,
    codeLength,
    constructorEntry,
    runtimeEntry,
    abiHash: hexlify(bytes.slice(12, 44)),
    codeHash: keccak256(bytes)
  });
}

export function normalizeConstructorArgs(value: string): string {
  const compact = value.trim().replace(/\s+/g, "");
  if (compact === "" || compact === "0x") return "0x";
  const body = compact.startsWith("0x") ? compact.slice(2) : compact;
  if (!/^[0-9a-fA-F]+$/.test(body)) throw new Error("Constructor arguments must be hexadecimal bytes.");
  if (body.length % 2 !== 0) throw new Error("Constructor argument hex must contain complete bytes.");
  if (body.length / 2 > MAX_CONSTRUCTOR_BYTES) throw new Error("Constructor arguments exceed the MiniVM memory limit.");
  return `0x${body.toLowerCase()}`;
}

export function buildDeployPayload(packageBytes: Uint8Array, constructorArgs = "0x"): string {
  const inspection = inspectSvmPackage(packageBytes);
  const argumentsHex = normalizeConstructorArgs(constructorArgs);
  return hexlify(concat([toBeHex(inspection.packageLength, 4), inspection.packageHex, argumentsHex]));
}

export function buildDeployAction(
  address: string,
  codeHash: string,
  payload: string,
  nonce: bigint,
  deadline: bigint,
  byteGasLimit: number,
  vmInputWei: bigint
) {
  if (!Number.isInteger(byteGasLimit) || byteGasLimit <= 0 || byteGasLimit > MAX_UINT32) {
    throw new Error("Byte gas limit must be an integer from 1 to 4,294,967,295.");
  }
  if (vmInputWei <= 0n || vmInputWei > MAX_UINT128) throw new Error("VM input must fit uint128 and be greater than zero.");
  const actor = getAddress(address);
  return {
    op: 1,
    worldId: SWAPVM.worldId,
    actor,
    targetOrCodeHash: codeHash,
    payloadHash: keccak256(payload),
    byteGasLimit,
    minNetTokenOut: SWAPVM.minNetTokenOut,
    exactEthAmountIn: vmInputWei,
    sqrtPriceLimitX96: SWAPVM.sqrtPriceLimitX96,
    recipient: actor,
    router: SWAPVM.router,
    authorizedExecutor: actor,
    nonce,
    deadline
  };
}

export async function previewMiniContractDeployment(
  address: string,
  packageBytes: Uint8Array
): Promise<DeploymentPreview> {
  const inspection = inspectSvmPackage(packageBytes);
  const kernel = kernelContract();
  const actorId = (await kernel.getFunction("eoaAccountId").staticCall(getAddress(address))) as string;
  const creatorNonce = (await kernel.getFunction("creatorNonce").staticCall(SWAPVM.worldId, actorId)) as bigint;
  const programId = (await kernel.getFunction("contractAccountId").staticCall(
    SWAPVM.worldId,
    actorId,
    creatorNonce,
    inspection.codeHash
  )) as string;
  return { actorId, creatorNonce, programId, codeHash: inspection.codeHash };
}

export async function deployMiniContract(
  signer: Signer,
  address: string,
  packageBytes: Uint8Array,
  constructorArgs: string,
  byteGasLimit: number,
  vmInputWei: bigint,
  onSubmitted?: (transactionHash: string) => void
): Promise<DeploymentResult> {
  const preview = await previewMiniContractDeployment(address, packageBytes);
  const payload = buildDeployPayload(packageBytes, constructorArgs);
  const kernel = kernelContract();
  const nonce = (await kernel.getFunction("nonces").staticCall(SWAPVM.worldId, preview.actorId)) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const action = buildDeployAction(address, preview.codeHash, payload, nonce, deadline, byteGasLimit, vmInputWei);
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
    { value: vmInputWei }
  );
  onSubmitted?.(transaction.hash as string);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Mini contract deployment was not confirmed successfully.");
  const deployedHash = (await kernel.getFunction("programCodeHash").staticCall(
    SWAPVM.worldId,
    preview.programId
  )) as string;
  if (deployedHash === ZeroHash || deployedHash.toLowerCase() !== preview.codeHash.toLowerCase()) {
    throw new Error("The confirmed transaction did not install the expected package at the predicted AccountId.");
  }
  return { ...preview, receipt };
}
