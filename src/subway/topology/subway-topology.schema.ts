import { z } from "zod";
import { platformDirection, platformId, subwayNeighbor } from "../subway.schema";
import type { StoredSubwayTopology } from "./subway-topology.document";
import type { SubwayTopologyData } from "./subway-topology.types";

const platformDirections = z.strictObject({ up: platformDirection, down: platformDirection });

export const subwayTopologyDataset = z.strictObject({
  platforms: z.record(platformId, platformDirections),
  neighbors: z.record(platformId, subwayNeighbor),
}) satisfies z.ZodType<SubwayTopologyData>;

export const storedSubwayTopology = z.object({ revision: z.int().positive(), data: subwayTopologyDataset }) satisfies z.ZodType<StoredSubwayTopology>;
