import type { I18n } from "../infra/types";
import { toWebviewUrl } from "../infra/webview-url";
import type { OverlayGeometry } from "../shared/geojson.types";
import { toWirePolygon } from "../shared/ring-winding.util";
import type { MarkerPresentation, OverlayBase } from "./map.types";
import type { I18nText, MapOverlay } from "./map.wire";

/**
 * WHY: `||`, not `??`: an ops sheet round-trips a missing translation as "", which would ship a blank line.
 * Total: a zh-only value passes `hasAnyText`, and the app reads `ko` unconditionally.
 */
export function toI18nText(text: I18n): I18nText {
  const ko = text.ko || text.en || text.zh || "";
  return { ko, en: text.en || ko, ...(text.zh ? { zh: text.zh } : {}) };
}

/**
 * WHY: points and lines pass through by reference, exactly as stored: an axis swap can only come from a conversion.
 * A polygon's rings are rewound, which never touches the pair inside a position.
 */
export function toOverlay(base: OverlayBase, geometry: OverlayGeometry, marker: MarkerPresentation): MapOverlay {
  if (geometry.type === "Polygon") return { ...base, kind: "polygon", geometry: toWirePolygon(geometry) };
  if (geometry.type === "LineString") return { ...base, kind: "path", geometry };
  return { ...base, kind: "marker", geometry, pinPriority: marker.pinPriority, locationAccuracy: marker.locationAccuracy };
}

/** WHY: a root-relative `webview` value is served absolute, so the app only ever opens a complete URL; it was checked before. */
export function toServedWebviewUrl(value: string): string {
  const url = toWebviewUrl(value);
  if (url === null) throw new Error(`"${value}" passed its web view check but toWebviewUrl refuses it`);
  return url;
}
