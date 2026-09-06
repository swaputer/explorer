import { encodeBytes32String, parseUnits } from "ethers";
import openMintSource from "../../../../tooling/tinysol/programs/open-mint-src20/OpenMintSRC20.tiny.sol?raw";
import { SWAPVM } from "./config";
import { compileStudioSource, encodeConstructorArguments, type StudioBuild } from "./studio";

export const OPEN_MINT_SRC20_CODE_HASH = SWAPVM.openMintSRC20CodeHash;

export interface SRC20Parameters {
  readonly name: string;
  readonly symbol: string;
  readonly cap: string;
  readonly mintAmount: string;
}

export interface PreparedSRC20 {
  readonly build: StudioBuild;
  readonly constructorArgs: string;
  readonly cap: bigint;
  readonly mintAmount: bigint;
}

let buildPromise: Promise<StudioBuild> | null = null;

function packageBuild(): Promise<StudioBuild> {
  buildPromise ??= compileStudioSource(openMintSource, "OpenMintSRC20.tiny.sol");
  return buildPromise;
}

function cleanText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

export async function prepareSRC20(parameters: SRC20Parameters): Promise<PreparedSRC20> {
  const name = cleanText(parameters.name, "Name");
  const symbol = cleanText(parameters.symbol, "Symbol");
  const cap = parseUnits(cleanText(parameters.cap, "Supply"), 18);
  const mintAmount = parseUnits(cleanText(parameters.mintAmount, "Mint amount"), 18);
  if (cap <= 0n) throw new Error("Supply must be greater than zero.");
  if (mintAmount <= 0n) throw new Error("Mint amount must be greater than zero.");
  if (mintAmount > cap) throw new Error("Mint amount cannot exceed the total supply.");
  const encodedName = encodeBytes32String(name);
  const encodedSymbol = encodeBytes32String(symbol);
  const build = await packageBuild();
  if (build.codeHash.toLowerCase() !== OPEN_MINT_SRC20_CODE_HASH) throw new Error("SRC20 package identity check failed.");
  return {
    build,
    constructorArgs: encodeConstructorArguments(
      ["bytes32", "bytes32", "uint256", "uint256"],
      [encodedName, encodedSymbol, cap.toString(), mintAmount.toString()]
    ),
    cap,
    mintAmount
  };
}
