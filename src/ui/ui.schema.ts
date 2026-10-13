import { z } from "zod";
import { isMediaUrl } from "../infra/media-url";
import { toWebviewUrl } from "../infra/webview-url";
import { linkActionType } from "../shared/link-action.wire";
import { MAX_ASPECT_RATIO, MAX_AUTO_ROTATE_SEC, MIN_ASPECT_RATIO, MIN_AUTO_ROTATE_SEC } from "./ui.constants";

const SLUG_RE = /^[a-z0-9_-]+$/;
// WHY: a time without an offset would be read in the host's zone.
const OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

const nonBlankText = z.string().refine((text) => text.trim() !== "", "must be non-blank text");
const instant = z
  .string()
  .regex(OFFSET_RE, "must be an ISO 8601 time with an explicit offset")
  .refine((text) => !Number.isNaN(Date.parse(text)), "is not a valid time");

export const localizedText = z.strictObject({ ko: nonBlankText, en: nonBlankText.optional(), zh: nonBlankText.optional() });
export const slug = z.string().regex(SLUG_RE, "must be a slug");
export const mediaUrl = z.string().refine(isMediaUrl, "must be an object on the media bucket");
// WHY: the web view origins live in infra/, which ui.rules.ts may not import, so its link rule parses through this.
export const webviewUrl = z.string().refine((value) => toWebviewUrl(value) !== null, "is not a web view URL");

export const bannerImageFile = z
  .strictObject({
    type: z.literal("image"),
    id: slug,
    imageUrl: mediaUrl,
    alt: localizedText,
    actionType: linkActionType.optional(),
    actionValue: z.string().optional(),
    startAt: instant.optional(),
    endAt: instant.optional(),
  })
  .refine((image) => (image.actionType === undefined) === (image.actionValue === undefined), {
    message: "needs both actionType and actionValue, or neither",
  })
  .refine((image) => !image.startAt || !image.endAt || Date.parse(image.startAt) < Date.parse(image.endAt), {
    message: "startAt must be before endAt",
  });

export const carouselFields = {
  type: z.literal("banner_carousel"),
  id: slug,
  aspectRatio: z.number().min(MIN_ASPECT_RATIO).max(MAX_ASPECT_RATIO),
  autoRotateSec: z
    .int()
    .refine((sec) => sec === 0 || (sec >= MIN_AUTO_ROTATE_SEC && sec <= MAX_AUTO_ROTATE_SEC), `must be 0 (off) or a whole number from ${MIN_AUTO_ROTATE_SEC} to ${MAX_AUTO_ROTATE_SEC}`),
};

export type BannerImageRaw = z.output<typeof bannerImageFile>;

export function parseConfigFile<T>(label: string, schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
  throw new Error(`${label}: ${issues.join("; ")}`);
}
