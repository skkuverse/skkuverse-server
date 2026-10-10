/** Above any real floor, so a rooftop sorts after the top floor. */
const ROOFTOP_FLOOR_OFFSET = 1000;

/** SKKU's floor names ("지하2층", "1층", "옥탑1층") in order; a name it does not recognize, or "", sorts last. */
export function floorSortKey(floorKo: string): number {
  const basement = floorKo.match(/^지하(\d+)층$/);
  if (basement) return -parseInt(basement[1]!, 10);
  const rooftop = floorKo.match(/^옥탑(\d+)층$/);
  if (rooftop) return ROOFTOP_FLOOR_OFFSET + parseInt(rooftop[1]!, 10);
  const normal = floorKo.match(/^(\d+)층$/);
  if (normal) return parseInt(normal[1]!, 10);
  return Infinity;
}
