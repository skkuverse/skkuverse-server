import { BusEtaDirectionsError } from "../bus-eta.error";
import { orderAndTotalIssue, stopDistanceIssue } from "../bus-eta.rules";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { CorridorEnds } from "../lane/bus-eta-lane.types";
import type { CorridorRoute, NaverDirectionsGuide, NaverDirectionsResponse, RoutePoint, RouteTimes } from "./bus-eta-travel.types";

const GUIDE_WAYPOINT = 87;
const GUIDE_GOAL = 88;
const MAX_TOTAL_MISMATCH_MS = 30_000;
const CORRIDOR_LEG_INDEX = 1;

const implausible = (message: string): BusEtaDirectionsError => new BusEtaDirectionsError("naver", "implausible", message);

// QUIRK(naver): a waypoint is one `type: 87` guide entry and the goal the `type: 88` one, so the running sum of
// durations up to each is that point's travel time; probed on 2026-10-09, the durations sum to the route total.
function toGuideMarks(guide: readonly NaverDirectionsGuide[]) {
  const marks = { offsetsMs: [0], pointIndexes: [0], waypoints: 0, goals: 0 };
  let running = 0;
  for (const entry of guide) {
    running += entry.duration;
    if (entry.type === GUIDE_WAYPOINT) marks.waypoints += 1;
    else if (entry.type === GUIDE_GOAL) marks.goals += 1;
    else continue;
    marks.offsetsMs.push(running);
    marks.pointIndexes.push(entry.pointIndex);
  }
  return marks;
}

function checkPointsOnPath(path: ReadonlyArray<[number, number]>, pointIndexes: readonly number[], points: readonly RoutePoint[]): void {
  points.forEach(({ at, kind }, index) => {
    const point = path[pointIndexes[index] ?? path.length];
    if (!point) throw implausible(`${kind} ${index} points past the end of the path (index ${pointIndexes[index]})`);
    const issue = stopDistanceIssue(at, { lat: point[1], lng: point[0] }, index);
    if (issue) throw implausible(issue.replace(/^stop/, kind));
  });
}

/** WHY: throws a BusEtaDirectionsError for a failed or implausible route, which is rejected, never stored. */
export function toNaverRouteTimes(res: NaverDirectionsResponse, points: readonly RoutePoint[]): RouteTimes {
  if (res.code !== 0) throw new BusEtaDirectionsError("naver", "api", `code ${res.code} (${res.message})`);
  const route = res.route?.traoptimal?.[0];
  if (!route) throw implausible("no traoptimal route in the response");
  const { offsetsMs, pointIndexes, waypoints, goals } = toGuideMarks(route.guide);
  const expectedWaypoints = points.length - 2;
  if (waypoints !== expectedWaypoints || goals !== 1) throw implausible(`expected ${expectedWaypoints} waypoint (87) and 1 goal (88) guide entries, got ${waypoints} and ${goals}`);
  const orderIssue = orderAndTotalIssue(offsetsMs, { routeTotal: route.summary.duration, maxMismatch: MAX_TOTAL_MISMATCH_MS, unit: "ms" });
  if (orderIssue) throw implausible(orderIssue);
  checkPointsOnPath(route.path, pointIndexes, points);
  const offsetsSec = offsetsMs.map((ms) => Math.round(ms / 1000));
  const legsSec = offsetsSec.slice(1).map((sec, index) => sec - (offsetsSec[index] ?? sec));
  return { stopOffsetsSec: offsetsSec.filter((_, index) => points[index]?.kind === "stop"), legsSec };
}

export function toNaverOffsets(res: NaverDirectionsResponse, stops: readonly LatLng[]): number[] {
  return toNaverRouteTimes(res, stops.map((at) => ({ at, kind: "stop" }))).stopOffsetsSec;
}

// WHY: the corridor lies between the first stop and the second, so every later stop is placed past its exit. That
// holds for each bus-lane sequence (campus-inja and campus-jain, two stops each, one on each side of the corridor).
export function toCorridorRoutePoints(stops: readonly LatLng[], ends: CorridorEnds): RoutePoint[] {
  const [first, ...later] = stops;
  if (!first || later.length === 0) throw new Error("a corridor route needs a first stop and a later one");
  const laterStops = later.map((at): RoutePoint => ({ at, kind: "stop" }));
  return [{ at: first, kind: "stop" }, { at: ends.entry, kind: "via" }, { at: ends.exit, kind: "via" }, ...laterStops];
}

export function toCorridorRoute(times: RouteTimes): CorridorRoute {
  const corridorCarSec = times.legsSec[CORRIDOR_LEG_INDEX];
  if (corridorCarSec === undefined) throw new Error(`a corridor route has its corridor as leg ${CORRIDOR_LEG_INDEX}, got ${times.legsSec.length} legs`);
  return { stopOffsetsSec: times.stopOffsetsSec, corridorCarSec };
}
