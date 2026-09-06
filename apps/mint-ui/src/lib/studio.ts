export interface StudioTemplate {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly description: string;
  readonly source: string;
}

export interface StudioFunction {
  readonly name: string;
  readonly signature: string;
  readonly selector: string;
  readonly view: boolean;
}

export interface StudioBuild {
  readonly contractName: string;
  readonly fileName: string;
  readonly packageBytes: Uint8Array;
  readonly packageLength: number;
  readonly codeLength: number;
  readonly codeHash: string;
  readonly abiHash: string;
  readonly constructorSignature: string;
  readonly functions: readonly StudioFunction[];
  readonly abi: string;
  readonly events: string;
  readonly storage: string;
  readonly manifest: string;
  readonly assembly: string;
  readonly sourceMap: string;
}

const COUNTER = `contract Counter {
  event Changed(account indexed by, uint256 value);
  uint256 value;

  constructor(uint256 initial) {
    value = initial;
  }

  function increment(uint256 amount) returns (uint256) {
    value = value + amount;
    emit Changed(msg.sender, value);
    return value;
  }

  function decrement(uint256 amount) returns (uint256) {
    require(value >= amount);
    value = value - amount;
    emit Changed(msg.sender, value);
    return value;
  }

  function reset() returns (uint256) {
    value = 0;
    emit Changed(msg.sender, value);
    return value;
  }

  function get() view returns (uint256) {
    return value;
  }
}
`;

const MINI_TOKEN = `contract MiniToken {
  event Transfer(account indexed from, account indexed to, uint256 amount);
  uint256 totalSupply;
  mapping(account => uint256) balance;

  constructor(uint256 supply, account owner) {
    totalSupply = supply;
    balance[owner] = supply;
  }

  function transfer(account to, uint256 amount) returns (bool) {
    require(balance[msg.sender] >= amount);
    balance[msg.sender] = balance[msg.sender] - amount;
    balance[to] = balance[to] + amount;
    emit Transfer(msg.sender, to, amount);
    return true;
  }

  function balanceOf(account owner) view returns (uint256) {
    return balance[owner];
  }

  function supply() view returns (uint256) {
    return totalSupply;
  }
}
`;

const SETH_PATTERN = `contract BridgedAsset {
  event Transfer(account indexed from, account indexed to, uint256 amount);
  uint256 issued;
  mapping(account => uint256) balances;
  address trustedVault;
  account zeroAccount;
  address zeroAddress;

  constructor(address vault_) {
    require(vault_ != zeroAddress);
    trustedVault = vault_;
  }

  function move(account from, account to, uint256 amount) internal returns (bool) {
    require(to != zeroAccount);
    require(balances[from] >= amount);
    balances[from] = balances[from] - amount;
    balances[to] = balances[to] + amount;
    emit Transfer(from, to, amount);
    return true;
  }

  function bridgeMint(account to, uint256 amount) returns (bool) {
    require(tx.executor == trustedVault);
    balances[to] = balances[to] + amount;
    issued = issued + amount;
    emit Transfer(zeroAccount, to, amount);
    return true;
  }

  function transfer(account to, uint256 amount) returns (bool) {
    return move(msg.sender, to, amount);
  }

  function balanceOf(account owner) view returns (uint256) {
    return balances[owner];
  }
}
`;

export const STUDIO_TEMPLATES: readonly StudioTemplate[] = Object.freeze([
  { id: "counter", name: "Counter", fileName: "Counter.tiny.sol", description: "State and return values", source: COUNTER },
  { id: "mini-token", name: "Mini Token", fileName: "MiniToken.tiny.sol", description: "Balances and events", source: MINI_TOKEN },
  { id: "bridge", name: "sETH pattern", fileName: "BridgedAsset.tiny.sol", description: "Internal calls and executor binding", source: SETH_PATTERN }
]);

export const EMPTY_CONTRACT = `contract MyContract {
  constructor() {
  }

  function hello() view returns (uint256) {
    return 1;
  }
}
`;

export async function compileStudioSource(source: string, fileName: string): Promise<StudioBuild> {
  const compiler = await import("@swaputer/tinysol");
  const result = compiler.compileTinySol(source, { sourceName: fileName });
  return Object.freeze({
    contractName: result.abi.contract,
    fileName: `${result.abi.contract}.svm`,
    packageBytes: new Uint8Array(result.packageBytes),
    packageLength: result.packageBytes.length,
    codeLength: result.code.length,
    codeHash: result.codeHash,
    abiHash: result.abi.abiHash,
    constructorSignature: result.abi.constructor,
    functions: Object.freeze(result.abi.functions.map((fn) => Object.freeze({
      name: fn.name,
      signature: fn.signature,
      selector: fn.selector,
      view: fn.view
    }))),
    abi: compiler.encodeCompilerArtifact(result.abi),
    events: compiler.encodeCompilerArtifact(result.eventDescriptor),
    storage: compiler.encodeCompilerArtifact(result.storageLayout),
    manifest: compiler.encodeCompilerArtifact(result.manifest),
    assembly: result.assembly,
    sourceMap: compiler.encodeCompilerArtifact(result.sourceMap)
  });
}

export async function formatStudioError(error: unknown): Promise<string> {
  const compiler = await import("@swaputer/tinysol");
  return compiler.formatDiagnostics(error) || "COMPILATION_FAILED";
}

export function studioErrorLocation(error: unknown): { readonly line?: number; readonly column?: number } {
  if (typeof error !== "object" || error === null) return {};
  const value = error as { readonly line?: unknown; readonly column?: unknown };
  return {
    ...(typeof value.line === "number" ? { line: value.line } : {}),
    ...(typeof value.column === "number" ? { column: value.column } : {})
  };
}

export function downloadStudioArtifact(fileName: string, value: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
