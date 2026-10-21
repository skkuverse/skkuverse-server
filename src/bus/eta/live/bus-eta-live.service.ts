import type { LatLng } from "../../../shared/lat-lng.types";
import { toKstDate } from "../../../shared/kst-date.util";
import { liveDoc } from "./bus-eta-live.mapper";
import type { EtaTravel, ShuttleEtaDoc } from "../bus-eta.document";
import { BusEtaLaneUnavailableError } from "../bus-eta.error";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import type { LaneCorridorSnapshot, LaneDirection } from "../lane/bus-eta-lane.types";
import type { LegTime } from "../probe/bus-eta-probe.types";
import { isPrimeMinute, toBusLaneOffsets, toLiveWork, toModelGroups } from "./bus-eta-live.rules";
import type { LiveEtaDeps, LiveTickResult, LiveUpstream, ModelGroup } from "./bus-eta-live.types";

interface TickState {
  now: Date;
  existing: ReadonlyMap<string, ShuttleEtaDoc>;
  out: ShuttleEtaDoc[];
  calls: number;
  succeeded: Set<LiveUpstream>;
  failed: Map<LiveUpstream, unknown>;
  firstError: unknown;
  needsPrime: boolean;
  corridor: Promise<LaneCorridorSnapshot | null> | null;
}

interface DueGroup extends ModelGroup {
  stops: readonly LatLng[];
}

/**
 * WHY: `shuttle-eta-live`: NAVER real-time travel times for today's runs, one call per sequence, travel model and
 * tick for every run in its window. A tick writes what it got, then rejects with its first error, and keeps rejecting
 * until a request to what failed (NAVER, TOPIS, the day's runs) succeeds, so the registry reports one outage; no log.
 */
export class BusEtaLiveService {
  private readonly failures = new Map<LiveUpstream, unknown>();

  constructor(private readonly deps: LiveEtaDeps) {}

  async tick(now: Date): Promise<LiveTickResult> {
    const sequences = await this.deps.sequences();
    const today = toKstDate(now);
    const serviceIds = [...new Set(sequences.map((s) => s.serviceId))];
    const live = (await this.deps.readEtas(serviceIds, [today])).filter((d) => d.kind === "live");
    const state: TickState = { now, existing: new Map(live.map((d) => [d._id, d])), out: [], calls: 0, succeeded: new Set(), failed: new Map(), firstError: null, needsPrime: false, corridor: null };
    for (const sequence of sequences) {
      const runs = await this.runsOn(sequence, today, state);
      if (runs) await this.tickSequence(sequence, runs, state).catch((err: unknown) => this.hold(state, "naver", err));
    }
    if (state.needsPrime) await this.prime(state);
    // WHY: a held corridor failure is retried each tick, or a push waits for the next bus-lane run, up to about 60 h.
    if (this.failures.has("corridor")) await this.corridorOf(state);
    if (state.out.length > 0) await this.deps.writeEtas(state.out);
    return this.settle(state);
  }

  private async runsOn(sequence: EtaSequence, today: string, state: TickState): Promise<EtaRun[] | null> {
    try {
      const runs = await this.deps.runsOn(sequence, today);
      state.succeeded.add("schedule");
      return runs;
    } catch (err: unknown) {
      this.hold(state, "schedule", err);
      return null;
    }
  }

  private async tickSequence(sequence: EtaSequence, runs: readonly EtaRun[], state: TickState): Promise<void> {
    state.needsPrime ||= runs.some((run) => isPrimeMinute(run, state.now) && this.deps.travel.strategyOfRun(run).strategy === "busLane");
    const work = toLiveWork(runs, state.existing, state.now);
    state.out.push(...work.fallback);
    if (work.fix.length === 0 && !work.stale) return;
    for (const group of toModelGroups(work, (run) => this.deps.travel.strategyOfRun(run))) {
      const due = { ...group, stops: sequence.stops };
      const fetched = group.strategy.strategy === "busLane" ? this.fetchBusLane(due, group.strategy.direction, state) : this.fetchCar(due, state);
      await fetched.catch((err: unknown) => this.hold(state, "naver", err));
    }
  }

  private async fetchCar(due: DueGroup, state: TickState, travel?: EtaTravel): Promise<void> {
    this.takeCall(state);
    const offsetsSec = await this.deps.travel.fetchOffsets(due.stops);
    state.succeeded.add("naver");
    this.pushDocs(due, { offsetsSec, travel }, state);
  }

  // WHY: a forced route that fails is held like a car call's failure, with no car call after it: NAVER is what failed.
  private async fetchBusLane(due: DueGroup, direction: LaneDirection, state: TickState): Promise<void> {
    const corridor = await this.corridorOf(state);
    if (corridor === null) return this.fetchCar(due, state, { model: "car" });
    this.takeCall(state);
    const route = await this.deps.travel.fetchCorridorRoute(due.stops, corridor, direction);
    state.succeeded.add("naver");
    const leg = await this.legTime(corridor, direction, state);
    if (leg?.kind !== "probe") return this.fetchCar(due, state, { model: "car" });
    const travel: EtaTravel = { model: "busLane", corridorCarSec: route.corridorCarSec, corridorSec: leg.corridorSec, spanCount: leg.spanCount, coverage: leg.coverage };
    this.pushDocs(due, { offsetsSec: toBusLaneOffsets(route, leg.corridorSec), travel }, state);
  }

  // WHY: read at most once per tick, when a bus-lane run is due or a corridor failure is held; none read rejects the tick.
  private corridorOf(state: TickState): Promise<LaneCorridorSnapshot | null> {
    state.corridor ??= this.deps.travel.corridor().then((corridor) => {
      if (corridor === null) this.hold(state, "corridor", new BusEtaLaneUnavailableError());
      else state.succeeded.add("corridor");
      return corridor;
    });
    return state.corridor;
  }

  private async legTime(corridor: LaneCorridorSnapshot, direction: LaneDirection, state: TickState): Promise<LegTime | null> {
    try {
      const leg = await this.deps.travel.legTime(corridor, direction, state.now);
      state.succeeded.add("topis");
      return leg;
    } catch (err: unknown) {
      this.hold(state, "topis", err);
      return null;
    }
  }

  private async prime(state: TickState): Promise<void> {
    const corridor = await this.corridorOf(state);
    if (corridor === null) return;
    try {
      await this.deps.travel.prime(corridor, state.now);
      state.succeeded.add("topis");
    } catch (err: unknown) {
      this.hold(state, "topis", err);
    }
  }

  private takeCall(state: TickState): void {
    this.deps.cap.take(state.now);
    state.calls += 1;
  }

  private pushDocs(group: ModelGroup, value: { offsetsSec: number[]; travel?: EtaTravel }, state: TickState): void {
    const fetchedAt = state.now;
    for (const run of group.fix) state.out.push(liveDoc(run, { ...value, fetchedAt, frozenAt: fetchedAt }));
    for (const run of group.inWindow) state.out.push(liveDoc(run, { ...value, fetchedAt }));
  }

  private hold(state: TickState, upstream: LiveUpstream, err: unknown): void {
    if (state.failed.size === 0) state.firstError = err;
    if (!state.failed.has(upstream)) state.failed.set(upstream, err);
  }

  private settle(state: TickState): LiveTickResult {
    for (const upstream of state.succeeded) this.failures.delete(upstream);
    for (const [upstream, err] of state.failed) this.failures.set(upstream, err);
    if (state.failed.size > 0) throw state.firstError;
    const [held] = this.failures.values();
    if (this.failures.size > 0) throw held;
    return { calls: state.calls, written: state.out.length };
  }
}
