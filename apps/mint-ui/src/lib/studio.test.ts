import { describe, expect, it } from "vitest";
import { inspectSvmPackage } from "./deployer";
import { STUDIO_TEMPLATES, compileStudioSource } from "./studio";

describe("TinySol Studio browser compiler", () => {
  it("compiles every built-in template into a valid deployable SVM1 package", async () => {
    for (const template of STUDIO_TEMPLATES) {
      const build = await compileStudioSource(template.source, template.fileName);
      const inspection = inspectSvmPackage(build.packageBytes);
      expect(build.packageLength).toBeGreaterThan(44);
      expect(build.codeHash).toBe(inspection.codeHash);
      expect(build.codeLength).toBe(inspection.codeLength);
      expect(build.abi).toContain('"format":"TinySolABI"');
      expect(build.manifest).toContain('"format":"TinySolBuildManifest"');
    }
  });

  it("keeps external functions in the ABI while excluding internal helpers", async () => {
    const bridge = STUDIO_TEMPLATES.find((template) => template.id === "bridge")!;
    const build = await compileStudioSource(bridge.source, bridge.fileName);
    expect(build.functions.map((item) => item.name)).toEqual(["bridgeMint", "transfer", "balanceOf"]);
    expect(build.abi).not.toContain('"name":"move"');
  });
});
