/**
 * `shuttle-eta-baseline` (design D10): a TMAP 타임머신 forecast for every run
 * the smart view shows from now on, ticking every 5 minutes.
 *
 * A run is fetched when its baseline is missing, expired, or was fetched
 * before the latest 04:00 KST, so each run gets one fresh forecast a day and a
 * restart refetches nothing. Calls are 250 ms apart. A run whose call failed
 * waits 30 minutes before its next try, so one bad run cannot use up the day's
 * calls. A baseline lives 24 hours from its fetch (TMAP's terms).
 *
 * Like the live poller, a tick writes what it got, rejects with its first
 * error, and keeps rejecting until a call succeeds.
 */
import moment from "moment-timezone";
import type { LatLng } from "../types";
import type { DailyCap } from "./daily-cap";
import type { EtaRun } from "./eta-runs";
import type { EtaSequence } from "./eta-sequences";
import { baselineDoc, etaDocId, type ShuttleEtaDoc } from "./eta-store";

const TZ = "Asia/Seoul";
const SPACING_MS = 250;
const BACKOFF_MS = 30 * 60_000;
const REFRESH_HOUR = 4;

export interface BaselineEtaDeps {
  sequences: readonly EtaSequence[];
  /** The runs of a sequence the smart view shows that have not departed by `now`. */
  upcomingRuns(sequence: EtaSequence, now: Date): Promise<EtaRun[]>;
  /** One TMAP call: seconds from the first stop to each stop, leaving at `departAt`. */
  fetchOffsets(stops: readonly LatLng[], departAt: Date): Promise<number[]>;
  readEtas(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]>;
  writeEtas(docs: ShuttleEtaDoc[]): Promise<unknown>;
  cap: DailyCap;
  sleep(ms: number): Promise<void>;
}

export interface BaselineTickResult {
  calls: number;
  written: number;
}

/** The latest 04:00 KST at or before `now`: baselines fetched earlier are refreshed. */
export function refreshCutoff(now: Date): Date {
  const local = moment(now).tz(TZ);
  const cutoff = local.clone().startOf("day").hour(REFRESH_HOUR);
  if (cutoff.isAfter(local)) cutoff.subtract(1, "day");
  return cutoff.toDate();
}

export class BaselineEtaPoller {
  private failure: unknown = null;
  // etaDocId → when the run may be tried again
  private readonly retryAt = new Map<string, number>();

  constructor(private readonly deps: BaselineEtaDeps) {}

  async tick(now: Date = new Date()): Promise<BaselineTickResult> {
    const { sequences, upcomingRuns, fetchOffsets, readEtas, writeEtas, cap, sleep } = this.deps;
    const n = now.getTime();
    const cutoff = refreshCutoff(now).getTime();

    const runs: Array<{ sequence: EtaSequence; run: EtaRun }> = [];
    for (const sequence of sequences) {
      for (const run of await upcomingRuns(sequence, now)) runs.push({ sequence, run });
    }
    const existing = new Map(
      runs.length === 0
        ? []
        : (
            await readEtas(
              [...new Set(runs.map((r) => r.run.serviceId))],
              [...new Set(runs.map((r) => r.run.date))],
            )
          )
            .filter((d) => d.kind === "baseline")
            .map((d) => [d._id, d]),
    );
    const due = runs.filter(({ run }) => {
      const id = etaDocId(run, "baseline");
      const doc = existing.get(id);
      if (doc && doc.fetchedAt.getTime() >= cutoff && doc.expiresAt.getTime() > n) return false;
      return (this.retryAt.get(id) ?? 0) <= n;
    });

    const out: ShuttleEtaDoc[] = [];
    let calls = 0;
    let succeeded = false;
    let firstError: unknown = null;
    for (const { sequence, run } of due) {
      const id = etaDocId(run, "baseline");
      try {
        cap.take(now);
      } catch (err: unknown) {
        firstError ??= err;
        break;
      }
      if (calls > 0) await sleep(SPACING_MS);
      calls += 1;
      try {
        out.push(baselineDoc(run, await fetchOffsets(sequence.stops, run.departAt), now));
        this.retryAt.delete(id);
        succeeded = true;
      } catch (err: unknown) {
        this.retryAt.set(id, n + BACKOFF_MS);
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
