import { FEED_CACHE_TTL_MS } from "../miniapps.constants";
import type { ShellConfig } from "../miniapps.wire";

export const DEFAULT_SHELL: Readonly<ShellConfig> = Object.freeze({
  bar: "bottom",
  header: "opaque",
  statusBar: "dark",
  background: "#FFFFFF",
});

export const CACHE_TTL_MS = 5 * 60 * 1000;

export const FETCH_FAILED_LOG_INTERVAL_MS = 10 * 60_000;

/** WHY: the registry ships with the build and changes only on deploy; five minutes bounds how long one takes to show. */
export const REGISTRY_CACHE_CONTROL = "public, max-age=300";

/**
 * WHY: as long as the feed's server cache and no longer: it is read seconds after a push woke the device.
 * Private, since the rows are in the request's language and a shared cache would serve them to every language.
 */
export const FEED_CACHE_CONTROL = `private, max-age=${FEED_CACHE_TTL_MS / 1_000}`;
