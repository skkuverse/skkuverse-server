export const SHELL_BARS = ["top", "bottom", "none"] as const;

export const SHELL_HEADERS = ["opaque", "overlay"] as const;

export const SHELL_STATUS_BARS = ["dark", "light"] as const;

export const SHELL_BACKGROUND_RE = /^#[0-9A-Fa-f]{6}$/;

// WHY: what a send's own Cloud Function call came back as; only `not_sent` is safe to resend.
export const DELIVERY_OUTCOMES = ["delivered", "not_sent", "unknown"] as const;

export const DELIVERY_COUNTS = ["sent", "failed", "cleanedUp"] as const;

export const SIGNING_KEY_MESSAGE = "a signing key is a 43-character base64url Ed25519 public key and its keyId, the first 16 hex characters of its SHA-256";

/**
 * WHY: at most one Mongo read per replica per TTL when a push sends every subscriber here at once, and
 * short with no stale window, so the person who tapped the push waits for the new row instead of the old.
 */
export const FEED_CACHE_TTL_MS = 3_000;

export const MINIAPPS_DATASET = "miniapps";

// WHY: a missing or invalid registry recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const REGISTRY_LOG_INTERVAL_MS = 60_000;
