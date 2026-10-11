// WHY: the same objects in Mongo and on the wire, with no converter: an axis swap can only be introduced
// at a conversion, and it never throws, it just moves the shape. RFC 7946 §3.1.1 orders `[lng, lat]`.
export type Position = [lng: number, lat: number];

// QUIRK(geojson): RFC 7946 §3.1.6 rings are closed and wound; toWirePolygon (ring-winding.util.ts) makes
// a stored one so on read.
export type LinearRing = Position[];

export interface GeoJsonPoint {
  type: "Point";
  coordinates: Position;
}

export interface GeoJsonLineString {
  type: "LineString";
  coordinates: Position[];
}

export interface GeoJsonPolygon {
  type: "Polygon";
  // QUIRK(geojson): RFC 7946 §3.1.6: the first ring is the exterior, the rest are holes.
  coordinates: LinearRing[];
}

export type OverlayGeometry = GeoJsonPoint | GeoJsonLineString | GeoJsonPolygon;
