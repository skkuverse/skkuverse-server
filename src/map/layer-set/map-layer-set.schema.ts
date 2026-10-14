import { z } from "zod";
import { isHex6 } from "../../infra/color";
import { LOCATION_ACCURACIES } from "../map.constants";
import { chipLabelIssue, listSortIssue } from "../map.rules";
import { absentWhenNull, addIssue, defaulted, i18nTextFile, mapCamera, text } from "../map.schema";
import type { DailyWindow } from "../map.types";
import { HHMM_RE } from "./map-layer-set.constants";
import { optionIssues } from "./map-layer-set.rules";

// SEE: docs/reference/event-places.md §1. A type error takes its words from the loader's error map.
const ALWAYS = 'a layer that is on all day is {"kind":"always"}';
const hhmm = text.regex(HHMM_RE, {
  error: (iss) => `"${String(iss.input)}" must be "HH:MM" on a 24-hour clock — midnight is "00:00", never "24:00"`,
});
const dailyWindow = z.object({ start: hhmm, end: hhmm }).refine((w) => w.start !== w.end, {
  error: (iss) => `has equal bounds "${(iss.input as DailyWindow).start}" — ${ALWAYS}`,
});
const fixed = (kind: "always" | "never") =>
  z.object({ kind: z.literal(kind), windows: z.undefined({ error: `is read only on kind "scheduled", and this layer is "${kind}"` }).optional() });
const windows = z.array(dailyWindow).min(1, `must not be empty — ${ALWAYS}`).refine((all): all is [DailyWindow, ...DailyWindow[]] => all.length > 0);
const visibility = z.discriminatedUnion("kind", [fixed("always"), fixed("never"), z.object({ kind: z.literal("scheduled"), windows })]);

const layer = z.object({
  color: text.refine(isHex6, 'must be a 6-digit hex colour without "#"'),
  id: text,
  label: i18nTextFile,
  defaultVisibleWhen: defaulted(visibility, { kind: "always" } as const),
  markerStyle: defaulted(z.enum(["placeDot", "textLabel"]), "placeDot"),
});

const sort = z
  .object({ key: z.enum(["order", "title"]), scopeFacetId: text.nullable().optional() })
  .superRefine((raw, ctx) => addIssue(ctx, listSortIssue(raw)))
  .transform(({ key, scopeFacetId = null }) => (key === "title" ? { key, scopeFacetId: null } : { key, scopeFacetId }));
const list = z.object({ facetIds: z.array(text), sort });
const chip = z
  .object({ layerIds: z.array(text).min(1, "must not be empty"), id: text, emoji: text, label: absentWhenNull(i18nTextFile) })
  .extend({ camera: absentWhenNull(mapCamera), list: absentWhenNull(list) })
  .superRefine((raw, ctx) => addIssue(ctx, chipLabelIssue(raw.layerIds.length, raw.label !== undefined)));

/** WHY: absolute instants: an option's day is decided with no timezone arithmetic. `null` on a tag option. */
export function toOptionWindow(from: unknown, until: unknown): { from: Date; until: Date } | null {
  return typeof from === "string" && typeof until === "string" ? { from: new Date(from), until: new Date(until) } : null;
}

const option = z.object({ id: text, label: i18nTextFile, from: z.unknown().optional(), until: z.unknown().optional() });
const facet = z
  .object({ source: z.enum(["hours", "tag"]), options: z.array(option).min(1, "must not be empty"), id: text, label: i18nTextFile })
  .extend({ select: z.enum(["required", "optional"]) })
  .superRefine((raw, ctx) => optionIssues(raw.source, raw.options).forEach((found) => addIssue(ctx, found)))
  .transform(({ options, ...head }) => ({ ...head, options: options.map(({ from, until, ...o }) => ({ ...o, window: toOptionWindow(from, until) })) }));

const presentation = z.object({
  layerId: text,
  pinPriority: z.number(),
  interactive: defaulted(z.boolean(), true),
  tapChip: defaulted(text, null),
  locationAccuracy: defaulted(z.enum(LOCATION_ACCURACIES), "exact"),
});

const itemDefaults = z.object({ byCategory: z.record(z.string(), presentation), fallback: presentation });
export const layerSetFile = z
  .object({ camera: mapCamera, layers: z.array(layer), chips: z.array(chip), facets: z.array(facet), itemDefaults })
  .extend({ layerSetId: text, campus: z.enum(["hssc", "nsc"]), name: i18nTextFile, emoji: text, timezone: z.enum(["Asia/Seoul"]) });

export type LayerSet = z.output<typeof layerSetFile>;
export type EventFacetDef = LayerSet["facets"][number];
export type EventListSort = z.output<typeof sort>;
export type ItemPresentation = z.output<typeof presentation>;
