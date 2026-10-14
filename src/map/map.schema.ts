import { z } from "zod";
import { hasAnyText } from "../infra/i18n";
import type { I18n } from "../infra/types";
import { toWebviewUrl } from "../infra/webview-url";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { LiveActivation, OverlayPlaceDoc, SheetPlaceDoc } from "./map.document";
import type { ConfigIssue } from "./map.types";

export const text = z.string().regex(/\S/);

export function absentWhenNull<T extends z.ZodType>(schema: T): z.ZodPreprocess<z.ZodOptional<T>, unknown> {
  return z.preprocess((v) => v ?? undefined, schema.optional());
}

export function defaulted<T extends z.ZodType, const F>(
  schema: T,
  fallback: F,
): z.ZodPipe<z.ZodOptional<z.ZodNullable<T>>, z.ZodTransform<z.output<T> | F, z.output<T> | null | undefined>> {
  return schema.nullish().transform((v): z.output<T> | F => v ?? fallback);
}

export function addIssue(ctx: z.RefinementCtx, found: ConfigIssue | null): void {
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

// WHY: the URL rules read infra's origins, which rules and mappers may not import, so they parse through these.
export const webviewUrl = z.string().transform((value, ctx) => {
  const url = toWebviewUrl(value);
  if (url !== null) return url;
  ctx.addIssue({ code: "custom", path: [], message: "is not a web view URL" });
  return z.NEVER;
});
