import { HSSC_POSITION_COUNT } from "../../bus.constants";
import { DEPARTURE_INOUTS, NON_STOP_SEQS, SEGMENTS_BY_SEQ, TURNAROUND_SEQ } from "./bus-realtime-hssc-eta.constants";
import type { HsscBusAnchor, HsscEta, HsscSegment } from "./bus-realtime-hssc-eta.types";

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

export function toStopsAway(anchor: HsscBusAnchor, targetSeq: number): number {
  const ahead = (toLapIndex(targetSeq) - toLapIndex(anchor.seq) + HSSC_POSITION_COUNT) % HSSC_POSITION_COUNT;
  return ahead === 0 && anchor.isDeparted ? HSSC_POSITION_COUNT : ahead;
}

// WHY: the layover's end cannot be predicted (ADR 0018, D2), so no time crosses it; the turnaround
// itself is reached by every bus heading to it.
function isBehindLayover(anchor: HsscBusAnchor, targetSeq: number): boolean {
  if (anchor.seq === TURNAROUND_SEQ && !anchor.isDeparted) return true;
  if (targetSeq === TURNAROUND_SEQ) return false;
  const [busLap, targetLap] = [toLapIndex(anchor.seq), toLapIndex(targetSeq)];
  return busLap > targetLap || (busLap === targetLap && anchor.isDeparted);
}

// WHY: what is left of the current dwell and the travel after it, each overdue part counting 0 (ADR 0018, D3).
function toFirstLegMs(anchor: HsscBusAnchor, nowMs: number): number {
  const elapsedMs = Math.max(0, nowMs - anchor.since.getTime());
  const travelMs = segmentOf(anchor.seq).travelSeconds * SECOND_MS;
  if (anchor.isDeparted) return Math.max(travelMs - elapsedMs, 0);
  return Math.max(dwellSecondsOf(anchor.seq) * SECOND_MS - elapsedMs, 0) + travelMs;
}

function toRemainingMs(anchor: HsscBusAnchor, targetSeq: number, nowMs: number): number {
  const endLap = targetSeq === TURNAROUND_SEQ ? HSSC_POSITION_COUNT : toLapIndex(targetSeq);
  let remainingMs = toFirstLegMs(anchor, nowMs);
  for (let lap = toLapIndex(anchor.seq) + 1; lap < endLap; lap++) {
    const seq = toSeq(lap);
    remainingMs += (dwellSecondsOf(seq) + segmentOf(seq).travelSeconds) * SECOND_MS;
  }
  return remainingMs;
}

export function toHsscEta(anchor: HsscBusAnchor, targetSeq: number, now: Date): HsscEta {
  const common = { vehicleId: anchor.vehicleId, stopsAway: toStopsAway(anchor, targetSeq), observedAt: anchor.observedAt };
  if (isBehindLayover(anchor, targetSeq)) return { status: "waitingToDepart", ...common };
  if (anchor.seq === targetSeq && !anchor.isDeparted) return { status: "arriving", ...common };
  return { status: "enRoute", ...common, arrivesAt: new Date(now.getTime() + toRemainingMs(anchor, targetSeq, now.getTime())) };
}

function toRank(eta: HsscEta): [number, number] {
  if (eta.status === "arriving") return [0, 0];
  return eta.status === "enRoute" ? [1, eta.arrivesAt.getTime()] : [2, eta.stopsAway];
}

// WHY: nearest first: a bus at the stop, then by expected arrival, then the buses behind the layover by the loop.
export function toStopEtas(anchors: readonly HsscBusAnchor[], targetSeq: number, now: Date): HsscEta[] {
  return anchors
    .map((anchor) => toHsscEta(anchor, targetSeq, now))
    .map((eta) => ({ eta, rank: toRank(eta) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ eta }) => eta);
}
