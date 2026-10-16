import { z } from "zod";

const trainArrival = z.object({
  trainNo: z.string(),
  destination: z.string(),
  express: z.boolean(),
  arrivalAt: z.iso.datetime(),
  /** WHY: counted from `generatedAt`, so the app counts down from its own receive time, not its clock. */
  remainingSec: z.int().nonnegative(),
  /** WHY: the station by its station id and where the train is there; null for a train nothing has reported. */
  position: z.object({ stationId: z.string(), state: z.enum(["approaching", "arrived", "departed"]) }).nullable(),
  source: z.enum(["live", "estimated", "scheduled"]),
});

const directionArrivals = z.object({
  direction: z.enum(["up", "down"]),
  name: z.string(),
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
