import { HSSC_POSITION_COUNT } from "../../bus.constants";
import { DEPARTURE_INOUTS, MAX_OVERDUE_SECONDS, MAX_OVERDUE_SECONDS_AFTER_TURNAROUND, NON_STOP_SEQS, SEGMENTS_BY_SEQ, TURNAROUND_SEQ } from "./bus-realtime-hssc-eta.constants";
import type { HsscBusAnchor, HsscEta, HsscLapTime, HsscSegment } from "./bus-realtime-hssc-eta.types";

const SECOND_MS = 1000;

export function isDepartureEvent(inout: string): boolean {
  return DEPARTURE_INOUTS.includes(inout);
}

export function isHsscStop(seq: number): boolean {
  return Number.isInteger(seq) && seq >= 0 && seq < HSSC_POSITION_COUNT && !NON_STOP_SEQS.includes(seq);
}

// WHY: a lap starts as a bus leaves the turnaround, so a position counts from there (0) to the stop before it (10), the line's index.
export function toStationIndex(seq: number): number {
  return (seq - TURNAROUND_SEQ + HSSC_POSITION_COUNT) % HSSC_POSITION_COUNT;
}

export function toSeq(stationIndex: number): number {
  return (stationIndex + TURNAROUND_SEQ) % HSSC_POSITION_COUNT;
}

function segmentOf(seq: number): HsscSegment {
  const segment = SEGMENTS_BY_SEQ[seq];
  if (!segment) throw new Error(`bus: HSSC seq ${seq} is outside the loop`);
  return segment;
}

function dwellSecondsOf(seq: number): number {
  const { dwellSeconds } = segmentOf(seq);
  if (dwellSeconds === null) throw new Error(`bus: HSSC seq ${seq} is the turnaround, whose layover is never estimated`);
  return dwellSeconds;
}

// WHY: the stops the bus reaches before this one, plus one, the rotary passes never counted (ADR 0019, D4).
export function toStopsAway(anchor: HsscBusAnchor, targetSeq: number): number {
  const ahead = (toStationIndex(targetSeq) - toStationIndex(anchor.seq) + HSSC_POSITION_COUNT) % HSSC_POSITION_COUNT;
  if (ahead === 0 && !anchor.isDeparted) return 0;
  const passedSeqs = Array.from({ length: (ahead || HSSC_POSITION_COUNT) - 1 }, (_, i) => (anchor.seq + i + 1) % HSSC_POSITION_COUNT);
  return passedSeqs.filter(isHsscStop).length + 1;
}

// WHY: a departed bus whose next stop event is past its travel median by more than the bound, so an estimate stops
// sliding with the clock (ADR 0018, D6); a bus at a stop is still standing there.
function isOverdue(anchor: HsscBusAnchor, now: Date): boolean {
  if (!anchor.isDeparted) return false;
  const maxOverdueSeconds = anchor.seq === TURNAROUND_SEQ ? MAX_OVERDUE_SECONDS_AFTER_TURNAROUND : MAX_OVERDUE_SECONDS;
  const overdueMs = now.getTime() - anchor.since.getTime() - segmentOf(anchor.seq).travelSeconds * SECOND_MS;
  return overdueMs > maxOverdueSeconds * SECOND_MS;
}

// WHY: at the turnaround, or overdue after leaving it: the feed says LEFT while the bus lays over by the stop (ADR 0018, D6).
export function isLayingOver(anchor: HsscBusAnchor, now: Date): boolean {
  return anchor.seq === TURNAROUND_SEQ && (!anchor.isDeparted || isOverdue(anchor, now));
}

function isStalled(anchor: HsscBusAnchor, now: Date): boolean {
  return anchor.seq !== TURNAROUND_SEQ && isOverdue(anchor, now);
}

// WHY: the layover's end cannot be predicted (ADR 0018, D2), so no time crosses it; the turnaround
// itself is reached by every bus heading to it.
function isBehindLayover(anchor: HsscBusAnchor, targetSeq: number, now: Date): boolean {
  if (isLayingOver(anchor, now)) return true;
  if (targetSeq === TURNAROUND_SEQ) return false;
  const [busLap, targetLap] = [toStationIndex(anchor.seq), toStationIndex(targetSeq)];
  return busLap > targetLap || (busLap === targetLap && anchor.isDeparted);
}

// WHY: what is left of a stopped bus's dwell, the overdue part counting 0 (design D3).
function toRestOfDwellMs(anchor: HsscBusAnchor, nowMs: number): number {
  const elapsedMs = Math.max(0, nowMs - anchor.since.getTime());
  return Math.max(dwellSecondsOf(anchor.seq) * SECOND_MS - elapsedMs, 0);
}

// WHY: the rest of the current dwell and the travel after it, each overdue part counting 0 (design D3).
function toFirstLegMs(anchor: HsscBusAnchor, nowMs: number): number {
  const travelMs = segmentOf(anchor.seq).travelSeconds * SECOND_MS;
  if (!anchor.isDeparted) return toRestOfDwellMs(anchor, nowMs) + travelMs;
  return Math.max(travelMs - Math.max(0, nowMs - anchor.since.getTime()), 0);
}

/** WHY: the bus's arrival and departure at each position ahead in its lap, up to the turnaround, never across a layover. */
export function toLapTimes(anchor: HsscBusAnchor, now: Date): HsscLapTime[] {
  if (isLayingOver(anchor, now) || isStalled(anchor, now)) return [];
  const times: HsscLapTime[] = [];
  let atMs = now.getTime() + toFirstLegMs(anchor, now.getTime());
  for (let lap = toStationIndex(anchor.seq) + 1; lap <= HSSC_POSITION_COUNT; lap++) {
    const seq = toSeq(lap);
    const departsAtMs = seq === TURNAROUND_SEQ ? null : atMs + dwellSecondsOf(seq) * SECOND_MS;
    times.push({ seq, arrivesAt: new Date(atMs), departsAt: departsAtMs === null ? null : new Date(departsAtMs) });
    if (departsAtMs !== null) atMs = departsAtMs + segmentOf(seq).travelSeconds * SECOND_MS;
  }
  return times;
}

function toArrivesAt(anchor: HsscBusAnchor, targetSeq: number, now: Date): Date {
  const time = toLapTimes(anchor, now).find(({ seq }) => seq === targetSeq);
  if (!time) throw new Error(`bus: HSSC seq ${targetSeq} is not ahead of the bus in its lap`);
  return time.arrivesAt;
}

export function toHsscEta(anchor: HsscBusAnchor, targetSeq: number, now: Date): HsscEta {
  const common = { vehicleId: anchor.vehicleId, stopsAway: toStopsAway(anchor, targetSeq), observedAt: anchor.observedAt };
  if (isStalled(anchor, now)) return { status: "unknown", ...common };
  if (isBehindLayover(anchor, targetSeq, now)) return { status: "waitingToDepart", ...common };
  if (anchor.seq === targetSeq && !anchor.isDeparted) {
    return { status: "arriving", ...common, departsAt: new Date(now.getTime() + toRestOfDwellMs(anchor, now.getTime())) };
  }
  return { status: "enRoute", ...common, arrivesAt: toArrivesAt(anchor, targetSeq, now) };
}

// WHY: a bus laying over at the turnaround is the one a rider boards there (ADR 0019, D9); a stalled bus, which
// clients skip, comes last so it never takes a served slot from a bus they show.
function toRank(eta: HsscEta): [number, number] {
  if (eta.status === "arriving" || (eta.status === "waitingToDepart" && eta.stopsAway === 0)) return [0, 0];
  if (eta.status === "enRoute") return [1, eta.arrivesAt.getTime()];
  return eta.status === "waitingToDepart" ? [2, eta.stopsAway] : [3, eta.stopsAway];
}

// WHY: nearest first: a bus at the stop, then by expected arrival, then the buses behind the layover by stops away,
// then the stalled ones.
export function toStopEtas(anchors: readonly HsscBusAnchor[], targetSeq: number, now: Date): HsscEta[] {
  return anchors
    .map((anchor) => toHsscEta(anchor, targetSeq, now))
    .map((eta) => ({ eta, rank: toRank(eta) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ eta }) => eta);
}
