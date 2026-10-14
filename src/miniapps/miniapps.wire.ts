import { z } from "zod";
import { SHELL_BARS, SHELL_HEADERS, SHELL_STATUS_BARS } from "./miniapps.constants";

/** WHY: both registry image spellings are served as one absolute `uri`; an emoji is drawn by the app. */
const miniAppLogo = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remote"), uri: z.string() }),
  z.object({ kind: z.literal("emoji"), emoji: z.string() }),
]);

/** CONTRACT(skkuverse-app): parsed tolerantly by skkuverse-app/packages/shared/src/miniapps/schema.ts. */
export const miniAppIndexEntry = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  order: z.number(),
  homeLogo: miniAppLogo,
  shellLogo: miniAppLogo,
  /** WHY: off the home grid only: a deep link, a map button and the shell still look the mini app up. */
  hidden: z.boolean().optional(),
});

const shellConfig = z.object({
  bar: z.enum(SHELL_BARS),
  header: z.enum(SHELL_HEADERS),
  statusBar: z.enum(SHELL_STATUS_BARS),
  background: z.string(),
});

/** WHY: `shell` is complete: the defaults, under the registry's fields, under the mini app's manifest. */
export const miniAppDetail = z.object({
  version: z.number(),
  id: z.string(),
  startUrl: z.string(),
  verified: z.boolean(),
  description: z.string().optional(),
  relatedLinks: z.array(z.object({ label: z.string().optional(), url: z.string() })),
  noticeBanner: z.object({ title: z.string(), subtitle: z.string() }).optional(),
  shell: shellConfig,
});

export type MiniAppLogo = z.input<typeof miniAppLogo>;

export type MiniAppIndexEntry = z.input<typeof miniAppIndexEntry>;

export type ShellConfig = z.input<typeof shellConfig>;

export type MiniAppDetail = z.input<typeof miniAppDetail>;
