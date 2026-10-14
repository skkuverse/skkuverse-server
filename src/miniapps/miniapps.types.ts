import type { MiniAppDetailRaw } from "./miniapps.schema";
import type { MiniAppIndexEntry } from "./miniapps.wire";

export interface MiniAppTarget {
  id: string;
  /** WHY: root-relative, on the mini app's registered origin; absent means its startUrl. */
  path?: string;
}

export interface LoadedRegistry {
  version: number;
  list: ReadonlyArray<Readonly<MiniAppIndexEntry>>;
  map: ReadonlyMap<string, Readonly<MiniAppDetailRaw>>;
  /** WHY: first-party origin → the mini app that owns it, so the app opens any URL there in that shell. */
  firstPartyOrigins: Readonly<Record<string, string>>;
}
