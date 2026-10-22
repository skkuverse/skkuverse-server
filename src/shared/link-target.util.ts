import { ABSOLUTE_HTTPS_RE, ROOT_RELATIVE_PATH_RE } from "./link-target.constants";

export function isRootRelativePath(value: string): boolean {
  return ROOT_RELATIVE_PATH_RE.test(value);
}

// WHY: the raw-string pattern gates first, because the parser repairs what the pattern refuses.
export function isAbsoluteHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !ABSOLUTE_HTTPS_RE.test(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  // QUIRK(whatwg-url): `https://skkuverse.com@evil.com` names evil.com: userinfo hides the host.
  return url.hostname !== "" && url.username === "" && url.password === "";
}
