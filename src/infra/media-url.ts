import { MEDIA_ORIGIN } from "./origins";

const WHITESPACE_RE = /\s/;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// QUIRK(whatwg-url): `origin` ignores userinfo, so `…@evil.com` needs its own check.
function hasUserinfo(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

// WHY: a bare origin names no object, and a fragment means a pasted page link, not an object key.
function namesAnObject(url: URL): boolean {
  return url.pathname !== "/" && url.hash === "";
}

/**
 * CONTRACT(scripts): scripts/lib/map-places-file.js holds a CommonJS copy; a parity test pins both.
 * Parsed, not prefix-matched: `startsWith(MEDIA_ORIGIN)` waves through `https://media.skkuverse.com.evil.com/x`.
 */
export function isMediaUrl(value: unknown): boolean {
  // QUIRK(whatwg-url): `new URL` strips surrounding whitespace, so a pasted trailing newline would
  // otherwise validate and reach the client as part of the URL.
  if (typeof value !== "string" || value === "" || WHITESPACE_RE.test(value)) {
    return false;
  }
  const url = parseUrl(value);
  return url !== null && url.origin === MEDIA_ORIGIN && !hasUserinfo(url) && namesAnObject(url);
}
