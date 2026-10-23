import { z } from "zod";
import { MIN_ROUTE_LINE_POINTS } from "./bus-hssc-route-line.constants";
import type { StoredHsscRouteLine } from "./bus-hssc-route-line.document";
import type { HsscRouteLineData } from "./bus-hssc-route-line.types";

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const hsscRouteLineDataset = z.strictObject({
  path: z.array(position).min(MIN_ROUTE_LINE_POINTS),
}) satisfies z.ZodType<HsscRouteLineData>;

export const storedHsscRouteLine = z.object({ revision: z.int().positive(), data: hsscRouteLineDataset }) satisfies z.ZodType<StoredHsscRouteLine>;
