import { z } from "zod";

const STATION_ID = /^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/;

// WHY: the KRIC shape of a station id (`SubwayStation.id`); whether the station is served is findSubwayStation's.
export const stationIdParam = z.string().regex(STATION_ID, { error: "stationId must be <operator>-<line>-<station>" });
