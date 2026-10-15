import { etaDocId } from "../bus-eta.mapper";
import { baselineDoc } from "./bus-eta-baseline.mapper";
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
 * WHY: `shuttle-eta-baseline`: a TMAP forecast for every run the smart view shows from now on. A run is fetched when
 * its baseline is missing, expired or older than the latest 04:00 KST; calls are 250 ms apart, and a run whose
 * call failed waits 30 minutes, so one bad run cannot use up the day's calls. Failures report as the live one's.
 */
export class BusEtaBaselineService {
  private failure: unknown = null;
  // WHY: etaDocId → when the run may be tried again.
  private readonly retryAt = new Map<string, number>();

  constructor(private readonly deps: BaselineEtaDeps) {}

  async tick(now: Date): Promise<BaselineTickResult> {
    const runs: SequencedRun[] = [];
    for (const sequence of this.deps.sequences) {
      for (const run of await this.deps.upcomingRuns(sequence, now)) runs.push({ sequence, run });
    }
    const due = await this.dueRuns(runs, now);
    const state: TickState = { out: [], calls: 0, succeeded: false, firstError: null };
    for (const item of due) {
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
      state.out.push(baselineDoc(run, await this.deps.fetchOffsets(sequence.stops, run.departAt), now));
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
