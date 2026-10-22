// WHY: a home card is a glance, not the feed: past a handful it belongs on the feed screen.
export const MIN_MINIAPP_FEED_LIMIT = 1;
export const MAX_MINIAPP_FEED_LIMIT = 10;
export const DEFAULT_MINIAPP_FEED_LIMIT = 3;

// WHY: bumped only on a breaking change; a new section or banner type is not one, clients skip it.
export const HOME_LAYOUT_VERSION = 1;

export const HOME_LAYOUT_DATASET = "home-layout";

// WHY: a missing or invalid layout recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const HOME_LAYOUT_LOG_INTERVAL_MS = 60_000;

// WHY: the games older installed builds bundle; a tile may name one before the games dataset lists it. Frozen.
// SEE: docs/reference/games-api.md (home tiles and bundled games)
export const BUNDLED_GAME_IDS: readonly string[] = Object.freeze(["wave-run", "subway-typing", "apple-game", "suika-game"]);
