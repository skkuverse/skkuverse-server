import { BusEtaDirectionsError } from "../bus-eta.error";
import { etaDocId } from "../bus-eta.mapper";
import { liveDoc } from "./bus-eta-live.mapper";
import { orderAndTotalIssue, stopDistanceIssue } from "../bus-eta.rules";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { EtaRun } from "../bus-eta.types";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { GuideMarks, LiveWork, NaverDirectionsGuide, NaverDirectionsResponse, RunPhase } from "./bus-eta-live.types";

const GUIDE_WAYPOINT = 87;
const GUIDE_GOAL = 88;
const MAX_TOTAL_MISMATCH_MS = 30_000;

function implausible(message: string): BusEtaDirectionsError {
  return new BusEtaDirectionsError("naver", "implausible", message);
}

// QUIRK(naver): a waypoint is one `type: 87` guide entry and the goal the `type: 88` one, so the running sum of
// durations up to each is that stop's travel time; probed on 2026-10-09, the durations sum to the route total.
function toGuideMarks(guide: readonly NaverDirectionsGuide[]): GuideMarks {
  const marks: GuideMarks = { offsetsMs: [0], pointIndexes: [0], waypoints: 0, goals: 0 };
  let running = 0;
  for (const entry of guide) {
    running += entry.duration;
    if (entry.type !== GUIDE_WAYPOINT && entry.type !== GUIDE_GOAL) continue;
    if (entry.type === GUIDE_WAYPOINT) marks.waypoints += 1;
    else marks.goals += 1;
    marks.offsetsMs.push(running);
    marks.pointIndexes.push(entry.pointIndex);
  }
  return marks;
}

function checkStopsOnPath(path: ReadonlyArray<[number, number]>, pointIndexes: readonly number[], stops: readonly LatLng[]): void {
  stops.forEach((stop, index) => {
    const pointIndex = pointIndexes[index];
    const point = pointIndex === undefined ? undefined : path[pointIndex];
    if (!point) throw implausible(`stop ${index} points past the end of the path (index ${pointIndex})`);
    const issue = stopDistanceIssue(stop, { lat: point[1], lng: point[0] }, index);
    if (issue) throw implausible(issue);
  });
}

/** WHY: throws a BusEtaDirectionsError for a failed or implausible route, which is rejected, never stored. */
export function toNaverOffsets(res: NaverDirectionsResponse, stops: readonly LatLng[]): number[] {
  if (res.code !== 0) throw new BusEtaDirectionsError("naver", "api", `code ${res.code} (${res.message})`);
  const route = res.route?.traoptimal?.[0];
  if (!route) throw implausible("no traoptimal route in the response");
  const { offsetsMs, pointIndexes, waypoints, goals } = toGuideMarks(route.guide);
  if (waypoints !== stops.length - 2 || goals !== 1) {
    throw implausible(`expected ${stops.length - 2} waypoint (87) and 1 goal (88) guide entries, got ${waypoints} and ${goals}`);
  }
  const orderIssue = orderAndTotalIssue(offsetsMs, { routeTotal: route.summary.duration, maxMismatch: MAX_TOTAL_MISMATCH_MS, unit: "ms" });
  if (orderIssue) throw implausible(orderIssue);
  checkStopsOnPath(route.path, pointIndexes, stops);
  return offsetsMs.map((ms) => Math.round(ms / 1000));
}

const WINDOW_MS = 60 * 60_000;
const REFRESH_AFTER_MS = 9.5 * 60_000;
const FIX_GRACE_MS = 10 * 60_000;
const FALLBACK_MAX_AGE_MS = 15 * 60_000;

// WHY: a run unfixed 10 minutes after departure is fixed with its last live value only if that was fetched within
// 15 minutes before departure; otherwise it is never fixed.
function fallbackDoc(run: EtaRun, doc: ShuttleEtaDoc | undefined, now: Date): ShuttleEtaDoc | null {
  const departAt = run.departAt.getTime();
  const fetched = doc?.fetchedAt.getTime() ?? Number.NEGATIVE_INFINITY;
  if (!doc || fetched > departAt || fetched < departAt - FALLBACK_MAX_AGE_MS) return null;
  return liveDoc(run, { offsetsSec: doc.offsetsSec, fetchedAt: doc.fetchedAt, frozenAt: now });
}

function phaseOf(run: EtaRun, doc: ShuttleEtaDoc | undefined, nowMs: number): RunPhase {
  const departAt = run.departAt.getTime();
  if (doc?.frozen || nowMs < departAt - WINDOW_MS) return "idle";
  if (nowMs >= departAt + FIX_GRACE_MS) return "late";
  return nowMs >= departAt ? "departed" : "window";
}

/**
 * WHY: what one tick does for a sequence's runs today: a run in its first 10 minutes after departure is fixed by a
 * fresh call; one in its window (60 minutes before departure) is refreshed when any such run has no live value
 * or one at least 9.5 minutes old; a fixed run is never touched again.
 */
export function toLiveWork(runs: readonly EtaRun[], existing: ReadonlyMap<string, ShuttleEtaDoc>, now: Date): LiveWork {
  const work: LiveWork = { fix: [], inWindow: [], fallback: [], stale: false };
  const nowMs = now.getTime();
  for (const run of runs) {
    const doc = existing.get(etaDocId(run, "live"));
    const phase = phaseOf(run, doc, nowMs);
    const fixed = phase === "late" ? fallbackDoc(run, doc, now) : null;
    if (fixed) work.fallback.push(fixed);
    if (phase === "departed") work.fix.push(run);
    if (phase === "window") {
      work.inWindow.push(run);
      work.stale ||= !doc || nowMs - doc.fetchedAt.getTime() >= REFRESH_AFTER_MS;
    }
  }
  return work;
}
