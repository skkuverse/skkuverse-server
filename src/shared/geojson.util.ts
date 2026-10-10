import type { OverlayGeometry } from "./geojson.types";

/**
 * Is this stored value a geometry this build can actually draw?
 *
 * Structural, not merely a `type` check, and that distinction is the whole
 * point. `coordinates: [null]` on a Polygon satisfies "is an array" and then
 * dereferences `null.length` two calls later, inside a route with no try/catch
 * — one hand-edited document 500s the whole collection for every client.
 *
 * The Mongo tier is content, so the answer to a bad row is to skip and count
 * it, never to throw: one unusable document must not take the other sixty with
 * it. The `2dsphere` index refuses most of this at insert, but it is not a
 * guarantee we can lean on — a fresh `_dev` database imported before the server
 * has ever booted has no index at all.
 */
export function isDrawableGeometry(value: unknown): value is OverlayGeometry {
  if (typeof value !== "object" || value === null) return false;
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };

  if (type === "Point") return isPosition(coordinates);
  if (type === "LineString") {
    return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(isPosition);
  }
  if (type === "Polygon") {
    return (
      Array.isArray(coordinates) &&
      coordinates.length > 0 &&
      // Four, not three: a triangle is three corners plus the repeat that
      // closes it. Fewer cannot bound an area, and `rewindRing` would read a
      // signed area of zero and leave it as-is rather than reporting anything.
      coordinates.every(
        (ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition),
      )
    );
  }
  return false;
}

function isPosition(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}
