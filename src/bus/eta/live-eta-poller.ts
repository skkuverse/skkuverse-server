/**
 * `shuttle-eta-live` (design D10): NAVER real-time travel times for today's
 * runs, ticking every 60 s.
 *
 * Per opted-in sequence and tick:
 * - **Refresh:** a run is in its window from 60 minutes before departure. If
 *   any unfixed run in the window has no live value, or one at least 9.5
 *   minutes old, one call is made and its result written for every run in the
 *   window — the runs share every input.
 * - **Fix:** a run whose departure has passed, in its first 10 minutes, is
 *   fixed by a fresh call: the moment the bus enters the traffic it reports.
 * - **Fallback:** a run still unfixed 10 minutes after departure is fixed with
 *   its last live value, if that value was fetched within 15 minutes before
 *   departure. Otherwise it is never fixed.
 * A fixed value never changes (`writeEtas` skips frozen documents).
 *
 * A tick writes what it got, then rejects with its first error, and keeps
 * rejecting on later ticks until a call succeeds, so the registry reports one
 * outage, not a flapping one. It never logs its own failures (CLAUDE.md).
 */
import moment from "moment-timezone";
import type { LatLng } from "../types";
import type { DailyCap } from "./daily-cap";
import type { EtaRun } from "./eta-runs";
import type { EtaSequence } from "./eta-sequences";
import { etaDocId, liveDoc, type ShuttleEtaDoc } from "./eta-store";

const WINDOW_MS = 60 * 60_000;
const REFRESH_AFTER_MS = 9.5 * 60_000;
const FIX_GRACE_MS = 10 * 60_000;
const FALLBACK_MAX_AGE_MS = 15 * 60_000;

export interface LiveEtaDeps {
  sequences: readonly EtaSequence[];
  /** Today's runs of a sequence, from the resolved timetable. */
  runsOn(sequence: EtaSequence, date: string): Promise<EtaRun[]>;
  /** One NAVER call: seconds from the first stop to each stop. */
  fetchOffsets(stops: readonly LatLng[]): Promise<number[]>;
  readEtas(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]>;
  writeEtas(docs: ShuttleEtaDoc[]): Promise<unknown>;
  cap: DailyCap;
}

export interface LiveTickResult {
  calls: number;
  written: number;
}

export class LiveEtaPoller {
  private failure: unknown = null;

  constructor(private readonly deps: LiveEtaDeps) {}

  async tick(now: Date = new Date()): Promise<LiveTickResult> {
    const { sequences, runsOn, fetchOffsets, readEtas, writeEtas, cap } = this.deps;
    const today = moment(now).tz("Asia/Seoul").format("YYYY-MM-DD");
    const n = now.getTime();
    const existing = new Map(
      (await readEtas([...new Set(sequences.map((s) => s.serviceId))], [today]))
        .filter((d) => d.kind === "live")
        .map((d) => [d._id, d]),
    );

    const out: ShuttleEtaDoc[] = [];
    let calls = 0;
    let succeeded = false;
    let firstError: unknown = null;
    for (const sequence of sequences) {
      try {
        const fix: EtaRun[] = [];
        const inWindow: EtaRun[] = [];
        let stale = false;
        for (const run of await runsOn(sequence, today)) {
          const doc = existing.get(etaDocId(run, "live"));
          if (doc?.frozen) continue;
          const t = run.departAt.getTime();
          if (n >= t + FIX_GRACE_MS) {
            const fetched = doc?.fetchedAt.getTime() ?? Number.NEGATIVE_INFINITY;
            if (doc && fetched <= t && fetched >= t - FALLBACK_MAX_AGE_MS) {
              out.push(liveDoc(run, doc.offsetsSec, doc.fetchedAt, now));
            }
          } else if (n >= t) {
            fix.push(run);
          } else if (n >= t - WINDOW_MS) {
            inWindow.push(run);
            if (!doc || n - doc.fetchedAt.getTime() >= REFRESH_AFTER_MS) stale = true;
          }
        }
        if (fix.length === 0 && !stale) continue;

        cap.take(now);
        calls += 1;
        const offsets = await fetchOffsets(sequence.stops);
        succeeded = true;
        for (const run of fix) out.push(liveDoc(run, offsets, now, now));
        for (const run of inWindow) out.push(liveDoc(run, offsets, now));
      } catch (err: unknown) {
        firstError ??= err;
      }
    }

    if (out.length > 0) await writeEtas(out);
    if (firstError !== null) {
      this.failure = firstError;
      throw firstError;
    }
    if (succeeded) this.failure = null;
    if (this.failure !== null) throw this.failure;
    return { calls, written: out.length };
  }
}
