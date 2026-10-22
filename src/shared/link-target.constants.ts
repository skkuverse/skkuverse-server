/**
 * QUIRK(whatwg-url): the parser folds `\` into `/` and drops or percent-encodes control characters, so
 * `/\evil.com` resolves to `https://evil.com/` like `//evil.com`; a `\` or a control character is refused anywhere.
 */
export const ROOT_RELATIVE_PATH_RE = /^\/(?!\/)[^\s\\\p{Cc}]*$/u;

export const ABSOLUTE_HTTPS_RE = /^https:\/\/[^\s/\\\p{Cc}][^\s\\\p{Cc}]*$/u;
