import { z } from "zod";
import type { LaneConfig } from "./bus-eta-lane.types";

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const hourMinute = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm");

const laneDirection = z.enum(["southbound", "northbound"]);

const sequenceStrategy = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("car") }),
  z.object({ strategy: z.literal("busLane"), direction: laneDirection }),
]);

const sectionRange = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() });

export const laneConfigFile = z.object({
  laneHours: z.object({ from: hourMinute, to: hourMinute }),
  strategies: z.record(z.string(), z.record(z.string(), sequenceStrategy)),
  corridor: z.object({
    centerline: z.array(latLng).min(2),
    boundaries: z.array(z.object({ name: z.string().min(1), alongM: z.number().nonnegative() })).min(2),
  }),
  entryExit: z.object({
    southbound: z.object({ entry: latLng, exit: latLng }),
    northbound: z.object({ entry: latLng, exit: latLng }),
  }),
  probeRoutes: z
    .array(
      z.object({
        routeId: z.string().regex(/^\d+$/),
        name: z.string().min(1),
        sectOrds: z.object({ southbound: sectionRange, northbound: sectionRange }),
      }),
    )
    .min(1),
}) satisfies z.ZodType<LaneConfig>;
