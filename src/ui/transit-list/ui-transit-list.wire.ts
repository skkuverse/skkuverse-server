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

/**
 * CONTRACT(skkuverse-app): parsed for the transit tab by installed builds, from skkuverse-app/packages/shared/src/bus/parser.ts
 * on app main; app dev reads /ui/home/transit instead and keeps this route frozen (packages/shared/src/api/endpoints.ts).
 */
export const transitList = z.array(busGroupCard);

export const transitListMeta = z.object({ busListCount: z.int() });

export type TransitList = z.input<typeof transitList>;
export type TransitListMeta = z.input<typeof transitListMeta>;
