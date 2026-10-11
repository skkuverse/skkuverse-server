import { isAbsoluteHttpsUrl } from "../../shared/link-target.util";
import { PLACE_KINDS } from "../map.constants";

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const INSTAGRAM_RESERVED_PATHS = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
const INSTAGRAM_MEDIA_KINDS = new Set(["p", "reel", "reels"]);

function instagramSegments(value: unknown): string[] | null {
  if (!isAbsoluteHttpsUrl(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return INSTAGRAM_HOSTS.has(url.hostname.toLowerCase()) ? url.pathname.split("/").filter(Boolean) : null;
}

/** CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/map/placeDetail.ts opens one segment that is no Instagram page. */
export function isInstagramProfileUrl(value: unknown): value is string {
  const [first, ...rest] = instagramSegments(value) ?? [];
  return first !== undefined && rest.length === 0 && !INSTAGRAM_RESERVED_PATHS.has(first.toLowerCase());
}

export function isInstagramPostUrl(value: unknown): value is string {
  const [kind, ...rest] = instagramSegments(value) ?? [];
  return kind !== undefined && rest.length === 1 && INSTAGRAM_MEDIA_KINDS.has(kind.toLowerCase());
}

export function isNonBlankId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/types/placeDetail.ts has a closed PlaceKind union.
export function isPlaceKind(value: unknown): value is (typeof PLACE_KINDS)[number] {
  return (PLACE_KINDS as readonly unknown[]).includes(value);
}
