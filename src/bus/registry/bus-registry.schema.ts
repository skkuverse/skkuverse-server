import { z } from "zod";
import type { JongroRouteDocument, StationServiceHours } from "./bus-registry.document";

const storedStation = z.object({ topisId: z.string(), arsId: z.string(), stationName: z.string(), sequence: z.int() });

export const jongroRouteDocument = z.object({
  _id: z.string(),
  stations: z.array(storedStation),
  turnaroundTopisId: z.string(),
  stationsVersion: z.string(),
  syncedAt: z.date(),
}) satisfies z.ZodType<JongroRouteDocument>;

const stationServiceHours = z.object({ sequence: z.int(), firstTm: z.string(), lastTm: z.string() }) satisfies z.ZodType<StationServiceHours>;

export const jongroRouteServiceHours = z.object({ serviceHours: z.array(stationServiceHours).optional() });
