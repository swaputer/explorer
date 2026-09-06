import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  LoaderCircle,
  ShieldAlert,
  UploadCloud
} from "lucide-react";
import { formatEther, parseEther } from "ethers";
import { BASE_SEPOLIA, SWAPVM } from "../config";
import type { DeployPhase, SelectedSvmPackage } from "../hooks/useMiniContractDeployer";
import type { DeploymentPreview, DeploymentResult } from "../lib/deployer";
import { normalizeConstructorArgs } from "../lib/deployer";

interface MiniContractDeployPageProps {
  readonly address: string | null;
  readonly selectedPackage: SelectedSvmPackage | null;
  readonly preview: DeploymentPreview | null;
  readonly result: DeploymentResult | null;
  readonly phase: DeployPhase;
  readonly error: string | null;
  readonly onConnect: () => void;
  readonly onSelectFile: (file: File | null) => void;
  readonly onDeploy: (constructorArgs: string, byteGasLimit: number, vmInputWei: bigint) => void;
}

function compactHash(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

function copy(value: string) {
  void navigator.clipboard?.writeText(value);
}

export function MiniContractDeployPage({
  address,
  selectedPackage,
  preview,
  result,
  phase,
  error,
  onConnect,
  onSelectFile,
  onDeploy
}: MiniContractDeployPageProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [constructorArgs, setConstructorArgs] = useState("0x");
  const [byteGasLimit, setByteGasLimit] = useState("20000");
  const [vmInput, setVMInput] = useState(formatEther(SWAPVM.buyInputWei));
  const busy = phase === "signing" || phase === "pending";

  const validation = useMemo(() => {
    try {
      normalizeConstructorArgs(constructorArgs);
      const limit = Number(byteGasLimit);
      const value = parseEther(vmInput || "0");
      return { valid: Number.isInteger(limit) && limit > 0 && limit <= 4_294_967_295 && value > 0n, limit, value };
    } catch {
      return { valid: false, limit: 0, value: 0n };
    }
  }, [byteGasLimit, constructorArgs, vmInput]);

  const submit = () => {
    if (!address) return onConnect();
    const args = normalizeConstructorArgs(constructorArgs);
    const limit = Number(byteGasLimit);
    const value = parseEther(vmInput || "0");
    if (!selectedPackage || !preview || busy || !validation.valid) return;
    onDeploy(args, limit, value);
  };

  return (
    <main className="market-main deploy-main">
      <section className="market-hero deploy-hero">
        <div>
          <span className="eyebrow">TinySol bytecode · authenticated deployment</span>
          <h1>Deploy a Mini Contract</h1>
          <p>Inspect a compiled SVM package locally, bind it to your current creator nonce, sign the exact v1.2 deployment action and install it in the sealed Base Sepolia World.</p>
        </div>
        <div className="deploy-world-card">
          <span>Target World</span>
          <strong>{compactHash(SWAPVM.worldId)}</strong>
          <small>Protocol {SWAPVM.protocolVersion} · sealed</small>
        </div>
      </section>

      <div className="market-warning" role="status">
        <ShieldAlert size={19} />
        <div><strong>Raw program deployment</strong><span>Only deploy artifacts you compiled and reviewed. Constructor bytes execute immediately and successful deployments are immutable.</span></div>
      </div>

      <section className="deploy-layout">
        <div className="deploy-workbench">
          <div className="section-heading">
            <div><span className="eyebrow">Step 01</span><h2>Select package</h2></div>
            {selectedPackage && <span className="deploy-valid"><CheckCircle2 size={15} /> Valid SVM1</span>}
          </div>
          <input
            ref={fileInput}
            className="deploy-file-input"
            type="file"
            accept=".svm,application/octet-stream"
            onChange={(event) => onSelectFile(event.target.files?.[0] ?? null)}
          />
          <button className="deploy-dropzone" type="button" onClick={() => fileInput.current?.click()}>
            {selectedPackage ? <FileCode2 size={31} /> : <UploadCloud size={31} />}
            <strong>{selectedPackage?.fileName ?? "Choose a compiled .svm package"}</strong>
            <span>{selectedPackage ? `${selectedPackage.inspection.packageLength.toLocaleString()} package bytes` : "Parsed locally; bytes go on-chain only after you deploy."}</span>
          </button>

          {selectedPackage && (
            <dl className="deploy-package-grid">
              <div><dt>Code bytes</dt><dd>{selectedPackage.inspection.codeLength.toLocaleString()}</dd></div>
              <div><dt>Constructor entry</dt><dd>{selectedPackage.inspection.constructorEntry}</dd></div>
              <div><dt>Runtime entry</dt><dd>{selectedPackage.inspection.runtimeEntry}</dd></div>
              <div className="deploy-wide"><dt>ABI hash</dt><dd><code>{compactHash(selectedPackage.inspection.abiHash)}</code><button type="button" onClick={() => copy(selectedPackage.inspection.abiHash)} aria-label="Copy ABI hash"><Copy size={13} /></button></dd></div>
              <div className="deploy-wide"><dt>Package code hash</dt><dd><code>{compactHash(selectedPackage.inspection.codeHash)}</code><button type="button" onClick={() => copy(selectedPackage.inspection.codeHash)} aria-label="Copy code hash"><Copy size={13} /></button></dd></div>
            </dl>
          )}

          <div className="deploy-form-section">
            <div><span className="eyebrow">Step 02</span><h2>Configure execution</h2></div>
            <label>Constructor arguments <span>ABI-encoded hex</span>
              <textarea
                spellCheck={false}
                placeholder="0x"
                value={constructorArgs}
                onChange={(event) => setConstructorArgs(event.target.value)}
              />
            </label>
            <div className="deploy-input-row">
              <label>Byte gas limit
                <input value={byteGasLimit} inputMode="numeric" onChange={(event) => setByteGasLimit(event.target.value)} />
              </label>
              <label>VM input <span>ETH</span>
                <input value={vmInput} inputMode="decimal" onChange={(event) => setVMInput(event.target.value)} />
              </label>
            </div>
            <p className="market-form-note">The four-byte package length prefix is added automatically. Constructor arguments must already follow the TinySol ABI's 32-byte scalar encoding.</p>
          </div>
        </div>

        <aside className="deploy-review">
          <span className="eyebrow">Step 03</span>
          <h2>Review and sign</h2>
          <dl>
            <div><dt>Creator</dt><dd>{address ? compactHash(address) : "Wallet not connected"}</dd></div>
            <div><dt>Creator nonce</dt><dd>{preview?.creatorNonce.toString() ?? "—"}</dd></div>
            <div><dt>Byte limit</dt><dd>{byteGasLimit || "—"}</dd></div>
            <div><dt>Maximum VM input</dt><dd>{vmInput || "—"} ETH</dd></div>
          </dl>
          <div className="deploy-account-id">
            <span>Predicted Mini Contract AccountId</span>
            <code>{preview?.programId ?? "Connect a wallet and select a package"}</code>
            {preview && <button type="button" onClick={() => copy(preview.programId)}><Copy size={13} /> Copy AccountId</button>}
          </div>
          <button
            className="create-button deploy-submit"
            type="button"
            disabled={Boolean(address && (!selectedPackage || !preview || !validation.valid || busy))}
            onClick={submit}
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : <FileCode2 size={18} />}
            {!address ? "Connect wallet" : phase === "signing" ? "Confirm signature…" : phase === "pending" ? "Deploying…" : "Sign and deploy"}
          </button>
          {error && <p className="market-error" role="alert">{error}</p>}
          {result && (
            <div className="deploy-success" role="status">
              <CheckCircle2 size={20} />
              <div><strong>Mini contract deployed</strong><code>{result.programId}</code><a href={`${BASE_SEPOLIA.explorerUrl}/tx/${result.receipt.hash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a></div>
            </div>
          )}
        </aside>
      </section>

      <section className="market-footnote">
        <ShieldAlert size={17} /><p><strong>Unaudited experimental environment.</strong> Deployment consumes Base Sepolia test ETH and burns VM gas token output. There is no upgrade or deletion path for an installed Mini Contract.</p>
        <span>Max code 16,384 bytes</span>
      </section>
    </main>
  );
}
