import type { SenderCredentials } from "../perimeter/perimeter.ports";
import type { MiniAppTarget } from "../shared/miniapp-target.types";
import type { MiniAppDetailRaw, RegistryFile } from "./miniapps.schema";
import type { MiniAppIndexEntry } from "./miniapps.wire";

export interface RegistryIssue {
  path: Array<string | number>;
  message: string;
}

export interface RegistryIds {
  index: { miniApps: ReadonlyArray<{ id: string }> };
  details: Readonly<Record<string, { id: string }>>;
}

export type StartUrls = Readonly<Record<string, { startUrl: string }>>;

export interface RegistrySite {
  /** WHY: first-party origin → the mini app src/infra/origins.ts names as its owner. */
  owners: Readonly<Record<string, string>>;
  webviewOrigin: string;
}

/** WHY: one registry revision, frozen, so every check and the response of one request agree. */
export interface MiniAppRegistry {
  readonly revision: number;
  readonly version: number;
  readonly indexEntries: ReadonlyArray<Readonly<MiniAppIndexEntry>>;
  readonly detailsById: ReadonlyMap<string, Readonly<MiniAppDetailRaw>>;
  isRegistered(id: string): boolean;
  detailOf(id: string): Readonly<MiniAppDetailRaw> | undefined;
  senderCredentialsOf(id: string): SenderCredentials | null;
  isKnownMiniAppTarget(value: unknown): boolean;
  parseTarget(value: unknown): MiniAppTarget | null;
  isSingleEmoji(value: string): boolean;
}

export interface MiniAppsRegistryRevision {
  revision: number;
  registry: RegistryFile;
}
