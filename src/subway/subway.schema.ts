import { z } from "zod";
import { isHex6 } from "../infra/color";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLATFORM_ID = /^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/;
const SEOUL_STATION_CODE = /^\d{4}$/;
const SUBWAY_ID = /^\d{4}$/;
const MAX_UPSTREAM_PLATFORMS = 3;

const localizedName = z.strictObject({ ko: z.string().min(1), en: z.string().min(1), zh: z.string().min(1) });

const hex6 = z.string().refine(isHex6, "must be six hex digits with no #");

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const glyph = z.string().refine((text) => [...GRAPHEMES.segment(text)].length === 1, "must be exactly one character");

const lineMarkerFile = z.strictObject({ text: z.strictObject({ ko: glyph, en: glyph, zh: glyph }), color: hex6 });

const platformId = z.string().regex(PLATFORM_ID, { error: "must be <operator>-<line>-<station>" });

const subwayLineFile = z.strictObject({
  code: z.string().min(1),
  name: localizedName,
  color: hex6,
  marker: lineMarkerFile,
  seoul: z.strictObject({
    subwayId: z.string().regex(SUBWAY_ID),
    lineName: z.string().min(1),
    trainMapLine: z.string().min(1).optional(),
    trainNumbers: z.enum(["timetable", "circle", "trainset"]),
  }),
});

const platformTimetable = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("korail") }),
  z.strictObject({ source: z.literal("seoul-station"), stationCode: z.string().regex(SEOUL_STATION_CODE, { error: "must be four digits" }) }),
  z.strictObject({ source: z.literal("shinbundang") }),
]);

const platformDirection = z.strictObject({
  name: localizedName,
  upstreamPlatformIds: z.array(platformId).max(MAX_UPSTREAM_PLATFORMS),
  watchedPlatformIds: z.array(platformId),
  nextPlatformId: platformId,
});

const subwayPlatformFile = z.strictObject({
  id: platformId,
  line: z.string().min(1),
  timetable: platformTimetable,
  directions: z.strictObject({ up: platformDirection, down: platformDirection }),
});

const subwayStationFile = z.strictObject({
  id: z.string().regex(SLUG, { error: "must be a lowercase slug" }),
  name: localizedName,
  seoulName: z.string().min(1),
  platforms: z.array(subwayPlatformFile).min(1),
});

const subwayNeighborFile = z.strictObject({ line: z.string().min(1), seoulName: z.string().min(1), trainMapName: z.string().min(1).optional(), name: localizedName.optional() });

export const subwayRegistryFile = z.strictObject({
  lines: z.array(subwayLineFile).min(1),
  stations: z.array(subwayStationFile).min(1),
  neighbors: z.record(platformId, subwayNeighborFile),
});
