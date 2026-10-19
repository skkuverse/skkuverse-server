import { Injectable } from "@nestjs/common";
import type { LaneCorridorSnapshot, LaneDirection, ProbeRoute } from "../lane/bus-eta-lane.types";
import { BusEtaProbeClient } from "./bus-eta-probe.client";
import { spanDoc } from "./bus-eta-probe.mapper";
import { BusEtaProbeRepository } from "./bus-eta-probe.repository";
import { toCorridorFix, toLegTime, toSpans } from "./bus-eta-probe.rules";
import type { CorridorFix, LaneSpan, LegTime } from "./bus-eta-probe.types";

const MINUTE_MS = 60_000;
// WHY: a partner is at most 15 minutes older by GPS time, which lags its fetch by about a minute.
const HISTORY_MINUTES = 20;

interface RouteSnapshot {
  routeId: string;
  minute: number;
  fixes: CorridorFix[];
}

/**
 * WHY: the bus-lane probe. `legTime` answers a corridor time or `{ kind: "unavailable" }` (no span reaches the leg,
 * or too little of it is covered), and rejects when a position request fails or the TOPIS cap is spent: the live tick
 * falls back and reports. One poller process holds the history, so a restart only costs the next tick a partner.
 */
@Injectable()
export class BusEtaProbeService {
  private readonly requests = new Map<string, { minute: number; fixes: Promise<CorridorFix[]> }>();
  private history: RouteSnapshot[] = [];
  private spansOfMinute: { minute: number; spans: Promise<LaneSpan[]> } | null = null;

  constructor(
    private readonly client: BusEtaProbeClient,
    private readonly repository: BusEtaProbeRepository,
  ) {}

  async prime(corridor: LaneCorridorSnapshot, now: Date): Promise<void> {
    await this.snapshot(corridor, now);
  }

  async legTime(corridor: LaneCorridorSnapshot, direction: LaneDirection, now: Date): Promise<LegTime> {
    const spans = await this.spansAt(corridor, now);
    const leg = corridor.legBoundsOf(direction);
    return toLegTime(spans.filter((span) => span.direction === direction), leg);
  }

  // WHY: both directions read one minute's spans, so each span is paired and written once.
  private spansAt(corridor: LaneCorridorSnapshot, now: Date): Promise<LaneSpan[]> {
    const minute = Math.floor(now.getTime() / MINUTE_MS);
    if (this.spansOfMinute?.minute !== minute) this.spansOfMinute = { minute, spans: this.pairAndRecord(corridor, now, minute) };
    return this.spansOfMinute.spans;
  }

  private async pairAndRecord(corridor: LaneCorridorSnapshot, now: Date, minute: number): Promise<LaneSpan[]> {
    const current = await this.snapshot(corridor, now);
    const earlier = this.history.filter((snapshot) => snapshot.minute < minute);
    const spans = corridor.probeRoutes.flatMap((route, index) =>
      toSpans(route.routeId, current[index] ?? [], earlier.filter((s) => s.routeId === route.routeId).flatMap((s) => s.fixes)),
    );
    await this.repository.recordSpans(spans.map(spanDoc));
    return spans;
  }

  // WHY: every route is asked before the first failure rejects, so the routes that answered still enter the history.
  private async snapshot(corridor: LaneCorridorSnapshot, now: Date): Promise<CorridorFix[][]> {
    const minute = Math.floor(now.getTime() / MINUTE_MS);
    this.history = this.history.filter((snapshot) => snapshot.minute > minute - HISTORY_MINUTES);
    const settled = await Promise.allSettled(corridor.probeRoutes.map((route) => this.request(corridor, route, now)));
    const failure = settled.find((outcome) => outcome.status === "rejected");
    if (failure) throw failure.reason;
    return settled.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));
  }

  // WHY: a route is asked at most once a minute; a failed request stays failed until the next minute.
  private request(corridor: LaneCorridorSnapshot, route: ProbeRoute, now: Date): Promise<CorridorFix[]> {
    const minute = Math.floor(now.getTime() / MINUTE_MS);
    const cached = this.requests.get(route.routeId);
    if (cached?.minute === minute) return cached.fixes;
    const fixes = this.client.fetchPositions(route.routeId, now).then((positions) => {
      const routeFixes = positions.flatMap((position) => toCorridorFix(corridor.corridor, route, position) ?? []);
      this.history.push({ routeId: route.routeId, minute, fixes: routeFixes });
      return routeFixes;
    });
    this.requests.set(route.routeId, { minute, fixes });
    return fixes;
  }
}
