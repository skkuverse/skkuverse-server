import { z } from "zod";
import { hasAnyText } from "../infra/i18n";
import type { I18n } from "../infra/types";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { Campus } from "../building/building.types";
import type { LiveActivation, OverlayPlaceDoc, PlaceAction, SheetPlaceDoc } from "./map.document";

// WHY: only what makes a place undrawable is checked; an importer field no renderer throws on is typed but not
// checked (`unchecked`), because a check on it would change which places are served.
// eslint-disable-next-line src-syntax/schema-casts -- the one named unchecked field; reader open per ADR 0010 D13
const unchecked = <T>(): z.ZodType<T> => z.unknown().optional() as z.ZodType<T>;
const isPresent = (value: unknown): boolean => value !== null && value !== undefined;

const renderable = {
  title: z.custom<I18n>((title) => hasAnyText(title as I18n | null)),
  location: z.custom<OverlayGeometry>(isDrawableGeometry),
  hours: z.array(z.looseObject({ startAt: z.date(), endAt: z.date().nullable(), label: unchecked<I18n | null | undefined>() })),
};

// WHY: toI18nText throws on a missing label or value, and actionDropReason on a missing button; anything else is drawn or dropped.
const drawnField = z.looseObject({ label: z.custom<I18n>(isPresent), value: z.custom<I18n>(isPresent) });

/** CONTRACT(scripts): scripts/lib/map-places-file.js writes places; map.schema.spec.ts keeps the two in step. */
export const overlayPlaceDoc = z.looseObject({
  ...renderable,
  _id: unchecked<string>(),
  campus: unchecked<Campus>(),
  category: unchecked<string>(),
  subtitle: unchecked<I18n | null | undefined>(),
  fields: z.array(drawnField),
  actions: z.array(z.custom<PlaceAction>(isPresent)),
  order: unchecked<number>(),
  facets: unchecked<Record<string, string[]> | undefined>(),
  orderByOption: unchecked<Record<string, number> | undefined>(),
}) satisfies z.ZodType<OverlayPlaceDoc>;

export const sheetPlaceDoc = z.looseObject({
  ...renderable,
  _id: unchecked<string>(),
  category: unchecked<string>(),
  fields: z.array(z.unknown()),
  actions: z.array(z.unknown()),
  detail: z.unknown().optional(),
}) satisfies z.ZodType<SheetPlaceDoc>;

// WHY: the activation query already matched `enabled` and the window, so only what the service reads is checked.
export const liveActivation = z.object({ _id: z.string(), activeUntil: z.date().nullish().transform((until) => until ?? null) }) satisfies z.ZodType<LiveActivation>;
