import { z } from "zod";
import { HSSC_POSITION_COUNT } from "../bus.constants";
import { ARS_ID_PATTERN, STOP_ID_PATTERN, TOPIS_STOP_ID_PREFIX } from "./bus-stops.constants";
import type { BusStopsData, StoredBusStops } from "./bus-stops.document";
import type { ScheduleStop, SequenceStop } from "./bus-stops.types";

const arsId = z.string().regex(ARS_ID_PATTERN, "must be a five-digit ARS number");

const stopId = z
  .string()
  .regex(STOP_ID_PATTERN, "must be lower-case letters and digits in words joined by single hyphens")
  .refine((id) => !id.startsWith(TOPIS_STOP_ID_PREFIX), `must not start with "${TOPIS_STOP_ID_PREFIX}", which a TOPIS pole's stop id takes`);

// WHY: the catalog checks name each stop and sequence in their own words at push (bus-stops.rules.ts), so the
// structure here stops at what they need: a stop keeps every field it has, and a sequence stop is any value.
const stop = z.looseObject({ id: stopId, arsIds: z.array(arsId).optional() }).transform((checked: unknown) => checked as ScheduleStop);

const hsscStation = z.strictObject({
  stopId: stopId.nullable(),
  name: z.string().min(1),
  subtitle: z.string().min(1),
  isFirstStation: z.boolean(),
  isLastStation: z.boolean(),
  isRotationStation: z.boolean(),
  transferLines: z.array(z.strictObject({ line: z.string().min(1), color: z.string().min(1) })),
});

const topisOverlay = z.strictObject({
  name: z.strictObject({ en: z.string().min(1).optional(), zh: z.string().min(1).optional() }).optional(),
  subwayStationId: z.string().min(1).optional(),
});

export const busStopsDataset = z.strictObject({
  stops: z.array(stop),
  sequences: z.record(z.string(), z.record(z.string(), z.array(z.custom<SequenceStop>()))),
  hssc: z.strictObject({
    stations: z.array(hsscStation).length(HSSC_POSITION_COUNT, `must list exactly ${HSSC_POSITION_COUNT} positions, the count the HSSC realtime view fills`),
  }),
  topis: z.record(arsId, topisOverlay).optional(),
}) satisfies z.ZodType<BusStopsData>;

export const storedBusStops = z.object({ revision: z.int().positive(), data: busStopsDataset }) satisfies z.ZodType<StoredBusStops>;
