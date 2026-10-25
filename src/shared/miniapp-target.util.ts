import type { MiniAppTarget } from "./miniapp-target.types";
import { isRootRelativePath } from "./link-target.util";

// WHY: the slug is the leading run up to the first `/`, where the path starts, so the split needs no delimiter.
const TARGET_RE = /^([a-z0-9-]+)(\/.*)?$/;

/**
 * CONTRACT(skkuverse-app): `<miniAppId>[<root-relative path>]`, the grammar of
 * skkuverse-app/packages/shared/src/utils/miniapp-target.rules.ts; the app resolves the path against startUrl.
 */
export function parseMiniAppTarget(value: unknown): MiniAppTarget | null {
  if (typeof value !== "string") return null;
  const match = TARGET_RE.exec(value);
  const id = match?.[1];
  if (id === undefined) return null;
  const path = match?.[2];
  if (path === undefined) return { id };
  return isRootRelativePath(path) ? { id, path } : null;
}
