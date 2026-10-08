/**
 * Nest-native fail-loud env validation.
 *
 * src/infra/config.ts already calls process.exit(1) (outside test) when any
 * required env var is missing — and src/infra/db.ts and the bus modules import
 * it, so that crash fires during bootstrap. But the hard constraint requires NestJS to THROW at bootstrap rather than rely on
 * an imported module's process.exit. So we replicate the EXACT same required[]
 * list here and throw. Both layers fail loud; neither defaults silently.
 *
 * Test mode (NODE_ENV === "test") skips the throw, as src/infra/config.ts
 * guards its exit with `if (!isTest) process.exit(1)`.
 */
import { resolveRuntimeSwitches, runtimeMode } from "../infra/runtime-switches";

const NODE_ENV: string = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
const isTest = NODE_ENV === "test";
const isDevelopment = !isProduction && !isTest;

// Same as src/infra/config.ts USE_PROD_API: production forces prod API (mistake-proof),
// otherwise honors the USE_PROD_API flag.
const USE_PROD_API = isProduction ? true : process.env.USE_PROD_API === "true";

function devDbName(baseName: string | undefined): string | undefined {
  if (!baseName) return baseName;
  if (isTest) return `${baseName}_test`;
  return isDevelopment ? `${baseName}_dev` : baseName;
}

// Exact mirror of src/infra/config.ts apiUrl(): when not using the prod API,
// prefer the _DEV value but fall back to _PROD. This is what src/infra/config.ts
// validates as the RESOLVED `api.hsscNew` value — so a dev who sets only
// API_HSSC_NEW_DEV (leaving API_HSSC_NEW_PROD empty) PASSES its required[]
// check and boots.
// Reading process.env.API_HSSC_NEW_PROD directly here would over-crash the
// Development / Staging-check modes the config table supports.
function apiUrl(prodKey: string, devKey: string): string | undefined {
  if (USE_PROD_API) return process.env[prodKey];
  return process.env[devKey] || process.env[prodKey];
}

/**
 * (An operations detail is left out of the public history.)
 *
 */
export function findMissingRequired(): string[] {
  const required: ReadonlyArray<readonly [string, unknown, string]> = [
    ["mongo.url", process.env.MONGO_URL, "MONGO_URL"],
    ["mongo.dbName", devDbName(process.env.MONGO_DB_NAME_BUS_CAMPUS), "MONGO_DB_NAME_BUS_CAMPUS"],
    [
      "api.hsscNew",
      apiUrl("API_HSSC_NEW_PROD", "API_HSSC_NEW_DEV"),
      "API_HSSC_NEW_PROD",
    ],
    ["api.seoulBusServiceKey", process.env.SEOUL_BUS_SERVICE_KEY, "SEOUL_BUS_SERVICE_KEY"],
    ["api.stationHyehwa", process.env.API_STATION_HEWA, "API_STATION_HEWA"],
    ["naver.styleId", process.env.NAVER_MAP_STYLE_ID, "NAVER_MAP_STYLE_ID"],
    ["building.dbName", devDbName(process.env.MONGO_BUILDING_DB_NAME), "MONGO_BUILDING_DB_NAME"],
    ["ad.dbName", devDbName(process.env.MONGO_AD_DB_NAME), "MONGO_AD_DB_NAME"],
    ["notices.dbName", devDbName(process.env.MONGO_NOTICES_DB_NAME), "MONGO_NOTICES_DB_NAME"],
    ["eventmap.dbName", devDbName(process.env.MONGO_EVENTMAP_DB_NAME), "MONGO_EVENTMAP_DB_NAME"],
    ["miniapps.dbName", devDbName(process.env.MONGO_MINIAPPS_DB_NAME), "MONGO_MINIAPPS_DB_NAME"],
    ["notices.serviceStartDate", process.env.NOTICES_SERVICE_START_DATE, "NOTICES_SERVICE_START_DATE"],
    ["notices.dispatch.functionUrl", process.env.FCM_FUNCTION_URL, "FCM_FUNCTION_URL"],
    ["notices.dispatch.apiKey", process.env.FCM_API_KEY, "FCM_API_KEY"],
    ["notices.dispatch.internalToken", process.env.INTERNAL_DISPATCH_TOKEN, "INTERNAL_DISPATCH_TOKEN"],
    ["notices.overview.aiApiUrl", process.env.AI_API_URL, "AI_API_URL"],
    // Production must report errors somewhere; elsewhere Sentry is opt-in.
    ...(isProduction
      ? ([["sentry.dsn", process.env.SENTRY_DSN, "SENTRY_DSN"]] as const)
      : []),
  ];

  return required
    .filter(([, value]) => !value)
    .map(([name, , envVar]) => `  ${name} (env: ${envVar})`);
}

/**
 * Fail-loud validation called at ConfigModule construction (a provider
 * useFactory). Throws — does NOT process.exit — so Nest crashes the bootstrap
 * loudly. Skipped in test mode (as src/infra/config.ts skips its exit).
 */
export function validateEnv(): void {
  if (isTest) return;
  const missing = findMissingRequired();
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required config — set these env vars:\n${missing.join("\n")}`,
    );
  }
  // The same resolver config.ts exits on, so the two layers refuse the same
  // switches.
  const { errors } = resolveRuntimeSwitches(process.env, runtimeMode(NODE_ENV));
  if (errors.length > 0) {
    throw new Error(`FATAL: Invalid runtime switch:\n  ${errors.join("\n  ")}`);
  }
}
