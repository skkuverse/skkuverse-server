/**
 * How the environment resolves (mode, `_dev`/`_test` DB names, the API URL
 * fallback) and which values the server cannot start without.
 *
 * Side-effect free on purpose. Two layers fail loud on the same list:
 * importing infra/config.ts exits the process when a required value is
 * missing, and the Nest bootstrap must throw instead of relying on that exit,
 * so ConfigModule calls validateEnv() below. Each listed name must also be in
 * config/env.*.keys (__tests__/nest/config/env-manifest.test.ts).
 */
import { resolveRuntimeSwitches, runtimeMode } from "./runtime-switches";

export interface EnvMode {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
  /** Production always calls production APIs; elsewhere USE_PROD_API=true opts in. */
  useProdApi: boolean;
}

export function envMode(env: NodeJS.ProcessEnv): EnvMode {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";
  return {
    nodeEnv,
    isProduction,
    isTest,
    isDevelopment: !isProduction && !isTest,
    useProdApi: isProduction ? true : env.USE_PROD_API === "true",
  };
}

/** development → `<name>_dev`, test → `<name>_test`, production → `<name>`. */
export function devDbName(mode: EnvMode, baseName: string | undefined): string | undefined {
  if (!baseName) return baseName;
  if (mode.isTest) return `${baseName}_test`;
  return mode.isDevelopment ? `${baseName}_dev` : baseName;
}

/** The production URL when using production APIs; otherwise `_DEV`, falling back to `_PROD`. */
export function apiUrl(
  mode: EnvMode,
  env: NodeJS.ProcessEnv,
  prodKey: string,
  devKey: string,
): string | undefined {
  if (mode.useProdApi) return env[prodKey];
  return env[devKey] || env[prodKey];
}

export interface RequiredValue {
  /** Path of the value in infra/config.ts. */
  name: string;
  /** The env var to set. */
  env: string;
  value: string | undefined;
}

export function requiredValues(env: NodeJS.ProcessEnv): RequiredValue[] {
  const mode = envMode(env);
  const db = (name: string, key: string): RequiredValue => ({
    name,
    env: key,
    value: devDbName(mode, env[key]),
  });
  const raw = (name: string, key: string): RequiredValue => ({ name, env: key, value: env[key] });
  return [
    raw("mongo.url", "MONGO_URL"),
    db("mongo.dbName", "MONGO_DB_NAME_BUS_CAMPUS"),
    {
      name: "api.hsscNew",
      env: "API_HSSC_NEW_PROD",
      value: apiUrl(mode, env, "API_HSSC_NEW_PROD", "API_HSSC_NEW_DEV"),
    },
    raw("api.seoulBusServiceKey", "SEOUL_BUS_SERVICE_KEY"),
    raw("api.stationHyehwa", "API_STATION_HEWA"),
    raw("naver.styleId", "NAVER_MAP_STYLE_ID"),
    db("building.dbName", "MONGO_BUILDING_DB_NAME"),
    db("ad.dbName", "MONGO_AD_DB_NAME"),
    db("notices.dbName", "MONGO_NOTICES_DB_NAME"),
    db("eventmap.dbName", "MONGO_EVENTMAP_DB_NAME"),
    db("miniapps.dbName", "MONGO_MINIAPPS_DB_NAME"),
    raw("notices.serviceStartDate", "NOTICES_SERVICE_START_DATE"),
    raw("notices.dispatch.functionUrl", "FCM_FUNCTION_URL"),
    raw("notices.dispatch.apiKey", "FCM_API_KEY"),
    raw("notices.dispatch.internalToken", "INTERNAL_DISPATCH_TOKEN"),
    raw("notices.overview.aiApiUrl", "AI_API_URL"),
    raw("shuttleEta.naver.keyId", "NAVER_API_KEY_ID"),
    raw("shuttleEta.naver.key", "NAVER_API_KEY"),
    raw("shuttleEta.tmapAppKey", "TMAP_APP_KEY"),
    // Production must report errors somewhere; elsewhere Sentry is opt-in.
    ...(mode.isProduction ? [raw("sentry.dsn", "SENTRY_DSN")] : []),
  ];
}

export function listMissingRequired(env: NodeJS.ProcessEnv): RequiredValue[] {
  return requiredValues(env).filter((v) => !v.value);
}

/** Missing required values as `  name (env: VAR)` lines. */
export function describeMissingRequired(env: NodeJS.ProcessEnv = process.env): string[] {
  return listMissingRequired(env).map(({ name, env: key }) => `  ${name} (env: ${key})`);
}

/**
 * The Nest bootstrap check (ConfigModule). Throws, never exits, so Nest fails
 * the bootstrap loudly. Test mode skips it, as infra/config.ts skips its exit.
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { nodeEnv, isTest } = envMode(env);
  if (isTest) return;
  const missing = describeMissingRequired(env);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required config — set these env vars:\n${missing.join("\n")}`,
    );
  }
  // The same resolver config.ts exits on, so the two layers refuse the same
  // switches.
  const { errors } = resolveRuntimeSwitches(env, runtimeMode(nodeEnv));
  if (errors.length > 0) {
    throw new Error(`FATAL: Invalid runtime switch:\n  ${errors.join("\n  ")}`);
  }
}
