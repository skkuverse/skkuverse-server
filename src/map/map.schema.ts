import { z } from "zod";
import { hasAnyText } from "../infra/i18n";
import type { I18n } from "../infra/types";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { LiveActivation, OverlayPlaceDoc, SheetPlaceDoc } from "./map.document";

// WHY: only what makes a place undrawable is checked; the other fields are the importer's, read as stored,
// so a check on them would change which places are served.
const renderablePlace = z.looseObject({
  title: z.custom<I18n>((title) => hasAnyText(title as I18n | null)),
  location: z.custom<OverlayGeometry>(isDrawableGeometry),
  hours: z.array(z.looseObject({ startAt: z.date(), endAt: z.date().nullable() })),
  fields: z.array(z.unknown()),
  actions: z.array(z.unknown()),
});

/** CONTRACT(scripts): scripts/lib/map-places-file.js writes places; map.schema.spec.ts keeps the two in step. */
export const overlayPlaceDoc = renderablePlace.transform((place) => place as unknown as OverlayPlaceDoc) satisfies z.ZodType<OverlayPlaceDoc>;
export const sheetPlaceDoc = renderablePlace.transform((place) => place as unknown as SheetPlaceDoc) satisfies z.ZodType<SheetPlaceDoc>;

// WHY: the activation query already matched `enabled` and the window, so only what the service reads is checked.
export const liveActivation = z.object({ _id: z.string(), activeUntil: z.date().nullish().transform((until) => until ?? null) }) satisfies z.ZodType<LiveActivation>;
