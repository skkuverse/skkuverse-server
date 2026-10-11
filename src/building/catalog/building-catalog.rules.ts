import { captureGroups } from "../../shared/regex.util";

/** WHY: above any real floor, so a rooftop sorts after the top floor. */
const ROOFTOP_FLOOR_OFFSET = 1000;

export function floorSortKey(floorKo: string): number {
  const basement = captureGroups(floorKo, /^지하(\d+)층$/, 1);
  if (basement) return -parseInt(basement[0], 10);
  const rooftop = captureGroups(floorKo, /^옥탑(\d+)층$/, 1);
  if (rooftop) return ROOFTOP_FLOOR_OFFSET + parseInt(rooftop[0], 10);
  const floor = captureGroups(floorKo, /^(\d+)층$/, 1);
  if (floor) return parseInt(floor[0], 10);
  return Infinity;
}
