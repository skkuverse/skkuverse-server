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

const crowding = z.enum(["relaxed", "normal", "crowded"]).nullable();

/** WHY: one of the next two buses TOPIS names for a Jongno station, as the realtime route and the stop page serve it. */
export const arrival = z.object({
  /** WHY: whole minutes, at least 1, for a running bus only; TOPIS's seconds are not accurate to the second. */
  minutes: z.int().nullable(),
  stopsAway: z.int().nullable(),
  /** WHY: from the bus's text, which wins over its numbers, except a waiting tracked vehicle's, which reads waiting. */
  state: z.enum(["running", "arriving", "waiting", "ended", "noInfo", "unknown"]),
  isLastBus: z.boolean(),
  carNumber: z.string().nullable(),
  crowding,
  /** QUIRK(topis): card taps in minus taps out, so riders who skip the tap out are still counted. */
  passengerCount: z.int().nullable(),
  /** QUIRK(topis): this bus's own arrival text, in Korean, served as it comes. */
  message: z.string(),
});

export type ServedSequenceStop = z.input<typeof servedSequenceStop>;
export type StopMap = z.input<typeof stopMap>;
export type ServedStop = z.input<typeof servedStop>;
