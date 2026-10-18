import { z } from "zod";

const STATION_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// WHY: the shape of a station's slug (`SubwayStation.id`); whether the station is served is findSubwayStation's.
export const stationIdParam = z.string().regex(STATION_SLUG, { error: "stationId must be a lowercase slug" });
