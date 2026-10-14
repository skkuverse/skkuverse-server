import { FEED_CACHE_TTL_MS } from "../miniapps.constants";
import type { ShellConfig } from "../miniapps.wire";

export const DEFAULT_SHELL: Readonly<ShellConfig> = Object.freeze({
  bar: "bottom",
  header: "opaque",
  statusBar: "dark",
  background: "#FFFFFF",
});

/** WHY: where a first-party mini app serves its `public/skkuverse.json`, the @skkuverse/miniapp SDK manifest. */
export const MANIFEST_PATH = "/skkuverse.json";

/** WHY: a slow origin must not hold up the detail request that waits on it. */
export const FETCH_TIMEOUT_MS = 3_000;

/** WHY: refused whether announced or actually read, so a manifest never buffers more than this. */
export const MAX_MANIFEST_BYTES = 16 * 1024;

export const CACHE_TTL_MS = 5 * 60 * 1000;

export const FETCH_FAILED_LOG_INTERVAL_MS = 10 * 60_000;

/** WHY: the registry ships with the build and changes only on deploy; five minutes bounds how long one takes to show. */
export const REGISTRY_CACHE_CONTROL = "public, max-age=300";

/** WHY: as long as the feed's server cache and no longer: it is read seconds after a push woke the device. */
export const FEED_CACHE_CONTROL = `public, max-age=${FEED_CACHE_TTL_MS / 1_000}`;
