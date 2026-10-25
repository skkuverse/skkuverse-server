import { isAbsoluteHttpsUrl, isRootRelativePath } from "./link-target.util";
import { WEBVIEW_ORIGIN } from "./webview-origin.constants";

/**
 * SEE: docs/explanation/web-origins.md — a malformed webview URL does not fail: it opens the wrong page
 * at HTTP 200 and nothing logs it, so the check has to be here.
 */

const WHITESPACE_RE = /\s/;

// WHY: the strict rule applies only on our own host: a third party routes as it likes.
export function isOnWebviewOrigin(value: string): boolean {
  try {
    return new URL(value).origin === WEBVIEW_ORIGIN;
  } catch {
    return false;
  }
}

export function toWebviewUrl(value: string): string | null {
  // QUIRK(whatwg-url): `new URL` strips surrounding whitespace, and this returns the caller's string,
  // so a pasted trailing newline would otherwise reach the client.
  if (value === "" || WHITESPACE_RE.test(value)) return null;

  // WHY: normalize first, then validate once, so both spellings answer to the same checks.
  const absolute = isRootRelativePath(value) ? `${WEBVIEW_ORIGIN}${value}` : value;

  // QUIRK(whatwg-url): the parser folds `\` and drops control characters before `origin` is read, and
  // `origin` ignores userinfo, so the raw string is held to the https link rule first.
  if (!isAbsoluteHttpsUrl(absolute)) return null;
  const url = new URL(absolute);

  // WHY: `origin` also settles the scheme, a suffix host, a port and a trailing dot.
  if (url.origin !== WEBVIEW_ORIGIN) return null;

  // WHY: `/` covers a bare origin and `/#/…`, whose fragment never reaches the origin, and any hash is
  // refused because `/eskara#/entry` opens the index, not the entry page.
  if (url.pathname === "/" || url.hash !== "") return null;

  return absolute;
}

/** WHY: a root-relative `webview` value is served absolute, so the app only ever opens a complete URL; it was checked before. */
export function toServedWebviewUrl(value: string): string {
  const url = toWebviewUrl(value);
  if (url === null) throw new Error(`"${value}" passed its web view check but toWebviewUrl refuses it`);
  return url;
}
