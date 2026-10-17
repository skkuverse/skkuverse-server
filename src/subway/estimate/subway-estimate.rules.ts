import type { CountdownRow, TrainState } from "../subway.types";
import type { ScheduledStop, ScheduledTrain } from "../timetable/subway-timetable.types";
import type { TrainHistory, TrainProgress } from "../tracking/subway-tracking.types";
import { APPROACH_LEAD_MS } from "../subway.constants";
import { MAX_COUNTDOWN_DIVERGENCE_SEC, MAX_DELAY_LENDER_GAP_MS, MAX_DELAY_SEC, MAX_STANDING_PAST_DEPARTURE_SEC, MIN_DELAY_SEC } from "./subway-estimate.constants";
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
const isDelayInRange = (delaySec: number): boolean => delaySec >= MIN_DELAY_SEC && delaySec <= MAX_DELAY_SEC;

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
  return isDelayInRange(delaySec) ? Math.max(delaySec, toStandingLateSec(stop, latest, now)) : null;
}

const isAtServedStation = (candidate: Candidate): boolean => candidate.history?.latest.stationId === candidate.servedAt.stationId;

function hasPassed(candidate: Candidate): boolean {
  const latest = candidate.history?.latest;
  const stationIds = candidate.train.stops.map((stop) => stop.stationId);
  const [latestIndex, servedIndex] = [stationIds.indexOf(latest?.stationId ?? ""), stationIds.indexOf(candidate.servedAt.stationId)];
  return latestIndex > servedIndex || (latestIndex === servedIndex && latest?.state === "departed");
}

const callsAt = (train: ScheduledTrain, stationId: string): boolean => train.stops.some((stop) => stop.stationId === stationId);

function toRunSec(stops: readonly ScheduledStop[]): number | null {
  let runSec = 0;
  for (const [index, stop] of stops.slice(1).entries()) {
    const departedAt = stops[index]?.departureAt;
    if (!departedAt || !stop.arrivalAt) return null;
    runSec += secondsBetween(stop.arrivalAt, departedAt);
  }
  return runSec;
}

// WHY: a train's row has no time at a station it passes (design D4); a train calling there and at its next stop
// runs between them in the sum of its legs, its stands left out, which the nearest one in time gives.
function toPassingStop(train: ScheduledTrain, trains: readonly ScheduledTrain[], stationId: string): ScheduledStop | null {
  const passes = trains.flatMap((caller) => {
    const from = caller.stops.findIndex((stop) => stop.stationId === stationId);
    const to = from < 0 || caller.direction !== train.direction ? -1 : caller.stops.findIndex((stop, index) => index > from && callsAt(train, stop.stationId));
    const callerArrivalAt = caller.stops[to]?.arrivalAt;
    const nextArrivalAt = train.stops.find((stop) => stop.stationId === caller.stops[to]?.stationId)?.arrivalAt;
    const runSec = to < 0 ? null : toRunSec(caller.stops.slice(from, to + 1));
    if (runSec === null || !callerArrivalAt || !nextArrivalAt) return [];
    return [{ passedAt: plusSec(nextArrivalAt, -runSec), gapMs: Math.abs(nextArrivalAt.getTime() - callerArrivalAt.getTime()) }];
  });
  const nearest = passes.sort((a, b) => a.gapMs - b.gapMs)[0];
  return nearest ? { stationId, arrivalAt: nearest.passedAt, departureAt: nearest.passedAt } : null;
}

function toOwnDelaySec(input: EstimateInput, train: ScheduledTrain, latest: TrainProgress): number | null {
  const passingStop = callsAt(train, latest.stationId) ? null : toPassingStop(train, input.trains, latest.stationId);
  return toDelaySec(passingStop ? { ...train, stops: [passingStop] } : train, latest, input.now);
}

function toCandidate(input: EstimateInput, train: ScheduledTrain): Candidate | null {
  const servedAt = train.stops.find((stop) => stop.stationId === input.stationId);
  const scheduledArrivalAt = servedAt?.arrivalAt ?? servedAt?.departureAt;
  if (!servedAt || !scheduledArrivalAt) return null;
  const known = input.histories.get(train.trainNo);
  const delaySec = known ? toOwnDelaySec(input, train, known.latest) : null;
  return { train, servedAt, scheduledArrivalAt, history: known && delaySec !== null ? known : null, delaySec };
}

function toLentDelaySec(candidate: Candidate, ahead: readonly Candidate[]): number | null {
  const isLender = (other: Candidate): boolean =>
    other.delaySec !== null && candidate.scheduledArrivalAt.getTime() - other.scheduledArrivalAt.getTime() <= MAX_DELAY_LENDER_GAP_MS;
  return ahead.filter(isLender).at(-1)?.delaySec ?? null;
}

// WHY: at the served station a train's arrival is observed and standing there delays only its departure, which a
// Korail section never reports; the train counts as gone once that departure is overrun (design D4).
function toServedDelaySec(candidate: Candidate, ahead: readonly Candidate[]): number | null {
  const latest = candidate.history?.latest;
  return latest && isAtServedStation(candidate) ? toDelaySec(candidate.train, latest, latest.at) : (candidate.delaySec ?? toLentDelaySec(candidate, ahead));
}

function hasLeft(candidate: Candidate, delaySec: number | null, now: Date): boolean {
  const departureAt = plusSec(candidate.servedAt.departureAt ?? candidate.scheduledArrivalAt, delaySec ?? 0);
  if (!candidate.history) return departureAt < now;
  return hasPassed(candidate) || (isAtServedStation(candidate) && plusSec(departureAt, MAX_STANDING_PAST_DEPARTURE_SEC) < now);
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

// WHY: a train seen at the station has outrun its countdown, and a countdown implying a delay out of range is
// likelier one for a train not running yet, such as a first train standing at its origin (design D4).
function toCountingRow(candidate: Candidate, row: CountdownRow | undefined): CountdownRow | undefined {
  const liveDelaySec = row && secondsBetween(plusSec(row.generatedAt, row.remainingSec), candidate.scheduledArrivalAt);
  return liveDelaySec !== undefined && isDelayInRange(liveDelaySec) && !isAtServedStation(candidate) ? row : undefined;
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
    const delaySec = toServedDelaySec(candidate, candidates.slice(0, index));
    if (hasLeft(candidate, delaySec, input.now)) return [];
    const row = input.countdownRows.find((r) => r.trainNo === candidate.train.trainNo && r.stationId === input.stationId);
    return [withCountdown(toArrival(candidate, delaySec), toCountingRow(candidate, row), divergences)];
  });
  return { arrivals: arrivals.sort((a, b) => a.arrivalAt.getTime() - b.arrivalAt.getTime()), divergences };
}
