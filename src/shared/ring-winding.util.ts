// WHY: RFC 7946 winding, applied on read: 2dsphere rejects an unclosed ring but stores a reversed one,
// and the app's polygon overlay needs a known direction to be tappable. Why not in the importer:
// scripts/lib/geojson-geometry.js.

import type { GeoJsonPolygon, LinearRing, Position } from "./geojson.types";

function cross(current: Position, next: Position): number {
  return current[0] * next[1] - next[0] * current[1];
}

// WHY: planar, not spherical: only the sign is read, and cos(lat) scales the area by a positive factor,
// so it cannot flip it.
export function signedArea(ring: LinearRing): number {
  const [first, ...rest] = ring;
  if (first === undefined || ring.length < 3) return 0;

  let sum = 0;
  let current = first;
  for (const next of [...rest, first]) {
    sum += cross(current, next);
    current = next;
  }
  return sum;
}

export function isClosedRing(ring: LinearRing): boolean {
  const first = ring[0];
  const last = ring.at(-1);
  if (ring.length < 2 || first === undefined || last === undefined) return false;
  return first[0] === last[0] && first[1] === last[1];
}

// WHY: a ring too short to close is returned as-is: padding a one-point ring would make broken input
// look valid to the guard whose job is to name it.
export function closeRing(ring: LinearRing): LinearRing {
  const first = ring[0];
  if (ring.length < 2 || first === undefined || isClosedRing(ring)) return ring;
  return [...ring, first];
}

// WHY: returns its input when already conformant, so toWirePolygon keeps the authored object by reference.
export function rewindRing(
  ring: LinearRing,
  direction: "ccw" | "cw",
): LinearRing {
  const closed = closeRing(ring);
  const area = signedArea(closed);
  const isDegenerate = area === 0;
  if (isDegenerate) return closed;

  const isCcw = area > 0;
  const wantsCcw = direction === "ccw";
  return isCcw === wantsCcw ? closed : [...closed].reverse();
}

export function rewindPolygon(rings: LinearRing[]): LinearRing[] {
  return rings.map((ring, index) => rewindRing(ring, index === 0 ? "ccw" : "cw"));
}

export function toWirePolygon(geometry: GeoJsonPolygon): GeoJsonPolygon {
  const rings = rewindPolygon(geometry.coordinates);
  const unchanged = rings.every((ring, i) => ring === geometry.coordinates[i]);
  return unchanged ? geometry : { type: "Polygon", coordinates: rings };
}
