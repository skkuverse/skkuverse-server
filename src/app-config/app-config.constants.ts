export const APP_PLATFORM_GATES_DATASET = "app-platform-gates";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const APP_PLATFORM_GATES_LOG_INTERVAL_MS = 60_000;

// CONTRACT(skkuverse-app): its force-update gate compares these with isVersionLessThan and the device's OS
// (skkuverse-app/packages/shared/src/schema/app-config.schema.ts), which reads a malformed OS floor as absent.
export const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
export const IOS_VERSION_PATTERN = /^\d+(\.\d+){0,2}$/;
export const ANDROID_API_LEVEL_PATTERN = /^\d+$/;

// WHY: the app opens this URL from its blocking force-update screen, so only an app store's host is served.
export const STORE_UPDATE_URL_HOSTS: ReadonlySet<string> = new Set(["apps.apple.com", "play.google.com"]);
