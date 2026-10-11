import { z } from "zod";
import { hasAnyText } from "../infra/i18n";
import type { I18n } from "../infra/types";
import { isMediaUrl } from "../infra/media-url";
import { toWebviewUrl } from "../infra/webview-url";
import { isDrawableGeometry } from "../shared/geojson.util";
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

export const i18nText = z
  .object({ ko: text, en: text.nullish(), zh: text.nullish() })
  .transform(({ ko, en, zh }) => ({ ko, ...(en == null ? {} : { en }), ...(zh == null ? {} : { zh }) }));

export const mapCamera = z
  .object({ lat: z.number(), lng: z.number(), zoom: z.number(), tilt: z.number(), bearing: z.number(), durationMs: z.number() })
  .superRefine(({ lat, lng }, ctx) => {
    // WHY: a cheap swap detector: SKKU's longitude (126) is outside latitude's range.
    if (Math.abs(lat) > 90) addIssue(ctx, [["lat"], `${lat} is outside ±90 — lat and lng may be swapped`]);
    if (Math.abs(lng) > 180) addIssue(ctx, [["lng"], `${lng} is outside ±180`]);
  });

/** CONTRACT(scripts): scripts/lib/map-places-file.js writes places; map.schema.spec.ts keeps the two in step. */
export const renderablePlace = z.looseObject({
  title: z.custom<I18n>((title) => hasAnyText(title as I18n | null)),
  location: z.unknown().refine(isDrawableGeometry),
  hours: z.array(z.object({ startAt: z.date(), endAt: z.date().nullable() })),
  fields: z.array(z.unknown()),
  actions: z.array(z.unknown()),
});

// WHY: the URL rules read infra's origins, which rules and mappers may not import, so they parse through these.
export const webviewUrl = z
  .string()
  .transform((value, ctx) => toWebviewUrl(value) ?? (ctx.addIssue({ code: "custom", message: "is not a web view URL" }), z.NEVER));

export const mediaUrl = z.string().refine(isMediaUrl);
