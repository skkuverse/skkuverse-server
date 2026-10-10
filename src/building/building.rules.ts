import type { BuildNo, Campus, DisplayNo } from "./building.types";

/** Every campus; `Campus` is derived from this list. */
export const CAMPUSES = ["hssc", "nsc"] as const;

/**
 * SKKU's campus code: campusMap.do takes it as `campusCd`, and it is the
 * leading digit of every buildNo on that campus ("227" is on nsc).
 */
export const SKKU_CAMPUS_CODE: Readonly<Record<Campus, string>> = { hssc: "1", nsc: "2" };

export function isCampus(value: unknown): value is Campus {
  return (CAMPUSES as readonly unknown[]).includes(value);
}

/**
 * The user-facing building number: buildNo without its campus digit
 * ("227" on nsc → "27", "102" on hssc → "2"). A buildNo without the campus
 * prefix (E센터 and the like) is shown as is.
 */
export function toDisplayNo(buildNo: BuildNo | null, campus: Campus): DisplayNo | null {
  if (!buildNo) return null;
  if (buildNo.startsWith(SKKU_CAMPUS_CODE[campus])) {
    return (buildNo.slice(1).replace(/^0+/, "") || "0") as DisplayNo;
  }
  return buildNo as string as DisplayNo;
}
