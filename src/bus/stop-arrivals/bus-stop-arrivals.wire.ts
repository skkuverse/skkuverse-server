import { z } from "zod";
import { arrival, operation, servedStop, vehicle } from "../bus.wire";

const instant = z.iso.datetime({ offset: true });

/** WHY: the stop as /bus/config serves its record, without the map a group's screen draws; arsIds are its TOPIS poles. */
const stopBlock = servedStop.omit({ map: true }).extend({
  /** WHY: the TOPIS ARS numbers of the poles it stands for: a pole's own, or those a local stop aliases. */
  arsIds: z.array(z.string()).optional(),
});

/** WHY: exactly the live route's station entry at stationIndex for the same stored state (ADR 0019, D12). */
const liveEntry = z.object({
  kind: z.literal("live"),
  groupId: z.string(),
  label: z.string(),
  stationIndex: z.int().min(0),
  /** WHY: the next station with a stop, so a client tells a loop's two directions apart; null at a line's last index. */
  towards: z.string().nullable(),
  /** WHY: the direction the station lies on, as its /bus/config station names it; null where it names none. */
  direction: z.object({ id: z.string(), label: z.string() }).nullable(),
  /** WHY: alight where riders may only get off (an HSSC drop-off-only stop), so a client never shows boarding there. */
  action: z.enum(["board", "alight"]),
  /** WHY: the stations version the index was placed by, the same as the live route's; null for HSSC. */
  stationsVersion: z.string().nullable(),
  updatedAt: instant.nullable(),
  operation,
  /** WHY: the vehicles its arrivals name, once each. */
  vehicles: z.array(vehicle),
  arrivals: z.array(arrival),
});

/** WHY: a run keeps its identity, its departure from the origin, so a run with no time at this stop still sorts and labels. */
const timetableArrival = arrival.extend({ runDepartureAt: instant });

const timetableEntry = z.object({
  kind: z.literal("timetable"),
  groupId: z.string(),
  label: z.string(),
  serviceId: z.string(),
  routeType: z.string(),
  action: z.enum(["board", "alight"]),
  /** WHY: the smart schedule's status: active is running; arrivals is empty unless it is. */
  operation,
  vehicles: z.array(vehicle).max(0),
  /** WHY: up to three runs, each listed until its time here passes, or its departure when no time is known here. */
  arrivals: z.array(timetableArrival),
});

/**
 * WHY: one answer per stop, so the app polls one route; `routes` in /bus/config's order. `kind` names what an entry
 * serves; it is an open enum, and a client skips an entry of a kind it does not know (ADR 0019, D3).
 */
export const busStopArrivals = z.object({
  stop: stopBlock,
  routes: z.array(z.discriminatedUnion("kind", [liveEntry, timetableEntry])),
});

export const busStopArrivalsMeta = z.object({
  /** WHY: the server's clock at +09:00 when it built the response, which a client's clock offset is read from. */
  serverNow: instant,
});

export type BusStopArrivals = z.input<typeof busStopArrivals>;
export type BusStopArrivalsMeta = z.input<typeof busStopArrivalsMeta>;
