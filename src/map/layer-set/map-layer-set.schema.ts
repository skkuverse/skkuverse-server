import { z } from "zod";
import { isHex6 } from "../../infra/color";
import { isRecord } from "../../shared/object.util";
import { BASE_LAYERS, LOCATION_ACCURACIES } from "../map.constants";
import type { DailyWindow } from "../map.types";
import type { StoredLayerSets } from "./map-layer-set.document";
import { BASE_CHIPS, HHMM_RE } from "./map-layer-set.constants";
import { eventChipSpecs, eventLayerSpecs } from "./map-layer-set.mapper";
import { chipLabelIssue, crossReferenceIssue, listSortIssue, optionIssues, validateChipSpecs } from "./map-layer-set.rules";
import type { CheckedLayerSets, ConfigIssue } from "./map-layer-set.types";

const text = z.string().regex(/\S/);

function absentWhenNull<T extends z.ZodType>(schema: T): z.ZodPreprocess<z.ZodOptional<T>, unknown> {
  return z.preprocess((v) => v ?? undefined, schema.optional());
}

function defaulted<T extends z.ZodType, const F>(
  schema: T,
  fallback: F,
): z.ZodPipe<z.ZodOptional<z.ZodNullable<T>>, z.ZodTransform<z.output<T> | F, z.output<T> | null | undefined>> {
  return schema.nullish().transform((v): z.output<T> | F => v ?? fallback);
}

function addIssue(ctx: z.RefinementCtx, found: ConfigIssue | null): void {
  if (found) ctx.addIssue({ code: "custom", path: [...found[0]], message: found[1] });
}

export const i18nTextFile = z
  .object({ ko: text, en: text.nullish(), zh: text.nullish() })
  .transform(({ ko, en, zh }) => ({ ko, ...(en == null ? {} : { en }), ...(zh == null ? {} : { zh }) }));

export const mapCamera = z
  .object({ lat: z.number(), lng: z.number(), zoom: z.number(), tilt: z.number(), bearing: z.number(), durationMs: z.number() })
  .superRefine(({ lat, lng }, ctx) => {
    // WHY: a cheap swap detector: SKKU's longitude (126) is outside latitude's range.
    if (Math.abs(lat) > 90) addIssue(ctx, [["lat"], `${lat} is outside ±90 — lat and lng may be swapped`]);
    if (Math.abs(lng) > 180) addIssue(ctx, [["lng"], `${lng} is outside ±180`]);
  });

// SEE: docs/reference/event-places.md §1. A type error takes its words from the loader's error map.
const ALWAYS = 'a layer that is on all day is {"kind":"always"}';
const hhmm = text.regex(HHMM_RE, {
  error: (iss) => `"${String(iss.input)}" must be "HH:MM" on a 24-hour clock — midnight is "00:00", never "24:00"`,
});
const dailyWindow = z.object({ start: hhmm, end: hhmm }).refine((w) => w.start !== w.end, {
  path: [],
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

// WHY: the served chip row is checked only once the set's own references hold, as the committed-file loader did.
export const checkedLayerSet = layerSetFile.superRefine((set, ctx) => {
  const reference = crossReferenceIssue(set);
  if (reference !== null) return addIssue(ctx, [[], reference]);
  const chipErrors = validateChipSpecs([...BASE_CHIPS, ...eventChipSpecs(set)], [...BASE_LAYERS, ...eventLayerSpecs(set)]);
  chipErrors.forEach((error) => addIssue(ctx, [["chips"], error]));
});

function repeatIssue(ids: ReadonlyArray<unknown>, index: number): ConfigIssue | null {
  const first = ids.indexOf(ids[index]);
  return first < index ? [["layerSetId"], `repeats the layer set "${String(ids[index])}" of layerSets[${first}]`] : null;
}

export const layerSetsDataset = z.object({ layerSets: z.array(checkedLayerSet) }).superRefine(({ layerSets }, ctx) => {
  const ids = layerSets.map((set) => set.layerSetId);
  ids.forEach((_, index) => {
    const found = repeatIssue(ids, index);
    if (found) addIssue(ctx, [["layerSets", index, ...found[0]], found[1]]);
  });
});

/** WHY: each set parses alone, so a bad or repeated one is left out with its issues and the others serve (ADR 0010 D5). */
function toCheckedLayerSets(sets: readonly unknown[]): CheckedLayerSets {
  const ids = sets.map((set) => (isRecord(set) && typeof set.layerSetId === "string" ? set.layerSetId : null));
  const checked: CheckedLayerSets = { layerSets: [], rejected: [] };
  sets.forEach((set, index) => {
    const parsed = checkedLayerSet.safeParse(set);
    const repeat = ids[index] === null ? null : repeatIssue(ids, index);
    const issues = parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    if (repeat) issues.push(`${repeat[0].join(".")}: ${repeat[1]}`);
    if (parsed.success && issues.length === 0) checked.layerSets.push(Object.freeze(parsed.data));
    else checked.rejected.push({ index, layerSetId: ids[index] ?? null, issues });
  });
  return checked;
}

export const storedLayerSets = z.object({
  revision: z.int().positive(),
  data: z.object({ layerSets: z.array(z.unknown()) }).transform(({ layerSets }) => toCheckedLayerSets(layerSets)),
}) satisfies z.ZodType<StoredLayerSets>;
