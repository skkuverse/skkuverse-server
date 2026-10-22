import { z } from "zod";

const latLng = z.object({ lat: z.number(), lng: z.number() });

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

// SEE: docs/reference/bus-live-api.md ("Open enums"): a client skips, or renders the providerText of, a value it does not know.
const instant = z.iso.datetime({ offset: true });

/** WHY: one bus or run at one station, every key present, null when unknown (ADR 0019, D1, D3, D4). */
export const arrival = z.object({
  status: z.enum(["atStop", "arriving", "enRoute", "waitingToDepart", "scheduled", "unknown"]),
  expectedArrivalAt: instant.nullable(),
  expectedDepartureAt: instant.nullable(),
  scheduledArrivalAt: instant.nullable(),
  scheduledDepartureAt: instant.nullable(),
  basis: z.enum(["provider", "estimate", "timetable"]),
  /** WHY: the stops the bus reaches first, plus one: 1 its next stop, 0 standing here; null for a timetable run. */
  stopsAway: z.int().nullable(),
  isLastBus: z.boolean().nullable(),
  /** WHY: a key of the response's vehicles; null for a run with no vehicle. */
  vehicleId: z.string().nullable(),
  /** QUIRK(topis): the upstream's own text as received (arrmsg, Korean). */
  providerText: z.string().nullable(),
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

/** WHY: each vehicle a response mentions, once (ADR 0019, D6); trajectory null when it is not moving or has no position. */
export const vehicle = z.object({
  id: z.string(),
  plateNumber: z.string().nullable(),
  occupancy: z.object({ level: crowding, passengerCount: z.int().nullable() }).nullable(),
  isLastBus: z.boolean().nullable(),
  position: vehiclePosition.nullable(),
  trajectory: z.array(trajectoryKnot).min(1).nullable(),
});

/** WHY: a live group or station's, or a timetable's: running, ended, suspended (a timetable only) or noData (ADR 0019, D8, D12). */
export const operation = z.enum(["running", "ended", "suspended", "noData"]);

export type ServedSequenceStop = z.input<typeof servedSequenceStop>;
export type StopMap = z.input<typeof stopMap>;
export type ServedStop = z.input<typeof servedStop>;
export type Arrival = z.input<typeof arrival>;
export type Vehicle = z.input<typeof vehicle>;
export type VehiclePosition = z.input<typeof vehiclePosition>;
export type Operation = z.input<typeof operation>;
