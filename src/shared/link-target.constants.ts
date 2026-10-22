/**
 * QUIRK(whatwg-url): the parser folds `\` into `/` and drops or encodes control and format characters, so
 * `/\evil.com` resolves to `https://evil.com/` like `//evil.com`; a `\`, `\p{Cc}` or `\p{Cf}` is refused anywhere.
 */
export const ROOT_RELATIVE_PATH_RE = /^\/(?!\/)[^\s\\\p{Cc}\p{Cf}]*$/u;

export const ABSOLUTE_HTTPS_RE = /^https:\/\/[^\s/\\\p{Cc}\p{Cf}][^\s\\\p{Cc}\p{Cf}]*$/u;
