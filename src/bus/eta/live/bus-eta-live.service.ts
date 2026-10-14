import moment from "moment-timezone";
import { liveDoc } from "../bus-eta.mapper";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { EtaSequence } from "../bus-eta.types";
import { toLiveWork } from "./bus-eta-live.rules";
import type { LiveEtaDeps, LiveTickResult } from "./bus-eta-live.types";

interface TickState {
  now: Date;
  existing: ReadonlyMap<string, ShuttleEtaDoc>;
  out: ShuttleEtaDoc[];
  calls: number;
  succeeded: boolean;
}

/**
 * WHY: `shuttle-eta-live`: NAVER real-time travel times for today's runs, one call per sequence and tick for every
 * run in its window. A tick writes what it got, then rejects with its first error, and keeps rejecting on later
 * ticks until a call succeeds, so the registry reports one outage, not a flapping one; it never logs its own.
 */
export class BusEtaLiveService {
  private failure: unknown = null;

  constructor(private readonly deps: LiveEtaDeps) {}

  async tick(now: Date): Promise<LiveTickResult> {
    const today = moment(now).tz("Asia/Seoul").format("YYYY-MM-DD");
    const serviceIds = [...new Set(this.deps.sequences.map((s) => s.serviceId))];
    const live = (await this.deps.readEtas(serviceIds, [today])).filter((d) => d.kind === "live");
    const state: TickState = { now, existing: new Map(live.map((d) => [d._id, d])), out: [], calls: 0, succeeded: false };
    let firstError: unknown = null;
    for (const sequence of this.deps.sequences) {
      try {
        await this.tickSequence(sequence, today, state);
      } catch (err: unknown) {
        firstError ??= err;
      }
    }
    if (state.out.length > 0) await this.deps.writeEtas(state.out);
    return this.settle(firstError, state);
  }

  private async tickSequence(sequence: EtaSequence, today: string, state: TickState): Promise<void> {
    const work = toLiveWork(await this.deps.runsOn(sequence, today), state.existing, state.now);
    state.out.push(...work.fallback);
    if (work.fix.length === 0 && !work.stale) return;
    this.deps.cap.take(state.now);
    state.calls += 1;
    const offsets = await this.deps.fetchOffsets(sequence.stops);
    state.succeeded = true;
    for (const run of work.fix) state.out.push(liveDoc(run, { offsetsSec: offsets, fetchedAt: state.now, frozenAt: state.now }));
    for (const run of work.inWindow) state.out.push(liveDoc(run, { offsetsSec: offsets, fetchedAt: state.now }));
  }

  private settle(firstError: unknown, state: TickState): LiveTickResult {
    if (firstError !== null) {
      this.failure = firstError;
      throw firstError;
    }
    if (state.succeeded) this.failure = null;
    if (this.failure !== null) throw this.failure;
    return { calls: state.calls, written: state.out.length };
  }
}
