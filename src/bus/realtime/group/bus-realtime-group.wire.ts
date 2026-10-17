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

const arrival = z.object({
  /** WHY: whole minutes, at least 1, for a running bus only; TOPIS's seconds are not accurate to the second. */
  minutes: z.int().nullable(),
  stopsAway: z.int().nullable(),
  /** WHY: from the bus's text, which wins over its numbers. */
  state: z.enum(["running", "arriving", "waiting", "ended", "noInfo", "unknown"]),
  isLastBus: z.boolean(),
  carNumber: z.string().nullable(),
  crowding: z.enum(["relaxed", "normal", "crowded"]).nullable(),
  /** QUIRK(topis): card taps in minus taps out, so riders who skip the tap out are still counted. */
  passengerCount: z.int().nullable(),
  /** QUIRK(topis): this bus's own arrival text, in Korean, served as it comes. */
  message: z.string(),
});

const stationEta = z.object({
  stationIndex: z.int(),
  /**
   * QUIRK(topis): TOPIS's own first-bus arrival text, in Korean, served as it comes.
   * WHY: deprecated, kept while installed builds from before the arrivals OTA read it.
   */
  eta: z.string().meta({ deprecated: true, description: "Legacy: read arrivals[].message; kept for installed builds from before the arrivals OTA" }),
  /** WHY: the first bus, then the second, each listed when TOPIS gave it a text. */
  arrivals: z.array(arrival),
});

/**
 * CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/bus/parser.ts (parseRealtimeData),
 * which reads each station's stationIndex and eta; arrivals and stationsVersion are additive and not read yet.
 */
export const realtimeGroup = z.object({
  groupId: z.string(),
  buses: z.array(realtimeBus),
  stationEtas: z.array(stationEta),
  /** WHY: a Jongro route's stations version, the same as its `/bus/config` group's while that is current. */
  stationsVersion: z.string().optional(),
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
export type Arrival = z.input<typeof arrival>;
