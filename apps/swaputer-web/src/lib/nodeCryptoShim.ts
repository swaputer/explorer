import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported browser hash algorithm: ${algorithm}`);
  const hash = sha256.create();
  const api = {
    update(value: Uint8Array | string) {
      hash.update(typeof value === "string" ? new TextEncoder().encode(value) : value);
      return api;
    },
    digest(encoding: "hex") {
      if (encoding !== "hex") throw new Error(`Unsupported browser digest encoding: ${encoding}`);
      return bytesToHex(hash.digest());
    }
  };
  return api;
}
