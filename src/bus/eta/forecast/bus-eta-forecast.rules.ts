import moment from "moment-timezone";
import { BusEtaDirectionsError } from "../bus-eta.error";
import { etaDocId } from "../bus-eta.mapper";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { FixedEstimate } from "../bus-eta.document";
import { orderAndTotalIssue, stopDistanceIssue } from "../bus-eta.rules";
import type { EtaRun } from "../bus-eta.types";
import type { FeatureMarks, TmapFeature, TmapPredictionResponse } from "./bus-eta-forecast.types";

const MAX_TOTAL_MISMATCH_S = 30;

function implausible(message: string): BusEtaDirectionsError {
  return new BusEtaDirectionsError("tmap", "implausible", message);
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
  if (!features || !start || typeof totalTime !== "number") throw new BusEtaDirectionsError("tmap", "api", "no route in the response");
  return { features, start, totalTime };
}

/** WHY: throws a BusEtaDirectionsError for a failed or implausible route, which is rejected, never stored. */
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

const WEEK_DAYS = 7;
const DATE_FORMAT = "YYYY-MM-DD";

/**
 * WHY: a fixed value lives `LIVE_LIFE_MS` (8 days) after its run, so two dates of one weekday cover every one still
 * stored: the latest on or before today and before the run, and the week before it.
 */
export function reusableFixedDates(runDate: string, today: string): string[] {
  const run = moment.utc(runDate, DATE_FORMAT, true);
  const latest = moment.min(moment.utc(today, DATE_FORMAT, true), run.clone().subtract(1, "day"));
  const weeksBack = Math.ceil(run.diff(latest, "days") / WEEK_DAYS);
  const first = run.clone().subtract(weeksBack * WEEK_DAYS, "days");
  return [first, first.clone().subtract(WEEK_DAYS, "days")].map((date) => date.format(DATE_FORMAT));
}

/** WHY: by the run's prediction id, the latest fixed value of the same service, route type, weekday and departure time. */
export function toReusableFixedByRun(runs: readonly EtaRun[], fixed: readonly FixedEstimate[], today: string): Map<string, FixedEstimate> {
  const byRun = new Map<string, FixedEstimate>();
  for (const run of runs) {
    const dates = reusableFixedDates(run.date, today);
    const latest = fixed
      .filter((f) => f.serviceId === run.serviceId && f.routeType === run.routeType && f.time === run.time && dates.includes(f.date))
      .reduce<FixedEstimate | undefined>((best, f) => (!best || f.date > best.date ? f : best), undefined);
    if (latest) byRun.set(etaDocId(run, "baseline"), latest);
  }
  return byRun;
}
