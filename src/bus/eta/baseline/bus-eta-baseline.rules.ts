import moment from "moment-timezone";
import { DirectionsError } from "../../../shared/directions.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import { KST_TIME_ZONE } from "../../bus.constants";
import { orderAndTotalIssue, stopDistanceIssue } from "../bus-eta.rules";
import type { FeatureMarks, TmapFeature, TmapPredictionResponse } from "./bus-eta-baseline.types";

const REFRESH_HOUR = 4;

const MAX_TOTAL_MISMATCH_S = 30;

function implausible(message: string): DirectionsError {
  return new DirectionsError("tmap", "implausible", message);
}

// QUIRK(tmap): each LineString carries its segment's `time`; a waypoint is a B1, B2… Point and the goal the E
// Point. After E, TMAP echoes every waypoint without `index`, so reading stops at E.
function toFeatureMarks(features: TmapFeature[], start: [number, number]): FeatureMarks {
  const result: FeatureMarks = { offsets: [0], marks: [start], waypoints: 0, ended: false };
  let running = 0;
  for (const feature of features) {
    const props = feature.properties;
    if (feature.geometry.type === "LineString") {
      running += props.time ?? 0;
      continue;
    }
    if (props.pointType === "E") result.ended = true;
    else if (props.pointType === `B${result.waypoints + 1}`) result.waypoints += 1;
    else continue;
    result.offsets.push(running);
    result.marks.push(feature.geometry.coordinates);
    if (result.ended) break;
  }
  return result;
}

function checkStopsAtMarks(marks: ReadonlyArray<[number, number]>, stops: readonly LatLng[]): void {
  stops.forEach((stop, index) => {
    const mark = marks[index];
    if (!mark) throw implausible(`stop ${index} has no point in the route`);
    const issue = stopDistanceIssue(stop, { lat: mark[1], lng: mark[0] }, index);
    if (issue) throw implausible(issue);
  });
}

// QUIRK(tmap): a route opens with its start (S) Point, which carries the route's total time.
function routeStart(features: TmapFeature[] | undefined): { features: TmapFeature[]; start: TmapFeature; totalTime: number } {
  const start = features?.[0];
  const totalTime = start?.properties.pointType === "S" ? start.properties.totalTime : undefined;
  if (!features || !start || typeof totalTime !== "number") throw new DirectionsError("tmap", "api", "no route in the response");
  return { features, start, totalTime };
}

/** WHY: throws a DirectionsError for a failed or implausible route, which is rejected, never stored. */
export function toTmapOffsets(res: TmapPredictionResponse, stops: readonly LatLng[]): number[] {
  const { features, start, totalTime } = routeStart(res.features);
  const { offsets, marks, waypoints, ended } = toFeatureMarks(features, start.geometry.coordinates as [number, number]);
  if (waypoints !== stops.length - 2 || !ended) {
    throw implausible(`expected ${stops.length - 2} waypoint (B1…) and 1 end (E) points, got ${waypoints} and ${ended ? 1 : 0}`);
  }
  const orderIssue = orderAndTotalIssue(offsets, { routeTotal: totalTime, maxMismatch: MAX_TOTAL_MISMATCH_S, unit: "s" });
  if (orderIssue) throw implausible(orderIssue);
  checkStopsAtMarks(marks, stops);
  return offsets.map((seconds) => Math.round(seconds));
}

/** WHY: the latest 04:00 KST at or before `now`: baselines fetched earlier are refreshed. */
export function refreshCutoff(now: Date): Date {
  const local = moment(now).tz(KST_TIME_ZONE);
  const cutoff = local.clone().startOf("day").hour(REFRESH_HOUR);
  if (cutoff.isAfter(local)) cutoff.subtract(1, "day");
  return cutoff.toDate();
}
