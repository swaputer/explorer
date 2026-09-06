export interface OfficialFeatureScope {
  readonly explorer: true;
  readonly studio: true;
  readonly openMintMinter: true;
  readonly market: boolean;
  readonly seth: boolean;
  readonly auction: false;
}

/**
 * Stage 7M keeps the existing local/testnet application surface intact while
 * failing closed to the frozen core launch scope in every other environment.
 * A future mainnet manifest therefore cannot expose custody applications by
 * supplying their addresses alone.
 */
export function resolveOfficialFeatureScope(environment: string): Readonly<OfficialFeatureScope> {
  const applicationTestEnvironment = environment === "local" || environment === "testnet";
  return Object.freeze({
    explorer: true,
    studio: true,
    openMintMinter: true,
    market: applicationTestEnvironment,
    seth: applicationTestEnvironment,
    auction: false
  });
}
