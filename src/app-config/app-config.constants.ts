import type { AppFeatures } from "./app-config.types";

export const APP_FEATURES_DATASET = "app-features";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const APP_FEATURES_LOG_INTERVAL_MS = 60_000;

// WHY: the safe side of a kill switch is off: with no good stored value the app keeps its old shell. This is the
// defined failure mode, not a silent fallback: each cause is logged at error (skkuverse-app ADR 0023, decision 4).
export const APP_FEATURES_WHEN_UNREAD: Readonly<AppFeatures> = Object.freeze({ sharedMapShell: false });
