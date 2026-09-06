import { useCallback, useEffect, useState } from "react";
import type { Signer } from "ethers";
import {
  deployMiniContract,
  inspectSvmPackage,
  previewMiniContractDeployment,
  type DeploymentPreview,
  type DeploymentResult,
  type SvmPackageInspection
} from "../lib/deployer";
import { friendlyError } from "../lib/swapvm";

export type DeployPhase = "idle" | "signing" | "pending" | "confirmed" | "error";

export interface SelectedSvmPackage {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly inspection: SvmPackageInspection;
}

export function useMiniContractDeployer(address: string | null, signer: Signer | null) {
  const [selectedPackage, setSelectedPackage] = useState<SelectedSvmPackage | null>(null);
  const [preview, setPreview] = useState<DeploymentPreview | null>(null);
  const [result, setResult] = useState<DeploymentResult | null>(null);
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const selectFile = useCallback(async (file: File | null) => {
    setError(null);
    setResult(null);
    setPreview(null);
    if (!file) {
      setSelectedPackage(null);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setSelectedPackage({ fileName: file.name, bytes, inspection: inspectSvmPackage(bytes) });
      setPhase("idle");
    } catch (cause) {
      setSelectedPackage(null);
      setPhase("error");
      setError(friendlyError(cause));
    }
  }, []);

  useEffect(() => {
    let active = true;
    setPreview(null);
    if (!address || !selectedPackage) return () => { active = false; };
    previewMiniContractDeployment(address, selectedPackage.bytes)
      .then((value) => { if (active) setPreview(value); })
      .catch((cause) => { if (active) setError(friendlyError(cause)); });
    return () => { active = false; };
  }, [address, selectedPackage]);

  const deploy = useCallback(async (constructorArgs: string, byteGasLimit: number, vmInputWei: bigint) => {
    if (!address || !signer || !selectedPackage) return;
    setPhase("signing");
    setError(null);
    setResult(null);
    try {
      const deployment = await deployMiniContract(
        signer,
        address,
        selectedPackage.bytes,
        constructorArgs,
        byteGasLimit,
        vmInputWei,
        () => setPhase("pending")
      );
      setResult(deployment);
      setPreview(deployment);
      setPhase("confirmed");
    } catch (cause) {
      console.error("[deployer] Mini contract deployment failed", cause);
      setError(friendlyError(cause));
      setPhase("error");
    }
  }, [address, selectedPackage, signer]);

  return { selectedPackage, preview, result, phase, error, selectFile, deploy };
}
