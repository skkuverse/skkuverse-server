import { z } from "zod";
import type { FixedEstimate } from "./bus-eta.document";

export const fixedEstimate = z.object({
  _id: z.string(),
  serviceId: z.string(),
  routeType: z.string(),
  date: z.string(),
  time: z.string(),
  offsetsSec: z.array(z.number()),
}) satisfies z.ZodType<FixedEstimate>;
