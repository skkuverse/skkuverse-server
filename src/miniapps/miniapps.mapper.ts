import type { SenderCredentials } from "../perimeter/perimeter.ports";
import { isRecord } from "../shared/object.util";
import { SHELL_BACKGROUND_RE, SHELL_BARS, SHELL_HEADERS, SHELL_STATUS_BARS } from "./miniapps.constants";
import { parseMiniAppTarget } from "../shared/miniapp-target.util";
import { isKnownMiniAppTarget, isSingleEmoji } from "./miniapps.rules";
import type { MiniAppDetailRaw, MiniAppIndexEntryRaw, MiniAppLogoRaw, RegistryFile } from "./miniapps.schema";
import type { MiniAppRegistry } from "./miniapps.types";
import type { MiniAppIndexEntry, MiniAppLogo, ShellConfig } from "./miniapps.wire";

// WHY: an entry registered before senders carried credentials is pending, with no scopes and no keys.
function toSenderCredentials({ status, scopes, signingKeys }: Readonly<MiniAppDetailRaw>): SenderCredentials {
  return Object.freeze({ status: status ?? "pending", scopes: Object.freeze([...(scopes ?? [])]), signingKeys: Object.freeze([...(signingKeys ?? [])]) });
}

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => allowed.find((option) => option === value);

export function resolveLogo(logo: MiniAppLogoRaw, webOrigin: string): MiniAppLogo {
  switch (logo.kind) {
    case "emoji":
      return { kind: "emoji", emoji: logo.emoji };
    case "media":
      return { kind: "remote", uri: logo.url };
    case "remote":
      return { kind: "remote", uri: `${webOrigin}${logo.path}` };
  }
}

// WHY: named fields rather than `...entry`, so no on-disk value reaches the wire past the schema.
export function toIndexEntry(entry: MiniAppIndexEntryRaw, webOrigin: string): Readonly<MiniAppIndexEntry> {
  return Object.freeze({
    id: entry.id,
    name: entry.name,
    ...(entry.shortName !== undefined ? { shortName: entry.shortName } : {}),
    order: entry.order,
    homeLogo: Object.freeze(resolveLogo(entry.homeLogo, webOrigin)),
    shellLogo: Object.freeze(resolveLogo(entry.shellLogo, webOrigin)),
    ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
  });
}

/**
 * WHY: a copy of the @skkuverse/miniapp SDK's tolerant manifest parse (that package is ESM-only, this server
 * CommonJS), kept in step by hand: a bad value is dropped, and the default takes its place.
 */
export function parseShellFields(value: unknown): Partial<ShellConfig> {
  if (!isRecord(value)) return {};
  const bar = pick(value.bar, SHELL_BARS);
  const header = pick(value.header, SHELL_HEADERS);
  const statusBar = pick(value.statusBar, SHELL_STATUS_BARS);
  const background = typeof value.background === "string" && SHELL_BACKGROUND_RE.test(value.background) ? value.background : undefined;
  return {
    ...(bar ? { bar } : {}),
    ...(header ? { header } : {}),
    ...(statusBar ? { statusBar } : {}),
    ...(background ? { background: background.toUpperCase() } : {}),
  };
}

export function toMiniAppRegistry({ index, details }: RegistryFile, revision: number, webOrigin: string): MiniAppRegistry {
  const detailsById: ReadonlyMap<string, Readonly<MiniAppDetailRaw>> = new Map(Object.entries(details).map(([id, detail]) => [id, Object.freeze(detail)]));
  const credentialsById = new Map([...detailsById].map(([id, detail]) => [id, toSenderCredentials(detail)]));
  const indexEntries = [...index.miniApps].sort((a, b) => a.order - b.order).map((entry) => toIndexEntry(entry, webOrigin));
  return Object.freeze({
    revision,
    version: index.version,
    indexEntries: Object.freeze(indexEntries),
    detailsById,
    isRegistered: (id: string) => detailsById.has(id),
    detailOf: (id: string) => detailsById.get(id),
    senderCredentialsOf: (id: string) => credentialsById.get(id) ?? null,
    isKnownMiniAppTarget: (value: unknown) => isKnownMiniAppTarget(value, detailsById),
    parseTarget: parseMiniAppTarget,
    isSingleEmoji,
  });
}
