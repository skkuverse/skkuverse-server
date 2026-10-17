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

export const subwayStationArrivals = z.object({
  station: z.object({
    id: z.string(),
    operatorCode: z.string(),
    lineCode: z.string(),
    stationCode: z.string(),
    name: z.string(),
  }),
  generatedAt: z.iso.datetime(),
  directions: z.array(directionArrivals),
});

export type SubwayStationArrivals = z.input<typeof subwayStationArrivals>;
