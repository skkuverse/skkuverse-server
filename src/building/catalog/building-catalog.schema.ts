import { z } from "zod";
import { campusFilter } from "../building.schema";
import { isSkkuId } from "../building.rules";
import type { ConnectionEnds } from "./building-catalog.document";

const INVALID_ID_MESSAGE = "skkuId must be a positive integer";

export const buildingListQuery = z.object({ campus: campusFilter });
export type BuildingListQuery = z.output<typeof buildingListQuery>;

/** WHY: parseInt is the route's contract: "12abc" reads as 12, and an id parseInt cannot hold exactly is a 400. */
export const skkuIdParam = z
  .string()
  .transform((s) => parseInt(s, 10))
  .refine(isSkkuId, { error: INVALID_ID_MESSAGE });

// WHY: loose, so a floor is served exactly as seeded; the read checks only what the detail relies on.
const connectionEnd = z.looseObject({
  skkuId: z.number().refine(isSkkuId),
  floor: z.looseObject({ ko: z.string(), en: z.string() }),
});

/** CONTRACT(scripts): scripts/seed-connections.js writes connections, so they are parsed where they are read. */
export const connectionEnds = z.object({ a: connectionEnd, b: connectionEnd }) satisfies z.ZodType<ConnectionEnds>;
