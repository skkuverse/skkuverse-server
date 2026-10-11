import type { OverlayGeometry } from "./geojson.types";

// WHY: four: a triangle's three corners plus the repeat that closes it. Fewer bound no area.
const MIN_RING_POSITIONS = 4;

function isPosition(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function isLineCoordinates(coordinates: unknown): boolean {
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(isPosition);
}

function isPolygonCoordinates(coordinates: unknown): boolean {
  return (
    Array.isArray(coordinates) &&
    coordinates.length > 0 &&
    coordinates.every(
      (ring) => Array.isArray(ring) && ring.length >= MIN_RING_POSITIONS && ring.every(isPosition),
    )
  );
}

// WHY: structural, not a `type` check: `coordinates: [null]` passes "is an array" and 500s the route later.
// A bad row is skipped, not thrown, and a fresh _dev database has no 2dsphere index to refuse it.
export function isDrawableGeometry(value: unknown): value is OverlayGeometry {
  if (typeof value !== "object" || value === null) return false;
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };

  if (type === "Point") return isPosition(coordinates);
  if (type === "LineString") return isLineCoordinates(coordinates);
  if (type === "Polygon") return isPolygonCoordinates(coordinates);
  return false;
}
