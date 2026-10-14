import { isOnWebviewOrigin, toWebviewUrl } from "../infra/webview-url";
import { isRootRelativePath } from "../shared/link-target.util";
import type { MiniAppTarget } from "./miniapps.types";

const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// WHY: the slug is the leading run up to the first `/`, where the path starts, so the split needs no delimiter.
const TARGET_RE = /^([a-z0-9-]+)(\/.*)?$/;

// WHY: graphemes, not code points: "🌶️" and "👩‍🍳" are several code points and one glyph on the tile.
export function isSingleEmoji(value: string): boolean {
  const [first, ...rest] = graphemes.segment(value);
  return first !== undefined && rest.length === 0 && PICTOGRAPHIC_RE.test(first.segment);
}

/**
 * WHY: the web view routes by path, so a fragment or its bare root lands on the wrong page at HTTP 200.
 * Only our own origin is held to it: a third party's routing is its own, and a refusal here fails the boot.
 */
export function isServableStartUrl(startUrl: string): boolean {
  return !isOnWebviewOrigin(startUrl) || toWebviewUrl(startUrl) !== null;
}

/**
 * CONTRACT(skkuverse-app): `<miniAppId>[<root-relative path>]`, the grammar of
 * skkuverse-app/packages/shared/src/miniapps/target.ts; the app resolves the path against startUrl.
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

export function isKnownMiniAppTarget(value: unknown, registry: ReadonlyMap<string, unknown>): boolean {
  const target = parseMiniAppTarget(value);
  return target !== null && registry.has(target.id);
}
