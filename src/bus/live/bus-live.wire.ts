import { z } from "zod";
import { call } from "../../shared/call.wire";
import { instant } from "../../shared/instant.wire";
import { operation, vehicle } from "../bus.wire";

/** WHY: a station the source states something for (ADR 0019, D8): an arrival, or an operation such as TOPIS's end of service. */
const liveStation = z.object({
  /** WHY: the key inside the group: a stop can sit on a line twice, and a position can have none (ADR 0019, D5). */
  stationIndex: z.int().min(0),
  /** WHY: opaque, the stop page's id, resolving aliases; it can change with a bus-stops push, so never a key (ADR 0019, D5). */
  stopId: z.string().nullable(),
  /** QUIRK(topis): the five-digit number on the pole's sign, display only; null on HSSC, whose stops carry none. */
  arsId: z.string().nullable(),
  operation,
  /** WHY: who serves the station first, at most two (ADR 0019, D9). */
  arrivals: z.array(call).max(2),
});

/** WHY: the live route of one realtime group, which the app's line screen moves to by OTA (ADR 0019, D11). */
export const liveGroup = z.object({
  groupId: z.string(),
  /** WHY: a Jongno route's stations version, as /bus/config's; null for HSSC. */
  stationsVersion: z.string().nullable(),
  /** WHY: when its poller last wrote what this answer is built from; null when it has not written within a minute. */
  updatedAt: instant.nullable(),
  operation,
  vehicles: z.array(vehicle),
  stations: z.array(liveStation),
});

export const liveGroupMeta = z.object({
  /** WHY: the server's clock at +09:00 when it built the response; a client's clock offset is read from it (ADR 0019, D10). */
  serverNow: instant,
});

export type LiveGroup = z.input<typeof liveGroup>;
export type LiveStation = z.input<typeof liveStation>;
export type LiveGroupMeta = z.input<typeof liveGroupMeta>;
