import { z } from "zod";
import { instant } from "../shared/instant.wire";
import { latLng } from "../shared/lat-lng.wire";
import { vehicle as modeVehicle } from "../shared/vehicle.wire";

/** WHY: a stop of a run as a schedule service's `stopSequences` serves it, named in the request language. */
export const servedSequenceStop = z.object({
  label: z.string(),
  action: z.enum(["board", "alight"]),
  timing: z.enum(["scheduled", "estimated"]),
  stopId: z.string().optional(),
  note: z.string().optional(),
  detail: z.string().optional(),
});

export const stopMap = z.object({
  markers: z.array(z.object({ id: z.string(), kind: z.literal("subwayExit"), label: z.string(), number: z.int(), coords: latLng })),
  paths: z.array(z.object({ kind: z.literal("walk"), from: z.string(), to: z.string(), points: z.array(latLng) })),
});

// WHY: `id` is the slug GET /subway/stations/:stationId/arrivals takes; `title` is the station title the transit tab shows.
const stopSubwayStation = z.object({ id: z.string(), title: z.string() });

export const servedStop = z.object({
  id: z.string(),
  name: z.string(),
  detail: z.string().optional(),
  coords: latLng.optional(),
  photoUrl: z.string().optional(),
  streetViewUrl: z.string().optional(),
  map: stopMap.optional(),
  subwayStation: stopSubwayStation.optional(),
});

const crowding = z.enum(["relaxed", "normal", "crowded"]);

/** WHY: deprecated with GET /bus/realtime/data/:groupId (ADR 0019, D11): one of TOPIS's next two buses as that route serves it. */
export const realtimeArrival = z.object({
  /** WHY: whole minutes, at least 1, for a running bus only; TOPIS's seconds are not accurate to the second. */
  minutes: z.int().nullable(),
  stopsAway: z.int().nullable(),
  /** WHY: from the bus's text, which wins over its numbers, except a waiting tracked vehicle's, which reads waiting. */
  state: z.enum(["running", "arriving", "waiting", "ended", "noInfo", "unknown"]),
  isLastBus: z.boolean(),
  carNumber: z.string().nullable(),
  crowding: crowding.nullable(),
  /** QUIRK(topis): card taps in minus taps out, so riders who skip the tap out are still counted. */
  passengerCount: z.int().nullable(),
  /** QUIRK(topis): this bus's own arrival text, in Korean, served as it comes. */
  message: z.string(),
});

/** WHY: where a vehicle is: positionAt is when the source saw it there, checkedAt when this server last fetched (ADR 0019, D6). */
export const vehiclePosition = z.object({
  stationIndex: z.int().min(0),
  status: z.enum(["inTransit", "atStop", "waitingToDepart"]),
  progress: z.number().min(0).max(1).nullable(),
  sectionMeters: z.int().nullable(),
  coords: latLng.nullable(),
  nextStationAt: instant.nullable(),
  positionAt: instant,
  checkedAt: instant,
});

/** WHY: s is stationIndex plus the section's fraction; on a loop it may pass the last index, read mod the station count (ADR 0019, D7). */
const trajectoryKnot = z.object({ at: instant, s: z.number().min(0) });

/** WHY: each vehicle a response mentions, once (ADR 0019, D6), its last-run flag on the call (ADR 0022, D2); trajectory null when it is not moving or has no position. */
export const vehicle = modeVehicle.extend({
  plateNumber: z.string().nullable(),
  position: vehiclePosition.nullable(),
  trajectory: z.array(trajectoryKnot).min(1).nullable(),
});

/** WHY: a live group or station's, or a timetable's: running, ended, suspended (a timetable only) or noData (ADR 0019, D8, D12). */
export const operation = z.enum(["running", "ended", "suspended", "noData"]);

export type ServedSequenceStop = z.input<typeof servedSequenceStop>;
export type StopMap = z.input<typeof stopMap>;
export type ServedStop = z.input<typeof servedStop>;
export type Vehicle = z.input<typeof vehicle>;
export type VehiclePosition = z.input<typeof vehiclePosition>;
export type Operation = z.input<typeof operation>;
