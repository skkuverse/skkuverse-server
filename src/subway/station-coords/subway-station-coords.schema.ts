import { z } from "zod";
import type { LatLng } from "../../shared/lat-lng.types";
import type { StoredStationCoords } from "./subway-station-coords.document";
import type { SubwayStationCoordsData } from "./subway-station-coords.types";

// WHY: South Korea, generously: a swapped lat and lng lands far outside it.
const isInSouthKorea = ({ lat, lng }: LatLng): boolean => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

const stationPoint = z
  .strictObject({ lat: z.number(), lng: z.number() })
  .refine(isInSouthKorea, { message: "must be { lat, lng } inside South Korea (lat 33 to 39, lng 124 to 132)", path: [] });

export const subwayStationCoordsDataset = z.strictObject({
  stations: z.record(z.string(), stationPoint),
}) satisfies z.ZodType<SubwayStationCoordsData>;

export const storedStationCoords = z.object({ revision: z.int().positive(), data: subwayStationCoordsDataset }) satisfies z.ZodType<StoredStationCoords>;
