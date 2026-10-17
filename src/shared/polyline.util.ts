import { haversineM } from "./distance.util";
import type { LatLng } from "./lat-lng.types";

const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;

interface Plane {
  x: number;
  y: number;
}

/** WHY: the fraction of the segment from→to where the origin's foot lies, clamped to the segment. */
function footFraction(from: Plane, to: Plane): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx ** 2 + dy ** 2;
  return lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(from.x * dx + from.y * dy) / lengthSq));
}

/**
 * WHY: a flat projection around the point is exact to well under a meter over one segment of a few hundred
 * meters; the distance along the line still sums the vertices' great-circle distances.
 */
export function projectOntoPolyline(polyline: readonly LatLng[], point: LatLng): { alongM: number; offsetM: number } {
  const metersPerLng = METERS_PER_DEGREE * Math.cos((point.lat * Math.PI) / 180);
  const toPlane = (vertex: LatLng): Plane => ({ x: (vertex.lng - point.lng) * metersPerLng, y: (vertex.lat - point.lat) * METERS_PER_DEGREE });
  let best = { alongM: 0, offsetM: Infinity };
  let segmentStartM = 0;
  for (const [index, to] of polyline.entries()) {
    const from = polyline[index - 1];
    if (!from) continue;
    const start = toPlane(from);
    const end = toPlane(to);
    const fraction = footFraction(start, end);
    const offsetM = Math.hypot(start.x + fraction * (end.x - start.x), start.y + fraction * (end.y - start.y));
    const segmentM = haversineM(from, to);
    if (offsetM < best.offsetM) best = { alongM: segmentStartM + fraction * segmentM, offsetM };
    segmentStartM += segmentM;
  }
  return best;
}
