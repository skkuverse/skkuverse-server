import crypto from "crypto";
import { haversineM } from "../../shared/distance.util";
import type { Position } from "../../shared/geojson.types";
import { MAX_PATH_CHANGE_SHARE_TO_APPLY, MIN_PATH_POINTS_TO_TRUST, PATH_VERSION_LENGTH } from "./bus-route-path.constants";
import type { FetchedRoutePath, PathShape, PathSyncDecision } from "./bus-route-path.types";

export function toPathShape(path: readonly Position[]): PathShape {
  const lengthMeters = path.slice(1).reduce((sum, [lng, lat], index) => {
    const [fromLng, fromLat] = path[index] ?? [lng, lat];
    return sum + haversineM({ lat: fromLat, lng: fromLng }, { lat, lng });
  }, 0);
  return { pointCount: path.length, lengthMeters };
}

export function toPathVersion(fetched: FetchedRoutePath): string {
  const stations = fetched.stations.map((s) => [s.topisId, s.arsId, s.stationName, s.sequence, s.lng, s.lat, s.isTurnaround, s.direction ?? null]);
  const canonical = JSON.stringify([fetched.path, stations]);
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, PATH_VERSION_LENGTH);
}

const changedShare = (stored: number, observed: number): number => (stored === 0 ? 1 : Math.abs(observed - stored) / stored);

// WHY: a held change is never written, so an answer from another route or a broken one cannot redraw the map;
// with no stored line only the absolute checks can apply.
export function toPathSyncDecision(
  stored: { pathVersion: string; shape: PathShape } | null,
  observed: { pathVersion: string; shape: PathShape; stationCount: number },
): PathSyncDecision {
  if (stored?.pathVersion === observed.pathVersion) return { kind: "unchanged" };
  if (observed.shape.pointCount < MIN_PATH_POINTS_TO_TRUST) return { kind: "hold", reason: "tooFewPoints" };
  if (observed.stationCount === 0) return { kind: "hold", reason: "noStations" };
  if (stored === null) return { kind: "apply" };
  if (changedShare(stored.shape.pointCount, observed.shape.pointCount) > MAX_PATH_CHANGE_SHARE_TO_APPLY) return { kind: "hold", reason: "pointCountChanged" };
  if (changedShare(stored.shape.lengthMeters, observed.shape.lengthMeters) > MAX_PATH_CHANGE_SHARE_TO_APPLY) return { kind: "hold", reason: "lengthChanged" };
  return { kind: "apply" };
}
