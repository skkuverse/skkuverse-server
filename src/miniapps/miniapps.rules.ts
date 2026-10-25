import { createHash } from "node:crypto";
import { AppError } from "../http/app.error";
import { parseMiniAppTarget } from "../shared/miniapp-target.util";
import { isOnWebviewOrigin, toWebviewUrl } from "../shared/webview-url.util";
import type { RegistryIds, RegistryIssue, RegistrySite, StartUrls } from "./miniapps.types";

const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// WHY: graphemes, not code points: "🌶️" and "👩‍🍳" are several code points and one glyph on the tile.
export function isSingleEmoji(value: string): boolean {
  const [first, ...rest] = graphemes.segment(value);
  return first !== undefined && rest.length === 0 && PICTOGRAPHIC_RE.test(first.segment);
}

/**
 * WHY: the web view routes by path, so a fragment or its bare root lands on the wrong page at HTTP 200.
 * Only our own origin is held to it: a third party's routing is its own, and a refusal here refuses the push.
 */
export function isServableStartUrl(startUrl: string): boolean {
  return !isOnWebviewOrigin(startUrl) || toWebviewUrl(startUrl) !== null;
}

const SIGNING_PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const ED25519_PUBLIC_KEY_BYTES = 32;
const KEY_ID_HEX_CHARS = 16;

// SEE: docs/how-to/register-a-miniapp.md ("Register a signing key") — canonical only: the 4 unused bits of the
// last character are 0, so one key has one spelling.
export function isIssuedSigningKey({ keyId, publicKey }: { keyId: string; publicKey: string }): boolean {
  if (!SIGNING_PUBLIC_KEY_RE.test(publicKey)) return false;
  const raw = Buffer.from(publicKey, "base64url");
  if (raw.length !== ED25519_PUBLIC_KEY_BYTES || raw.toString("base64url") !== publicKey) return false;
  return keyId === createHash("sha256").update(raw).digest("hex").slice(0, KEY_ID_HEX_CHARS);
}

export function toDuplicateKeyIdIssues(keys: ReadonlyArray<{ keyId: string }>): RegistryIssue[] {
  return keys.flatMap(({ keyId }, i) => (keys.findIndex((other) => other.keyId === keyId) === i ? [] : [{ path: [i], message: `duplicate keyId "${keyId}"` }]));
}

export function isKnownMiniAppTarget(value: unknown, registry: ReadonlyMap<string, unknown>): boolean {
  const target = parseMiniAppTarget(value);
  return target !== null && registry.has(target.id);
}

export function toRegistryCrossReferenceIssues({ index, details }: RegistryIds): RegistryIssue[] {
  const ids = index.miniApps.map((entry) => entry.id);
  const entryIdPath = (position: number) => ["index", "miniApps", position, "id"];
  return [
    ...ids.flatMap((id, position) => (ids.indexOf(id) !== position ? [{ path: entryIdPath(position), message: `duplicate ids in index: "${id}"` }] : [])),
    ...ids.flatMap((id, position) => (Object.hasOwn(details, id) ? [] : [{ path: entryIdPath(position), message: `index id "${id}" has no detail` }])),
    ...Object.entries(details).flatMap(([id, detail]) => (detail.id === id ? [] : [{ path: ["details", id, "id"], message: `detail.id "${detail.id}" != index id "${id}"` }])),
    ...Object.keys(details).flatMap((id) => (ids.includes(id) ? [] : [{ path: ["details", id], message: `detail "${id}" not present in index` }])),
  ];
}

export function toMiniAppNotFound(id: string): AppError {
  return new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
}

// WHY: DNS reads `a.skkuverse.com.` as `a.skkuverse.com`, so a trailing dot must not move a URL off its owner's origin.
function toDotlessUrl(url: string): URL | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace(/\.$/, "");
  return parsed;
}

const originOf = (url: string): string | null => toDotlessUrl(url)?.origin ?? null;

const isOurHost = (url: string): boolean => {
  const host = toDotlessUrl(url)?.hostname ?? "";
  return host === "skkuverse.com" || host.endsWith(".skkuverse.com");
};

function ownerIssues(details: StartUrls, origin: string, owner: string): RegistryIssue[] {
  const detail = details[owner];
  if (detail === undefined) return [{ path: ["details"], message: `first-party origin ${origin} belongs to "${owner}", which is not registered` }];
  if (originOf(detail.startUrl) === origin) return [];
  return [{ path: ["details", owner, "startUrl"], message: `"${owner}" owns ${origin}, so its startUrl must be on it` }];
}

function startUrlIssues(id: string, startUrl: string, site: RegistrySite): RegistryIssue[] {
  const origin = originOf(startUrl);
  const owner = origin === null ? undefined : site.owners[origin];
  if (owner !== undefined && owner !== id) return [{ path: ["details", id, "startUrl"], message: `${origin} belongs to "${owner}", not "${id}"` }];
  if (owner !== undefined || origin === site.webviewOrigin || !isOurHost(startUrl)) return [];
  return [{ path: ["details", id, "startUrl"], message: `${origin} is on skkuverse.com but is neither the web view nor a first-party origin in src/infra/origins.ts` }];
}

// WHY: who owns a first-party origin is a trust decision held in code; a push may not move a shell to another mini app.
export function toRegistryIssues({ details }: { details: StartUrls }, site: RegistrySite): RegistryIssue[] {
  return [
    ...Object.entries(site.owners).flatMap(([origin, owner]) => ownerIssues(details, origin, owner)),
    ...Object.entries(details).flatMap(([id, detail]) => startUrlIssues(id, detail.startUrl, site)),
  ];
}
