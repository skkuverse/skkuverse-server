import type { MiniAppIndexEntryRaw, MiniAppLogoRaw } from "./miniapps.schema";
import type { MiniAppIndexEntry, MiniAppLogo } from "./miniapps.wire";

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
