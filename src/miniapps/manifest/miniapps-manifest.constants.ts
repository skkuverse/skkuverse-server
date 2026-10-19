/** WHY: where a first-party mini app serves its `public/skkuverse.json`, the @skkuverse/miniapp SDK manifest. */
export const MANIFEST_PATH = "/skkuverse.json";

/** WHY: a slow origin must not hold up what waits on its manifest: a detail request, or the next poll. */
export const FETCH_TIMEOUT_MS = 3_000;

/** WHY: refused whether announced or actually read, so a manifest never buffers more than this. */
export const MAX_MANIFEST_BYTES = 16 * 1024;

/** WHY: four minutes, plus a reader's minute, keeps a manifest edit within the five minutes it takes to show. */
export const POLL_INTERVAL_MS = 4 * 60_000;
