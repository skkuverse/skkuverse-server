import { z } from "zod";

const realtimeBus = z.object({
  /** WHY: the 0-based index of the bus's last passed stop in the group's station list. */
  stationIndex: z.int(),
  carNumber: z.string(),
  /** WHY: seconds the bus has been at that stop. */
  estimatedTime: z.number(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
});

const stationEta = z.object({
  stationIndex: z.int(),
  /** QUIRK(topis): TOPIS's own arrival text, in Korean, served as it comes. */
  eta: z.string(),
});

/** CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/bus/parser.ts (parseRealtimeData). */
export const realtimeGroup = z.object({
  groupId: z.string(),
  buses: z.array(realtimeBus),
  stationEtas: z.array(stationEta),
});

export const realtimeGroupMeta = z.object({
  /** WHY: the server's KST wall clock as "hh:mm AM/PM". */
  currentTime: z.string(),
  totalBuses: z.int(),
});

export type RealtimeGroup = z.input<typeof realtimeGroup>;
export type RealtimeGroupMeta = z.input<typeof realtimeGroupMeta>;
export type RealtimeBus = z.input<typeof realtimeBus>;
export type StationEta = z.input<typeof stationEta>;
