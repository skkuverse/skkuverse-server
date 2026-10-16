import type { CountdownRow, TrainState } from "../subway.types";
import type { ScheduledStop, ScheduledTrain } from "../timetable/subway-timetable.types";
import type { TrainHistory, TrainProgress } from "../tracking/subway-tracking.types";
import { APPROACH_LEAD_MS, MAX_COUNTDOWN_DIVERGENCE_SEC, MAX_DELAY_LENDER_GAP_MS, MAX_DELAY_SEC, MIN_DELAY_SEC } from "./subway-estimate.constants";
import type { CountdownDivergence, EstimateInput, StationArrivals, TrainArrival } from "./subway-estimate.types";

const SECOND_MS = 1000;

interface Candidate {
  train: ScheduledTrain;
  servedAt: ScheduledStop;
  scheduledArrivalAt: Date;
  history: TrainHistory | null;
  delaySec: number | null;
}

const secondsBetween = (later: Date, earlier: Date): number => (later.getTime() - earlier.getTime()) / SECOND_MS;
const plusSec = (instant: Date, seconds: number): Date => new Date(instant.getTime() + seconds * SECOND_MS);

function toScheduledAt(stop: ScheduledStop, state: TrainState): Date | null {
  if (state === "departed") return stop.departureAt;
  if (stop.arrivalAt === null || state === "arrived") return stop.arrivalAt;
  return new Date(stop.arrivalAt.getTime() - APPROACH_LEAD_MS);
}

function toStandingLateSec(stop: ScheduledStop, latest: TrainProgress, now: Date): number {
  const isStanding = latest.state !== "departed" && stop.departureAt !== null && now > stop.departureAt;
  return isStanding && stop.departureAt ? secondsBetween(now, stop.departureAt) : Number.NEGATIVE_INFINITY;
}

export function toDelaySec(train: ScheduledTrain, latest: TrainProgress, now: Date): number | null {
  const stop = train.stops.find((s) => s.stationId === latest.stationId);
  const scheduledAt = stop ? toScheduledAt(stop, latest.state) : null;
  if (!stop || !scheduledAt) return null;
  const delaySec = secondsBetween(latest.at, scheduledAt);
  return delaySec < MIN_DELAY_SEC || delaySec > MAX_DELAY_SEC ? null : Math.max(delaySec, toStandingLateSec(stop, latest, now));
}

function hasPassed(candidate: Candidate): boolean {
  const latest = candidate.history?.latest;
  const stationIds = candidate.train.stops.map((stop) => stop.stationId);
  const [latestIndex, servedIndex] = [stationIds.indexOf(latest?.stationId ?? ""), stationIds.indexOf(candidate.servedAt.stationId)];
  return latestIndex > servedIndex || (latestIndex === servedIndex && latest?.state === "departed");
}

function toCandidate(input: EstimateInput, train: ScheduledTrain): Candidate | null {
  const servedAt = train.stops.find((stop) => stop.stationId === input.stationId);
  const scheduledArrivalAt = servedAt?.arrivalAt ?? servedAt?.departureAt;
  if (!servedAt || !scheduledArrivalAt) return null;
  const known = input.histories.get(train.trainNo);
  const delaySec = known ? toDelaySec(train, known.latest, input.now) : null;
  return { train, servedAt, scheduledArrivalAt, history: known && delaySec !== null ? known : null, delaySec };
}

function toLentDelaySec(candidate: Candidate, ahead: readonly Candidate[]): number | null {
  const isLender = (other: Candidate): boolean =>
    other.delaySec !== null && candidate.scheduledArrivalAt.getTime() - other.scheduledArrivalAt.getTime() <= MAX_DELAY_LENDER_GAP_MS;
  return ahead.filter(isLender).at(-1)?.delaySec ?? null;
}

function toArrival(candidate: Candidate, delaySec: number | null): TrainArrival {
  const { trainNo, direction, destination, express } = candidate.train;
  const latest = candidate.history?.latest;
  return {
    trainNo,
    direction,
    destination,
    express,
    arrivalAt: plusSec(candidate.scheduledArrivalAt, delaySec ?? 0),
    source: delaySec === null ? "scheduled" : "estimated",
    position: latest ? { stationId: latest.stationId, state: latest.state } : null,
  };
}

function withCountdown(arrival: TrainArrival, row: CountdownRow | undefined, divergences: CountdownDivergence[]): TrainArrival {
  if (!row || row.remainingSec <= 0) return arrival;
  const liveArrivalAt = plusSec(row.generatedAt, row.remainingSec);
  const divergenceSec = Math.abs(secondsBetween(liveArrivalAt, arrival.arrivalAt));
  if (divergenceSec > MAX_COUNTDOWN_DIVERGENCE_SEC) {
    divergences.push({ trainNo: arrival.trainNo, stationId: row.stationId, liveArrivalAt, estimatedArrivalAt: arrival.arrivalAt, divergenceSec });
  }
  return { ...arrival, arrivalAt: liveArrivalAt, source: "live" };
}

export function toStationArrivals(input: EstimateInput): StationArrivals {
  const candidates = input.trains
    .flatMap((train) => (train.direction === input.direction ? (toCandidate(input, train) ?? []) : []))
    .sort((a, b) => a.scheduledArrivalAt.getTime() - b.scheduledArrivalAt.getTime());
  const divergences: CountdownDivergence[] = [];
  const arrivals = candidates.flatMap((candidate, index) => {
    const delaySec = candidate.delaySec ?? toLentDelaySec(candidate, candidates.slice(0, index));
    const departureAt = plusSec(candidate.servedAt.departureAt ?? candidate.scheduledArrivalAt, delaySec ?? 0);
    if (hasPassed(candidate) || (!candidate.history && departureAt < input.now)) return [];
    const row = input.countdownRows.find((r) => r.trainNo === candidate.train.trainNo && r.stationId === input.stationId);
    return [withCountdown(toArrival(candidate, delaySec), row, divergences)];
  });
  return { arrivals: arrivals.sort((a, b) => a.arrivalAt.getTime() - b.arrivalAt.getTime()), divergences };
}
