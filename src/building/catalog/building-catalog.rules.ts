/**
 * A Korean floor name as a numeric sort key:
 * "지하2층" → -2, "1층" → 1, "옥탑1층" → 1001, anything else → Infinity.
 */
export function floorSortKey(floorKo: string | null | undefined): number {
  if (!floorKo) return Infinity;
  const basement = floorKo.match(/^지하(\d+)층$/);
  if (basement) return -parseInt(basement[1]!, 10);
  const rooftop = floorKo.match(/^옥탑(\d+)층$/);
  if (rooftop) return 1000 + parseInt(rooftop[1]!, 10);
  const normal = floorKo.match(/^(\d+)층$/);
  if (normal) return parseInt(normal[1]!, 10);
  return Infinity;
}
