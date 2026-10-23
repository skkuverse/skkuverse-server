import { haversineM } from "../../shared/distance.util";
import type { Position } from "../../shared/geojson.types";
import { MAX_ROUTE_LINE_SEGMENT_M } from "./bus-hssc-route-line.constants";
import type { HsscRouteLineData, HsscRouteLineIssue } from "./bus-hssc-route-line.types";

const toLatLng = ([lng, lat]: Position) => ({ lat, lng });

function segmentIssues(path: readonly Position[]): HsscRouteLineIssue[] {
  return path.slice(0, -1).flatMap((from, index) => {
    const to = path[index + 1] ?? from;
    const lengthM = haversineM(toLatLng(from), toLatLng(to));
    if (lengthM <= MAX_ROUTE_LINE_SEGMENT_M) return [];
    const message = `the segment from point ${index} is ${Math.round(lengthM)} m, over the ${MAX_ROUTE_LINE_SEGMENT_M} m a measured line has between points`;
    return [{ path: ["path", index + 1], message }];
  });
}

export function toRouteLineIssues({ path }: HsscRouteLineData): HsscRouteLineIssue[] {
  const [first, last] = [path[0], path[path.length - 1]];
  const isClosed = first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
  const closure = isClosed || first === undefined ? [] : [{ path: ["path", path.length - 1], message: `the line is a loop: its last point must repeat its first, [${first.join(", ")}]` }];
  return [...closure, ...segmentIssues(path)];
}
