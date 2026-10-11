import { ABSOLUTE_HTTPS_RE, ROOT_RELATIVE_PATH_RE } from "./link-target.constants";

export function isRootRelativePath(value: string): boolean {
  return ROOT_RELATIVE_PATH_RE.test(value);
}

export function isAbsoluteHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && ABSOLUTE_HTTPS_RE.test(value);
}
