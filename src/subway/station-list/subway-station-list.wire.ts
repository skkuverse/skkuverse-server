import { z } from "zod";
import { campus } from "../../shared/campus.wire";

/**
 * WHY: one character in the request language, drawn in an outlined circle; `color`, six hex digits with no `#`,
 * is the outline's and the text's on the app's light background, so it may be darker than the line's `color`.
 */
const lineMarker = z.object({ text: z.string(), color: z.string() });

/** WHY: the line display data the arrivals serve per line, so the app keeps no line table; `color` is six hex digits, no `#`. */
const subwayLine = z.object({ code: z.string(), name: z.string(), color: z.string(), marker: lineMarker });

/** WHY: WGS84 degrees, as the arrivals' `station.coords`; null while the server has none for the station, which is still listed. */
const stationCoords = z.object({ lat: z.number(), lng: z.number() }).nullable();

const listedStation = z.object({
  /** WHY: the physical station's slug, which `/subway/stations/:stationId/arrivals` takes. */
  id: z.string(),
  /** WHY: the name with the suffix the request language writes (`혜화역`, `Hyehwa Station`), as the transit tab titles it. */
  title: z.string(),
  /** WHY: the campus whose riders the station serves, the enum the bus stop list's `campus` takes; null for a station a journey rides through, listed under neither. */
  campus: campus.nullable(),
  /** WHY: one per platform, in the station's platform order. */
  lines: z.array(subwayLine),
  coords: stationCoords,
});

/** WHY: every served station in one request, for the app's map to tell whether the user is near one. */
export const subwayStationList = z.object({
  stations: z.array(listedStation),
});

export type SubwayStationList = z.input<typeof subwayStationList>;
