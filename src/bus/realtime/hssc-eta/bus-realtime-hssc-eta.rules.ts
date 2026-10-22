import { HSSC_POSITION_COUNT } from "../../bus.constants";
import { DEPARTURE_INOUTS, NON_STOP_SEQS, SEGMENTS_BY_SEQ, TURNAROUND_SEQ } from "./bus-realtime-hssc-eta.constants";
import type { HsscBusAnchor, HsscEta, HsscLapTime, HsscSegment } from "./bus-realtime-hssc-eta.types";

const SECOND_MS = 1000;

export function isDepartureEvent(inout: string): boolean {
  return DEPARTURE_INOUTS.includes(inout);
}

export function isHsscStop(seq: number): boolean {
  return Number.isInteger(seq) && seq >= 0 && seq < HSSC_POSITION_COUNT && !NON_STOP_SEQS.includes(seq);
}

// WHY: a lap starts as a bus leaves the turnaround, so a position counts from there (0) to the stop before it (10).
function toLapIndex(seq: number): number {
  return (seq - TURNAROUND_SEQ + HSSC_POSITION_COUNT) % HSSC_POSITION_COUNT;
}

function toSeq(lapIndex: number): number {
  return (lapIndex + TURNAROUND_SEQ) % HSSC_POSITION_COUNT;
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
  const ahead = (toLapIndex(targetSeq) - toLapIndex(anchor.seq) + HSSC_POSITION_COUNT) % HSSC_POSITION_COUNT;
  if (ahead === 0 && !anchor.isDeparted) return 0;
  const passedSeqs = Array.from({ length: (ahead || HSSC_POSITION_COUNT) - 1 }, (_, i) => (anchor.seq + i + 1) % HSSC_POSITION_COUNT);
  return passedSeqs.filter(isHsscStop).length + 1;
}

// WHY: the layover's end cannot be predicted (ADR 0018, D2), so no time crosses it; the turnaround
// itself is reached by every bus heading to it.
function isBehindLayover(anchor: HsscBusAnchor, targetSeq: number): boolean {
  if (anchor.seq === TURNAROUND_SEQ && !anchor.isDeparted) return true;
  if (targetSeq === TURNAROUND_SEQ) return false;
  const [busLap, targetLap] = [toLapIndex(anchor.seq), toLapIndex(targetSeq)];
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
  if (anchor.seq === TURNAROUND_SEQ && !anchor.isDeparted) return [];
  const times: HsscLapTime[] = [];
  let atMs = now.getTime() + toFirstLegMs(anchor, now.getTime());
  for (let lap = toLapIndex(anchor.seq) + 1; lap <= HSSC_POSITION_COUNT; lap++) {
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
  if (isBehindLayover(anchor, targetSeq)) return { status: "waitingToDepart", ...common };
  if (anchor.seq === targetSeq && !anchor.isDeparted) {
    return { status: "arriving", ...common, departsAt: new Date(now.getTime() + toRestOfDwellMs(anchor, now.getTime())) };
  }
  return { status: "enRoute", ...common, arrivesAt: toArrivesAt(anchor, targetSeq, now) };
}

// WHY: a bus laying over at the turnaround is the one a rider boards there (ADR 0019, D9).
function toRank(eta: HsscEta): [number, number] {
  if (eta.status === "arriving" || (eta.status === "waitingToDepart" && eta.stopsAway === 0)) return [0, 0];
  return eta.status === "enRoute" ? [1, eta.arrivesAt.getTime()] : [2, eta.stopsAway];
}

// WHY: nearest first: a bus at the stop, then by expected arrival, then the buses behind the layover by stops away.
export function toStopEtas(anchors: readonly HsscBusAnchor[], targetSeq: number, now: Date): HsscEta[] {
  return anchors
    .map((anchor) => toHsscEta(anchor, targetSeq, now))
    .map((eta) => ({ eta, rank: toRank(eta) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ eta }) => eta);
}
