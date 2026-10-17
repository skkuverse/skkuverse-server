import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { RunKey } from "../bus-eta.types";
import type { EtaSource, ServedEstimate } from "./bus-eta-smart.types";

// WHY: a real-time value describes traffic now; past this it no longer does.
const LIVE_MAX_AGE_MS = 15 * 60_000;

const RANK: Record<EtaSource, number> = { frozen: 3, live: 2, predicted: 1 };

export function runKey({ serviceId, routeType, date, time }: RunKey): string {
  return `${serviceId}|${routeType}|${date}|${time}`;
}

function sourceOf(doc: ShuttleEtaDoc, now: Date): EtaSource | null {
  if (doc.expiresAt.getTime() <= now.getTime()) return null;
  if (doc.kind === "baseline") return "predicted";
  if (doc.frozen) return "frozen";
  return now.getTime() - doc.fetchedAt.getTime() <= LIVE_MAX_AGE_MS ? "live" : null;
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
