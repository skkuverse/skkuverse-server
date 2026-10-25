/**
 * The version gates production's Doppler config held at the /app/config capture of 2026-10-19, set in the
 * environment when this file loads. src/infra/config.ts reads them once, when it loads, so a test imports this
 * file before any import that reaches src/, then calls `restoreProductionGates()` once config has loaded.
 */
export const PRODUCTION_GATES: Readonly<Record<string, string>> = {
  APP_IOS_MIN_VERSION: "3.5.0",
  APP_IOS_UPDATE_URL: "https://apps.apple.com/app/id6446813434",
  APP_ANDROID_MIN_VERSION: "3.5.0",
  APP_ANDROID_UPDATE_URL: "https://play.google.com/store/apps/details?id=com.zoyoong.skkubus",
  APP_IOS_MIN_OS_VERSION: "16.4",
  APP_ANDROID_MIN_OS_VERSION: "24",
};

const saved = Object.fromEntries(Object.keys(PRODUCTION_GATES).map((name) => [name, process.env[name]]));
Object.assign(process.env, PRODUCTION_GATES);

/** Puts back the values the environment held before this file loaded. */
export function restoreProductionGates(): void {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
