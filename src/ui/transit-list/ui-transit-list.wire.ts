import { z } from "zod";

const busGroupCard = z.object({
  groupId: z.string(),
  card: z.object({
    label: z.string(),
    themeColor: z.string(),
    iconType: z.string(),
    busTypeText: z.string(),
    subtitle: z.string().nullable(),
  }),
  action: z.object({
    route: z.enum(["/bus/realtime", "/bus/schedule"]),
    groupId: z.string(),
  }),
});

/** CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/bus/parser.ts for the transit tab. */
export const transitList = z.array(busGroupCard);

export const transitListMeta = z.object({ busListCount: z.int() });

export type TransitList = z.input<typeof transitList>;
export type TransitListMeta = z.input<typeof transitListMeta>;
