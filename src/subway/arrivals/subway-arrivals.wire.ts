import { z } from "zod";
import { call } from "../../shared/call.wire";
import { instant } from "../../shared/instant.wire";

/** WHY: nullable for a terminus, which has no station on one side. */
const neighborStation = z.object({ id: z.string(), name: z.string() }).nullable();

/** WHY: the shared call (ADR 0022, D2, D3); the train number is the timetable's, which the operator's boards show. */
const trainArrival = call.extend({ trainNo: z.string() });

const directionArrivals = z.object({
  direction: z.enum(["up", "down"]),
  name: z.string(),
  previousStation: neighborStation,
  nextStation: neighborStation,
  trains: z.array(trainArrival),
});

/**
 * WHY: one character in the request language, drawn in an outlined circle; `color`, six hex digits with no `#`,
 * is the outline's and the text's on the app's light background, so it may be darker than the line's `color`.
 */
const lineMarker = z.object({ text: z.string(), color: z.string() });

/** WHY: a line's display data comes from the server, so the app keeps no line table; `color` is six hex digits, no `#`. */
const subwayLine = z.object({ code: z.string(), name: z.string(), color: z.string(), marker: lineMarker });

const lineArrivals = z.object({
  line: subwayLine,
  /** WHY: the KRIC id of this line's platform at the station, `<operator>-<line>-<station>`. */
  platformId: z.string(),
  /** WHY: per line: each platform has its own document and falls back to the timetable alone on its own. */
  generatedAt: instant,
  directions: z.array(directionArrivals),
});

/**
 * WHY: WGS84 degrees, the mean of the station's lines' platform points: the camera point the app opens its sheet on;
 * null while the server has none for the station, and the rest of the station still serves.
 */
const stationCoords = z.object({ lat: z.number(), lng: z.number() }).nullable();

export const subwayStationArrivals = z.object({
  /** WHY: `id` is the physical station's slug, which the route takes. */
  station: z.object({ id: z.string(), name: z.string(), coords: stationCoords }),
  lines: z.array(lineArrivals),
});

export const subwayStationArrivalsMeta = z.object({
  /** WHY: the server's clock at +09:00 when it built the response, which a client's clock offset is read from. */
  serverNow: z.iso.datetime({ offset: true }),
});

export type SubwayStationArrivals = z.input<typeof subwayStationArrivals>;
export type SubwayStationArrivalsMeta = z.input<typeof subwayStationArrivalsMeta>;
