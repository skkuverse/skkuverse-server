import { hasAnyText } from "../../infra/i18n";
import { isAbsoluteHttpsUrl, isRootRelativePath } from "../../shared/link-target.util";
import { isRecord } from "../../shared/object.util";
import type { EventFacetDef, EventMapConfig } from "../layer-set/map-layer-set.schema";
import type { OverlayPlaceDoc, PlaceAction } from "../map.document";
import { webviewUrl } from "../map.schema";

const WHITESPACE_RE = /\s/;

// QUIRK(javascript): `$` without the `m` flag matches before a final newline, so a pasted "https://x\n" passes an anchored pattern.
const isCleanValue = (value: string): boolean => value.length > 0 && !WHITESPACE_RE.test(value);

/** SEE: docs/reference/event-places.md §5: a URL opener never gets a relative string; `route` is the app's own navigator. */
export function isValidActionValue(action: PlaceAction, isKnownMiniAppTarget: (value: string) => boolean): boolean {
  const value: unknown = action.actionValue;
  if (typeof value !== "string") return false;
  if (action.actionType === "content") return value.trim() !== "";
  if (!isCleanValue(value)) return false;
  switch (action.actionType) {
    case "route":
      return isRootRelativePath(value);
    case "webview":
      return webviewUrl.safeParse(value).success;
    case "external":
      return isAbsoluteHttpsUrl(value);
    case "miniapp":
      return isKnownMiniAppTarget(value);
    default:
      return false;
  }
}

export function actionDropReason(action: PlaceAction, isKnownMiniAppTarget: (value: string) => boolean): string | null {
  if (!hasAnyText(action.label)) return `${action.id}: label is blank in every language`;
  if (isValidActionValue(action, isKnownMiniAppTarget)) return null;
  return `${action.id}: actionValue "${action.actionValue}" is not valid for actionType "${action.actionType}"`;
}

// WHY: a window belongs to the option it STARTS in, so a pub closing past the cut-over stays on its night; `[]` is always open.
function hoursOptionsOf(doc: OverlayPlaceDoc, facet: EventFacetDef): string[] {
  const opensIn = ({ window }: EventFacetDef["options"][number]): boolean =>
    window !== null && doc.hours.some((w) => w.startAt >= window.from && w.startAt < window.until);
  return facet.options.filter((option) => doc.hours.length === 0 || opensIn(option)).map((option) => option.id);
}

function tagOptionsOf(doc: OverlayPlaceDoc, facet: EventFacetDef, dropped: string[]): string[] {
  const authored: unknown = isRecord(doc.facets) && Object.hasOwn(doc.facets, facet.id) ? doc.facets[facet.id] : [];
  if (!Array.isArray(authored)) dropped.push(`${doc._id}: facets.${facet.id} is not a list`);
  const known = new Set(facet.options.map((option) => option.id));
  const values: unknown[] = Array.isArray(authored) ? authored : [];
  const offered = values.filter((value): value is string => typeof value === "string" && known.has(value));
  for (const value of values.filter((v) => !(typeof v === "string" && known.has(v)))) {
    dropped.push(`${doc._id}: facets.${facet.id} has no option ${JSON.stringify(value)}`);
  }
  return [...new Set(offered)];
}

function strayFacetKeys(doc: OverlayPlaceDoc, config: EventMapConfig): string[] {
  const authored = isRecord(doc.facets) ? Object.keys(doc.facets) : [];
  return authored.flatMap((key) => {
    const facet = config.facets.find((f) => f.id === key);
    if (!facet) return [`${doc._id}: facets.${key} is not a facet`];
    return facet.source === "hours" ? [`${doc._id}: facets.${key} is derived from hours, not authored`] : [];
  });
}

/** WHY: every facet gets a key, so the app never reads a missing one as a filter answer; a bad value is logged, not thrown. */
export function facetsOf(doc: OverlayPlaceDoc, config: EventMapConfig, dropped: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const facet of config.facets) {
    out[facet.id] = facet.source === "hours" ? hoursOptionsOf(doc, facet) : tagOptionsOf(doc, facet, dropped);
  }
  dropped.push(...strayFacetKeys(doc, config));
  return out;
}

export function orderByOptionOf(doc: OverlayPlaceDoc, config: EventMapConfig, dropped: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(doc.orderByOption)) return out;
  const known = new Set(config.facets.flatMap((f) => f.options.map((o) => o.id)));
  for (const [key, value] of Object.entries(doc.orderByOption)) {
    if (known.has(key) && typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else dropped.push(`${doc._id}: orderByOption.${key} = ${JSON.stringify(value)}`);
  }
  return out;
}
