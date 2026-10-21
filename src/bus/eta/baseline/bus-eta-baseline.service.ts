import { etaDocId } from "../bus-eta.mapper";
import { baselineDoc, baselineDocFromFixed } from "./bus-eta-baseline.mapper";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { refreshCutoff } from "./bus-eta-baseline.rules";
import type { BaselineEtaDeps, BaselineTickResult, SequencedRun } from "./bus-eta-baseline.types";

const SPACING_MS = 250;
const BACKOFF_MS = 30 * 60_000;

interface TickState {
  out: ShuttleEtaDoc[];
  calls: number;
  succeeded: boolean;
  firstError: unknown;
}

/**
 * WHY: `shuttle-eta-baseline`: a prediction for every run the smart view shows from now on outside a suspension, when
 * missing, expired or older than the latest 04:00 KST; a bus-lane run reuses a fixed value, others are TMAP calls 250 ms
 * apart, a failed one waiting 30 minutes so one bad run cannot use up the day's calls. Failures report as the live one's.
 */
export class BusEtaBaselineService {
  private failure: unknown = null;
  // WHY: etaDocId → when the run may be tried again.
  private readonly retryAt = new Map<string, number>();

  constructor(private readonly deps: BaselineEtaDeps) {}

  async tick(now: Date): Promise<BaselineTickResult> {
    const runs: SequencedRun[] = [];
    for (const sequence of await this.deps.sequences()) {
      for (const run of await this.deps.upcomingRuns(sequence, now)) runs.push({ sequence, run });
    }
    const state: TickState = { out: [], calls: 0, succeeded: false, firstError: null };
    for (const item of await this.reuseFixed(await this.dueRuns(runs, now), now, state)) {
      if (!(await this.fetchOne(item, now, state))) break;
    }
    if (state.out.length > 0) await this.deps.writeEtas(state.out);
    return this.settle(state);
  }

  private async dueRuns(runs: SequencedRun[], now: Date): Promise<SequencedRun[]> {
    if (runs.length === 0) return [];
    const serviceIds = [...new Set(runs.map((r) => r.run.serviceId))];
    const dates = [...new Set(runs.map((r) => r.run.date))];
    const baselines = (await this.deps.readEtas(serviceIds, dates)).filter((d) => d.kind === "baseline");
    const existing = new Map(baselines.map((d) => [d._id, d]));
    const nowMs = now.getTime();
    const cutoff = refreshCutoff(now).getTime();
    return runs.filter(({ run }) => {
      const id = etaDocId(run, "baseline");
      const doc = existing.get(id);
      if (doc && doc.fetchedAt.getTime() >= cutoff && doc.expiresAt.getTime() > nowMs) return false;
      return (this.retryAt.get(id) ?? 0) <= nowMs;
    });
  }

  // WHY: a bus-lane run with a fixed value to reuse is written from it, before any TMAP call can spend the cap; the
  // runs left need TMAP.
  private async reuseFixed(due: SequencedRun[], now: Date, state: TickState): Promise<SequencedRun[]> {
    if (due.length === 0) return [];
    const fixedByRun = await this.deps.forecast.reusableFixedByRun(due.map((item) => item.run), now);
    return due.filter(({ run }) => {
      const fixed = fixedByRun.get(etaDocId(run, "baseline"));
      if (fixed) state.out.push(baselineDocFromFixed(run, fixed, now));
      return !fixed;
    });
  }

  // WHY: false once the day's cap is spent, which ends the tick.
  private async fetchOne({ sequence, run }: SequencedRun, now: Date, state: TickState): Promise<boolean> {
    const id = etaDocId(run, "baseline");
    try {
      this.deps.cap.take(now);
    } catch (err: unknown) {
      state.firstError ??= err;
      return false;
    }
    if (state.calls > 0) await this.deps.sleep(SPACING_MS);
    state.calls += 1;
    try {
      state.out.push(baselineDoc(run, await this.deps.forecast.fetchOffsets(sequence.stops, run.departAt), now));
      this.retryAt.delete(id);
      state.succeeded = true;
    } catch (err: unknown) {
      this.retryAt.set(id, now.getTime() + BACKOFF_MS);
      state.firstError ??= err;
    }
    return true;
  }

  private settle(state: TickState): BaselineTickResult {
    if (state.firstError !== null) {
      this.failure = state.firstError;
      throw state.firstError;
    }
    if (state.succeeded) this.failure = null;
    if (this.failure !== null) throw this.failure;
    return { calls: state.calls, written: state.out.length };
  }
}
