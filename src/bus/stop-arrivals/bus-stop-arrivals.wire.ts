import { z } from "zod";
import { realtimeArrival as arrival, servedStop } from "../bus.wire";

/** WHY: the stop as /bus/config serves its record, without the map a group's screen draws; arsIds are its TOPIS poles. */
const stopBlock = servedStop.omit({ map: true }).extend({
  /** WHY: the TOPIS ARS numbers of the poles it stands for: a pole's own, or those a local stop aliases. */
  arsIds: z.array(z.string()).optional(),
});

const jongroEntry = z.object({
  groupId: z.string(),
  kind: z.literal("arrivals"),
  label: z.string(),
  stationIndex: z.int(),
  /** WHY: the next station's name, so a client can tell the two directions of a loop apart; null at the last index. */
  towards: z.string().nullable(),
  /** WHY: the stations version the index was placed by, the same as the realtime route's. */
  stationsVersion: z.string(),
  /** WHY: exactly the realtime route's arrivals at this station index for the same stored state. */
  arrivals: z.array(arrival),
});

const hsscEntry = z.object({
  groupId: z.string(),
  kind: z.literal("approaching"),
  label: z.string(),
  stationIndex: z.int(),
  /** WHY: the HSSC API gives positions and no prediction, so only how far each bus is: 0 at the stop, nearest first. */
  approaching: z.array(z.object({ stopsAway: z.int().min(0) })),
});

const scheduledRun = z.object({
  /** WHY: the run's KST date, YYYY-MM-DD. */
  date: z.string(),
  departure: z.string(),
  /** WHY: the run's time at this stop, HH:mm, or null when neither the timetable nor an estimate gives one. */
  time: z.string().nullable(),
  /** WHY: true when `time` comes from an arrival estimate, as the smart view marks it with `eta`. */
  estimated: z.boolean(),
});

const shuttleEntry = z.object({
  groupId: z.string(),
  kind: z.literal("schedule"),
  label: z.string(),
  serviceId: z.string(),
  routeType: z.string(),
  action: z.enum(["board", "alight"]),
  /** WHY: the smart schedule's status; `next` is empty unless it is active. */
  status: z.enum(["active", "suspended", "noData"]),
  /** WHY: up to three runs whose time here, or departure when that is unknown, is not before the current minute. */
  next: z.array(scheduledRun),
});

/**
 * WHY: one answer per stop, so the app polls one route; `routes` in /bus/config's order. `kind` names what an
 * entry serves, as a realtime bus's does; it is an extensible enum, and a client skips an entry of a kind it does not know.
 */
export const busStopArrivals = z.object({
  stop: stopBlock,
  routes: z.array(z.discriminatedUnion("kind", [jongroEntry, hsscEntry, shuttleEntry])),
});

export type BusStopArrivals = z.input<typeof busStopArrivals>;
