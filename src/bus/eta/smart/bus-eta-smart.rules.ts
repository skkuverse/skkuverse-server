import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { RunKey } from "../bus-eta.types";
import type { EtaSource, ServedEstimate, ShuttleRun } from "./bus-eta-smart.types";

// WHY: a real-time value describes traffic now; past this it no longer does.
const LIVE_MAX_AGE_MS = 15 * 60_000;

const RANK: Record<EtaSource, number> = { frozen: 3, live: 2, predicted: 1 };

export function runKey({ serviceId, routeType, date, time }: RunKey): string {
  return `${serviceId}|${routeType}|${date}|${time}`;
}

const isExpired = (doc: ShuttleEtaDoc, now: Date): boolean => doc.expiresAt.getTime() <= now.getTime();

const kindSourceOf = (doc: ShuttleEtaDoc): EtaSource => {
  if (doc.kind === "baseline") return "predicted";
  return doc.frozen ? "frozen" : "live";
};

function sourceOf(doc: ShuttleEtaDoc, now: Date): EtaSource | null {
  if (isExpired(doc, now)) return null;
  const source = kindSourceOf(doc);
  return source !== "live" || now.getTime() - doc.fetchedAt.getTime() <= LIVE_MAX_AGE_MS ? source : null;
}

/** WHY: the best estimate per run: the fixed value, then a live value at most 15 minutes old, then an unexpired prediction. */
export function pickEstimates(docs: readonly ShuttleEtaDoc[], now: Date): Map<string, ServedEstimate> {
  const best = new Map<string, ServedEstimate>();
  for (const doc of docs) {
    const source = sourceOf(doc, now);
    if (!source) continue;
    const key = runKey(doc);
    const current = best.get(key);
    if (!current || RANK[source] > RANK[current.source]) {
      best.set(key, { offsetsSec: doc.offsetsSec, source, updatedAt: doc.fetchedAt });
    }
  }
  return best;
}

/**
 * WHY: a router's offsets run nonstop from departure, but a bus waits at a scheduled stop until its timetable time;
 * reaching one early moves it and every later stop to that time, reaching it late keeps the delay.
 */
export function floorAtScheduledStops(offsetsSec: readonly number[], scheduledOffsetsSec: ReadonlyArray<number | null>): number[] {
  let waitSec = 0;
  return offsetsSec.map((offset, index) => {
    const scheduled = scheduledOffsetsSec[index];
    if (index > 0 && scheduled !== null && scheduled !== undefined) waitSec = Math.max(waitSec, scheduled - offset);
    return offset + waitSec;
  });
}

/**
 * WHY: the stop page's listing cutoff only, never served as a time: per run, the newest fetch among its unexpired
 * documents of any kind, a live value too old to serve included (ADR 0019, D12).
 */
export function pickLatestEstimates(docs: readonly ShuttleEtaDoc[], now: Date): Map<string, ServedEstimate> {
  const latest = new Map<string, ServedEstimate>();
  for (const doc of docs) {
    if (isExpired(doc, now)) continue;
    const key = runKey(doc);
    const current = latest.get(key);
    if (!current || doc.fetchedAt.getTime() > current.updatedAt.getTime()) {
      latest.set(key, { offsetsSec: doc.offsetsSec, source: kindSourceOf(doc), updatedAt: doc.fetchedAt });
    }
  }
  return latest;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** WHY: a timetable time is KST wall-clock time on its date, whatever the server's zone. */
export function toTimetableAt(date: string, time: string): Date {
  return moment.tz(`${date} ${time}`, "YYYY-MM-DD HH:mm", KST_TIME_ZONE).toDate();
}

/** WHY: the timetable stores a run's stop times as "HH:mm" on its departure's date, so one before the departure is the next day's. */
export function toStopAt(departureAt: Date, date: string, time: string): Date {
  const at = toTimetableAt(date, time);
  return at < departureAt ? new Date(at.getTime() + DAY_MS) : at;
}

/** WHY: a run still counts in its own minute, as the timetable gives minutes, until the last instant it has passes (ADR 0019, D12). */
export function isUnderWayAt({ departureAt, stopTimes }: Pick<ShuttleRun, "departureAt" | "stopTimes">, from: Date): boolean {
  const instants = [departureAt, ...stopTimes.flatMap(({ shownAt, latestEstimateAt }) => [shownAt, latestEstimateAt])].flatMap((at) => (at ? [at.getTime()] : []));
  return Math.max(...instants) >= Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS;
}
