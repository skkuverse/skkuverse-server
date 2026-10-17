import type { LocalizedName } from "../subway.types";
import type { SubwayLine } from "./subway-stations.types";

// WHY: English alone writes a space before it.
export const STATION_SUFFIX: LocalizedName = { ko: "역", en: " Station", zh: "站" };

// SEE: docs/explanation/subway-architecture.md ("Structure"): what adding a station touches.
export const LINE_BY_LINE_CODE: Readonly<Record<string, SubwayLine>> = {
  "1": { label: { ko: "1호선", en: "Line 1", zh: "1号线" }, color: "0052A4" },
  "4": { label: { ko: "4호선", en: "Line 4", zh: "4号线" }, color: "00A5DE" },
};
