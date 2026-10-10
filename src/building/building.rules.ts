import type { BuildNo, Campus, DisplayNo } from "./building.types";

/**
 * The user-facing building number: buildNo without its campus digit
 * ("227" on nsc → "27", "102" on hssc → "2"). A buildNo without the campus
 * prefix (E센터 and the like) is shown as is.
 */
export function toDisplayNo(buildNo: BuildNo | null, campus: Campus): DisplayNo | null {
  if (!buildNo) return null;
  const prefix = campus === "hssc" ? "1" : "2";
  if (buildNo.startsWith(prefix)) {
    return (buildNo.slice(1).replace(/^0+/, "") || "0") as DisplayNo;
  }
  return buildNo as string as DisplayNo;
}
