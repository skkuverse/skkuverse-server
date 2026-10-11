import { WEBVIEW_ORIGIN } from "./origins";

/**
 * SEE: docs/explanation/web-origins.md — a malformed webview URL does not fail: it opens the wrong page
 * at HTTP 200 and nothing logs it, so the check has to be here.
 */

/**
 * QUIRK(whatwg-url): `\` folds into `/` for special schemes, so `/\evil.com` resolves to
 * `https://evil.com/` exactly like `//evil.com`; both are refused.
 */
export const ROOT_RELATIVE_PATH_RE = /^\/(?![/\\])[^\s]*$/;

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
  const absolute = ROOT_RELATIVE_PATH_RE.test(value) ? `${WEBVIEW_ORIGIN}${value}` : value;

  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }

  // WHY: `origin` also settles the scheme, userinfo, a suffix host, a port and a trailing dot.
  if (url.origin !== WEBVIEW_ORIGIN) return null;

  // WHY: `/` covers a bare origin and `/#/…`, whose fragment never reaches the origin, and any hash is
  // refused because `/eskara#/entry` opens the index, not the entry page.
  if (url.pathname === "/" || url.hash !== "") return null;

  return absolute;
}
