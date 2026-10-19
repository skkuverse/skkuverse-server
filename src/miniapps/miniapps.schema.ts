import { z } from "zod";
import { isMediaUrl } from "../infra/media-url";
import { SHELL_BACKGROUND_RE } from "./miniapps.constants";
import type { StoredMiniApps } from "./miniapps.document";
import { isServableStartUrl, isSingleEmoji, toRegistryCrossReferenceIssues } from "./miniapps.rules";
import { miniAppDetail } from "./miniapps.wire";

// WHY: site-root-relative, so WEB_ORIGIN stays the one place that host is written.
const LOGO_PATH_RE = /^\/[\w\-./]+$/;
const MINIAPP_ID_RE = /^[a-z0-9-]+$/;
const HTTP_URL_RE = /^https?:\/\//;

const miniAppLogoRaw = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remote"), path: z.string().regex(LOGO_PATH_RE) }),
  z.object({ kind: z.literal("media"), url: z.string().refine(isMediaUrl) }),
  z.object({ kind: z.literal("emoji"), emoji: z.string().refine(isSingleEmoji) }),
]);

// WHY: strict, because a misspelt key (`homelogo`) would pass and do nothing: the loader reads these names only.
const indexEntryRaw = z.strictObject({
  id: z.string().regex(MINIAPP_ID_RE),
  name: z.string(),
  shortName: z.string().optional(),
  order: z.number(),
  homeLogo: miniAppLogoRaw.optional(),
  shellLogo: miniAppLogoRaw.optional(),
  hidden: z.boolean().optional(),
});

const withBothLogos = indexEntryRaw.transform((entry, ctx) => {
  const homeLogo = entry.homeLogo ?? entry.shellLogo;
  const shellLogo = entry.shellLogo ?? entry.homeLogo;
  if (homeLogo && shellLogo) return { ...entry, homeLogo, shellLogo };
  ctx.addIssue({ code: "custom", path: [], message: `"${entry.id}" needs at least one of homeLogo or shellLogo` });
  return z.NEVER;
});

const detailRaw = miniAppDetail
  .extend({
    startUrl: z.string().regex(HTTP_URL_RE).refine(isServableStartUrl),
    relatedLinks: z.array(z.strictObject({ label: z.string().optional(), url: z.string().regex(HTTP_URL_RE) })),
    noticeBanner: miniAppDetail.shape.noticeBanner.unwrap().strict().optional(),
    shell: miniAppDetail.shape.shell
      .extend({ background: z.string().regex(SHELL_BACKGROUND_RE) })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export const registryFile = z.object({
  index: z.object({ version: z.number(), miniApps: z.array(withBothLogos) }),
  details: z.record(z.string(), detailRaw),
});

// WHY: the index and the details name each other, so a push that adds one half without the other is refused.
export const checkedRegistry = registryFile.superRefine((file, ctx) => {
  for (const { path, message } of toRegistryCrossReferenceIssues(file)) ctx.addIssue({ code: "custom", path, message });
});

export type MiniAppLogoRaw = z.output<typeof miniAppLogoRaw>;

export type MiniAppIndexEntryRaw = z.output<typeof withBothLogos>;

export type MiniAppDetailRaw = z.output<typeof detailRaw>;

export type RegistryFile = z.output<typeof checkedRegistry>;

export const storedRegistry = z.object({ revision: z.int().positive(), data: checkedRegistry }) satisfies z.ZodType<StoredMiniApps>;
