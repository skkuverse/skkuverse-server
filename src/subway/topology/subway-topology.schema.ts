import { z } from "zod";
import type { LatLng } from "../../shared/lat-lng.types";
import { platformDirection, platformId, subwayNeighbor } from "../subway.schema";
import type { StoredSubwayTopology } from "./subway-topology.document";
import type { SubwayTopologyData } from "./subway-topology.types";

const platformDirections = z.strictObject({ up: platformDirection, down: platformDirection });

// WHY: South Korea, generously: a swapped lat and lng lands far outside it.
const isInSouthKorea = ({ lat, lng }: LatLng): boolean => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

// WHY: a journey stop names a neighbor by its station id and places it by its coords, so one never comes without the other,
// and labels it by its name in the request language, so a neighbor with a station id is named.
const placedNeighbor = subwayNeighbor
  .refine(({ coords }) => coords === undefined || isInSouthKorea(coords), { message: "must be { lat, lng } inside South Korea (lat 33 to 39, lng 124 to 132)", path: ["coords"] })
  .refine(({ stationId, coords }) => stationId === undefined || coords !== undefined, { message: "a neighbor with a station id needs coords", path: ["coords"] })
  .refine(({ stationId, coords }) => coords === undefined || stationId !== undefined, { message: "a neighbor with coords needs a station id", path: ["stationId"] })
  .refine(({ stationId, name }) => stationId === undefined || name !== undefined, { message: "a neighbor with a station id needs a name", path: ["name"] });

export const subwayTopologyDataset = z.strictObject({
  platforms: z.record(platformId, platformDirections),
  neighbors: z.record(platformId, placedNeighbor),
}) satisfies z.ZodType<SubwayTopologyData>;

export const storedSubwayTopology = z.object({ revision: z.int().positive(), data: subwayTopologyDataset }) satisfies z.ZodType<StoredSubwayTopology>;
