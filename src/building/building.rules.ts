import { SKKU_CAMPUS_CODE } from "./building.constants";
import type { BuildNo, Campus, DisplayNo, SkkuId, SpaceCd, WithBuildNo } from "./building.types";

export function hasBuildNo<T extends { buildNo: BuildNo | null }>(building: T): building is WithBuildNo<T> {
  return !!building.buildNo;
}

/** QUIRK(skku): a few buildings (the E Center) have a buildNo without the campus digit, shown as is. */
export function toDisplayNo(buildNo: BuildNo | null, campus: Campus): DisplayNo | null {
  if (!buildNo) return null;
  if (buildNo.startsWith(SKKU_CAMPUS_CODE[campus])) {
    return (buildNo.slice(1).replace(/^0+/, "") || "0") as DisplayNo;
  }
  return buildNo as string as DisplayNo;
}

/** QUIRK(skku): campusMap.do assigns building ids and publishes no spec; every id seen is a positive integer. */
export function isSkkuId(id: number): id is SkkuId {
  return Number.isSafeInteger(id) && id >= 1;
}

export function isBuildNo(buildNo: string): buildNo is BuildNo {
  return buildNo !== "";
}

export function isSpaceCd(spaceCd: string): spaceCd is SpaceCd {
  return spaceCd !== "";
}
