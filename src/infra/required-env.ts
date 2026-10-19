/**
 * WHY: side-effect free, so both fail-loud layers read one list: importing config.ts exits on a missing
 * value, and ConfigModule calls validateEnv(), which throws, so Nest fails its bootstrap loudly.
 * Each name is also in config/env.*.keys (__tests__/nest/config/env-manifest.test.ts).
 */
import { resolveRuntimeSwitches, runtimeMode } from "./runtime-switches";

export interface EnvMode {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
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

export const ROLES = ["api", "poller", "combined"] as const;
export type Role = (typeof ROLES)[number];

// WHY: unset means `combined`, which polls and serves: the documented local default (CLAUDE.md, Runtime topology).
// The logger labels its lines with this before config.ts has checked the value.
export function envRoleLabel(env: NodeJS.ProcessEnv): string {
  return env.ROLE || "combined";
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleErrors(env: NodeJS.ProcessEnv): string[] {
  const label = envRoleLabel(env);
  return isRole(label) ? [] : [`ROLE must be one of ${ROLES.join(" | ")} (got "${label}")`];
}

// WHY: a typo must not boot as `combined`, a second poller fleet beside the real one; config.ts exits first.
export function envRole(env: NodeJS.ProcessEnv): Role {
  const label = envRoleLabel(env);
  if (!isRole(label)) throw new Error(roleErrors(env).join("\n"));
  return label;
}

export function dbNameFor(mode: EnvMode, baseName: string | undefined): string | undefined {
  if (!baseName) return baseName;
  if (mode.isTest) return `${baseName}_test`;
  return mode.isDevelopment ? `${baseName}_dev` : baseName;
}

export function apiUrl(
  mode: EnvMode,
  env: NodeJS.ProcessEnv,
  keys: { prod: string; dev: string },
): string | undefined {
  if (mode.useProdApi) return env[keys.prod];
  return env[keys.dev] || env[keys.prod];
}

export interface RequiredValue {
  name: string;
  env: string;
  value: string | undefined;
}

export function requiredValues(env: NodeJS.ProcessEnv): RequiredValue[] {
  const mode = envMode(env);
  const db = (name: string, key: string): RequiredValue => ({ name, env: key, value: dbNameFor(mode, env[key]) });
  const raw = (name: string, key: string): RequiredValue => ({ name, env: key, value: env[key] });
  return [
    raw("mongo.url", "MONGO_URL"),
    db("mongo.dbName", "MONGO_DB_NAME_BUS_CAMPUS"),
    {
      name: "api.hsscNew",
      env: "API_HSSC_NEW_PROD",
      value: apiUrl(mode, env, { prod: "API_HSSC_NEW_PROD", dev: "API_HSSC_NEW_DEV" }),
    },
    raw("api.seoulBusServiceKey", "SEOUL_BUS_SERVICE_KEY"),
    raw("naver.styleId", "NAVER_MAP_STYLE_ID"),
    db("building.dbName", "MONGO_BUILDING_DB_NAME"),
    db("notices.dbName", "MONGO_NOTICES_DB_NAME"),
    db("eventmap.dbName", "MONGO_EVENTMAP_DB_NAME"),
    db("miniapps.dbName", "MONGO_MINIAPPS_DB_NAME"),
    db("meals.dbName", "MONGO_MEALS_DB_NAME"),
    raw("notices.serviceStartDate", "NOTICES_SERVICE_START_DATE"),
    raw("push.functionUrl", "FCM_FUNCTION_URL"),
    raw("push.apiKey", "FCM_API_KEY"),
    raw("notices.dispatch.internalToken", "INTERNAL_DISPATCH_TOKEN"),
    raw("notices.overview.aiApiUrl", "AI_API_URL"),
    raw("shuttleEta.naver.keyId", "NAVER_API_KEY_ID"),
    raw("shuttleEta.naver.key", "NAVER_API_KEY"),
    raw("shuttleEta.tmapAppKey", "TMAP_APP_KEY"),
    raw("holidays.serviceKey", "DATA_GO_KR_SERVICE_KEY"),
    raw("subway.seoulApiKey", "SEOUL_SUBWAY_API_KEY"),
    // WHY: production must report errors somewhere; elsewhere Sentry is opt-in.
    ...(mode.isProduction ? [raw("sentry.dsn", "SENTRY_DSN")] : []),
  ];
}

export function listMissingRequired(env: NodeJS.ProcessEnv): RequiredValue[] {
  return requiredValues(env).filter((v) => !v.value);
}

export function describeMissingRequired(env: NodeJS.ProcessEnv = process.env): string[] {
  return listMissingRequired(env).map(({ name, env: key }) => `  ${name} (env: ${key})`);
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { nodeEnv, isTest } = envMode(env);
  if (isTest) return;
  const missing = describeMissingRequired(env);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required config — set these env vars:\n${missing.join("\n")}`,
    );
  }
  const { errors } = resolveRuntimeSwitches(env, runtimeMode(nodeEnv));
  if (errors.length > 0) {
    throw new Error(`FATAL: Invalid runtime switch:\n  ${errors.join("\n  ")}`);
  }
  const invalidRole = roleErrors(env);
  if (invalidRole.length > 0) {
    throw new Error(`FATAL: Invalid ROLE:\n  ${invalidRole.join("\n  ")}`);
  }
}
