// WHY: a home card is a glance, not the feed: past a handful it belongs on the feed screen.
export const MIN_MINIAPP_FEED_LIMIT = 1;
export const MAX_MINIAPP_FEED_LIMIT = 10;
export const DEFAULT_MINIAPP_FEED_LIMIT = 3;

// WHY: bumped only on a breaking change; a new section or banner type is not one, clients skip it.
export const HOME_LAYOUT_VERSION = 1;

export const HOME_LAYOUT_DATASET = "home-layout";
