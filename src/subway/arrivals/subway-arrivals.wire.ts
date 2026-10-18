import { z } from "zod";

/** WHY: nullable for a terminus, which has no station on one side. */
const neighborStation = z.object({ id: z.string(), name: z.string() }).nullable();

const trainArrival = z.object({
  trainNo: z.string(),
  destination: z.string(),
  express: z.boolean(),
  /** WHY: an instant, not seconds left: the app counts down against its own clock (owner decision 2026-10-17). */
  arrivalAt: z.iso.datetime(),
  /** WHY: 0 at the station, 1 to 3 at an upstream one; null when nothing reported the train or it is farther. */
  stopsAway: z.int().nonnegative().nullable(),
  source: z.enum(["live", "estimated", "scheduled"]),
});

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
  generatedAt: z.iso.datetime(),
  directions: z.array(directionArrivals),
});

export const subwayStationArrivals = z.object({
  /** WHY: `id` is the physical station's slug, which the route takes. */
  station: z.object({ id: z.string(), name: z.string() }),
  lines: z.array(lineArrivals),
});

export type SubwayStationArrivals = z.input<typeof subwayStationArrivals>;
