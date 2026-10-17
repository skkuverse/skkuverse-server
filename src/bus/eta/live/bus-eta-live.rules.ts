import { etaDocId } from "../bus-eta.mapper";
import { liveDoc } from "./bus-eta-live.mapper";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { EtaRun } from "../bus-eta.types";
import type { SequenceStrategy } from "../lane/bus-eta-lane.types";
import type { CorridorRoute } from "../travel/bus-eta-travel.types";
import type { LiveWork, ModelGroup, RunPhase } from "./bus-eta-live.types";

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
  return liveDoc(run, { offsetsSec: doc.offsetsSec, fetchedAt: doc.fetchedAt, frozenAt: now, travel: doc.travel });
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

const PRIME_LEAD_MS = 10 * 60_000;
const TICK_MS = 60_000;

// WHY: the probe pairs each snapshot with one about ten minutes older, so a snapshot ten minutes before the window
// opens gives its first call a partner; the poller ticks every minute, so this one-minute slot primes once.
export function isPrimeMinute(run: EtaRun, now: Date): boolean {
  const primeAt = run.departAt.getTime() - WINDOW_MS - PRIME_LEAD_MS;
  return now.getTime() >= primeAt && now.getTime() < primeAt + TICK_MS;
}

const groupKeyOf = (strategy: SequenceStrategy): string => (strategy.strategy === "busLane" ? strategy.direction : "car");

/** WHY: one directions call per travel model and direction serves every due run of a sequence that uses it. */
export function toModelGroups(work: Pick<LiveWork, "fix" | "inWindow">, strategyOf: (run: EtaRun) => SequenceStrategy): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  const add = (run: EtaRun, phase: "fix" | "inWindow") => {
    const strategy = strategyOf(run);
    const group = groups.get(groupKeyOf(strategy)) ?? { strategy, fix: [], inWindow: [] };
    group[phase].push(run);
    groups.set(groupKeyOf(strategy), group);
  };
  work.fix.forEach((run) => add(run, "fix"));
  work.inWindow.forEach((run) => add(run, "inWindow"));
  return [...groups.values()];
}

// WHY: every stop after the first lies past the corridor exit (toCorridorRoutePoints), so each takes the difference.
export function toBusLaneOffsets(route: CorridorRoute, corridorSec: number): number[] {
  const deltaSec = corridorSec - route.corridorCarSec;
  return route.stopOffsetsSec.map((sec, index) => (index === 0 ? sec : Math.round(sec + deltaSec)));
}
