import { z } from "zod";

const crowding = z.enum(["relaxed", "normal", "crowded"]).nullable();

const legacyBusFields = {
  /**
   * WHY: the 0-based index of the bus's last passed stop in the group's station list; a Jongro bus's is TOPIS's
   * sectOrd − 1, so a bus at route 02's loop end sits on the last index, not on the first stop that shares its stop id.
   */
  stationIndex: z.int(),
  carNumber: z.string(),
  /** WHY: deprecated, still the seconds the bus has been at that stop, for installed builds that read it. */
  estimatedTime: z.number().meta({ deprecated: true, description: "Legacy: seconds at the last passed stop; tracked buses carry tracked.status" }),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
};

const trackedCommon = {
  /** QUIRK(topis): the vehicle's vehId, stable across polls. */
  vehicleId: z.string(),
  /** EVIDENCE: TOPIS's dataTm at +09:00, median 15 s and p90 40 s old at fetch (2026-10-17 capture). */
  observedAt: z.iso.datetime({ offset: true }),
  crowding,
  isLastBus: z.boolean(),
};

/**
 * WHY: status is an extensible enum: a client falls back to the top-level fields on a status it does not know.
 * EVIDENCE: an idling bus at its origin reports stopFlag 0 and is often on no arrival row (2026-10-17 capture), so
 * waiting = standing still at a terminal (first, last or turnaround stop) or a departure-wait text on its next-stop row.
 */
const trackedStatus = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("running"),
    ...trackedCommon,
    /** WHY: sectDist / fullSectDist, from the last passed stop toward the next one. */
    progress: z.number().min(0).max(1),
    segmentMeters: z.int(),
    /** WHY: the next stop's travel time re-based from its arrival row's mkTm to observedAt, floored at 0. */
    nextStopInSec: z.int().min(0).nullable(),
  }),
  z.object({ status: z.literal("atStop"), ...trackedCommon }),
  z.object({ status: z.literal("waiting"), ...trackedCommon }),
]);

/**
 * WHY: kind is an extensible enum and the export stays open (wire-schemas): a client treats an unknown kind or
 * status, or a missing required member, as an estimated bus and renders its top-level fields.
 */
const realtimeBus = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("estimated"), ...legacyBusFields }),
  z.object({ kind: z.literal("tracked"), ...legacyBusFields, tracked: trackedStatus }),
]);

const arrival = z.object({
  /** WHY: whole minutes, at least 1, for a running bus only; TOPIS's seconds are not accurate to the second. */
  minutes: z.int().nullable(),
  stopsAway: z.int().nullable(),
  /** WHY: from the bus's text, which wins over its numbers. */
  state: z.enum(["running", "arriving", "waiting", "ended", "noInfo", "unknown"]),
  isLastBus: z.boolean(),
  carNumber: z.string().nullable(),
  crowding,
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
 * which reads each station's stationIndex and eta; arrivals, stationsVersion and each bus's kind and tracked are
 * additive and not read yet.
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
export type TrackedStatus = z.input<typeof trackedStatus>;
export type StationEta = z.input<typeof stationEta>;
export type Arrival = z.input<typeof arrival>;
