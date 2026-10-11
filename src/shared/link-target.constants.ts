/**
 * QUIRK(whatwg-url): `\` folds into `/` for special schemes, so `/\evil.com` resolves to
 * `https://evil.com/` exactly like `//evil.com`; both are refused.
 */
export const ROOT_RELATIVE_PATH_RE = /^\/(?![/\\])[^\s]*$/;

export const ABSOLUTE_HTTPS_RE = /^https:\/\/[^\s/][^\s]*$/;
