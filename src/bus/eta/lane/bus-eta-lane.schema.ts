import { z } from "zod";
import type { StoredLaneCorridor } from "./bus-eta-lane.document";
import type { LaneConfig, LaneCorridorData } from "./bus-eta-lane.types";

const latLng = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const hourMinute = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm");

const laneDirection = z.enum(["southbound", "northbound"]);

const sequenceStrategy = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("car") }),
  z.object({ strategy: z.literal("busLane"), direction: laneDirection }),
]);

const sectionRange = z.strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() });

const corridorEnds = z.strictObject({ entry: latLng, exit: latLng });

export const laneCorridorDataset = z.strictObject({
  corridor: z.strictObject({
    centerline: z.array(latLng).min(2),
    boundaries: z.array(z.strictObject({ name: z.string().min(1), alongM: z.number().nonnegative() })).min(2),
  }),
  entryExit: z.strictObject({ southbound: corridorEnds, northbound: corridorEnds }),
  probeRoutes: z
    .array(
      z.strictObject({
        routeId: z.string().regex(/^\d+$/),
        name: z.string().min(1),
        sectOrds: z.strictObject({ southbound: sectionRange, northbound: sectionRange }),
      }),
    )
    .min(1),
}) satisfies z.ZodType<LaneCorridorData>;

export const storedLaneCorridor = z.object({ revision: z.int().positive(), data: laneCorridorDataset }) satisfies z.ZodType<StoredLaneCorridor>;

export const laneConfigFile = z.object({
  laneHours: z.object({ from: hourMinute, to: hourMinute }),
  strategies: z.record(z.string(), z.record(z.string(), sequenceStrategy)),
  ...laneCorridorDataset.shape,
}) satisfies z.ZodType<LaneConfig>;
