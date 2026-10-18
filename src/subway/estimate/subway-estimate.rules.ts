import type { CountdownRow, TrainState } from "../subway.types";
import type { ScheduledStop, ScheduledTrain } from "../timetable/subway-timetable.types";
import type { TrainHistory, TrainProgress } from "../tracking/subway-tracking.types";
import { APPROACH_LEAD_MS } from "../subway.constants";
import { MAX_COUNTDOWN_DIVERGENCE_SEC, MAX_DELAY_LENDER_GAP_MS, MAX_DELAY_SEC, MAX_STANDING_PAST_DEPARTURE_SEC, MIN_DELAY_SEC } from "./subway-estimate.constants";
import type { CountdownFindings, CountdownRejectionReason, CountdownVerdict, EstimateInput, StationArrivals, TrainArrival } from "./subway-estimate.types";

const SECOND_MS = 1000;

interface Candidate {
  train: ScheduledTrain;
  servedAt: ScheduledStop;
  scheduledArrivalAt: Date;
  sighting: TrainHistory | null;
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

function toEventDelaySec(train: ScheduledTrain, latest: TrainProgress): number | null {
  const stop = train.stops.find((s) => s.platformId === latest.platformId);
  const scheduledAt = stop ? toScheduledAt(stop, latest.state) : null;
  return scheduledAt ? secondsBetween(latest.at, scheduledAt) : null;
}

export function toDelaySec(train: ScheduledTrain, latest: TrainProgress, now: Date): number | null {
  const stop = train.stops.find((s) => s.platformId === latest.platformId);
  const delaySec = toEventDelaySec(train, latest);
  return stop && delaySec !== null && isDelayInRange(delaySec) ? Math.max(delaySec, toStandingLateSec(stop, latest, now)) : null;
}

const isAtServedStation = (candidate: Candidate): boolean => candidate.sighting?.latest.platformId === candidate.servedAt.platformId;

function hasPassed(candidate: Candidate): boolean {
  const latest = candidate.sighting?.latest;
  const platformIds = candidate.train.stops.map((stop) => stop.platformId);
  const [latestIndex, servedIndex] = [platformIds.indexOf(latest?.platformId ?? ""), platformIds.indexOf(candidate.servedAt.platformId)];
  return latestIndex > servedIndex || (latestIndex === servedIndex && latest?.state === "departed");
}

const callsAt = (train: ScheduledTrain, platformId: string): boolean => train.stops.some((stop) => stop.platformId === platformId);

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
function toPassingStop(train: ScheduledTrain, trains: readonly ScheduledTrain[], platformId: string): ScheduledStop | null {
  const passes = trains.flatMap((caller) => {
    const from = caller.stops.findIndex((stop) => stop.platformId === platformId);
    const to = from < 0 || caller.direction !== train.direction ? -1 : caller.stops.findIndex((stop, index) => index > from && callsAt(train, stop.platformId));
    const callerArrivalAt = caller.stops[to]?.arrivalAt;
    const nextArrivalAt = train.stops.find((stop) => stop.platformId === caller.stops[to]?.platformId)?.arrivalAt;
    const runSec = to < 0 ? null : toRunSec(caller.stops.slice(from, to + 1));
    if (runSec === null || !callerArrivalAt || !nextArrivalAt) return [];
    return [{ passedAt: plusSec(nextArrivalAt, -runSec), gapMs: Math.abs(nextArrivalAt.getTime() - callerArrivalAt.getTime()) }];
  });
  const nearest = passes.sort((a, b) => a.gapMs - b.gapMs)[0];
  return nearest ? { platformId, arrivalAt: nearest.passedAt, departureAt: nearest.passedAt } : null;
}

function toOwnDelaySec(input: EstimateInput, train: ScheduledTrain, latest: TrainProgress): number | null {
  const passingStop = callsAt(train, latest.platformId) ? null : toPassingStop(train, input.trains, latest.platformId);
  return toDelaySec(passingStop ? { ...train, stops: [passingStop] } : train, latest, input.now);
}

function toCandidate(input: EstimateInput, train: ScheduledTrain): Candidate | null {
  const servedAt = train.stops.find((stop) => stop.platformId === input.platformId);
  const scheduledArrivalAt = servedAt?.arrivalAt ?? servedAt?.departureAt;
  if (!servedAt || !scheduledArrivalAt) return null;
  const sighting = input.histories.get(train.trainNo) ?? null;
  return { train, servedAt, scheduledArrivalAt, sighting, delaySec: sighting ? toOwnDelaySec(input, train, sighting.latest) : null };
}

function toLentDelaySec(candidate: Candidate, ahead: readonly Candidate[]): number | null {
  const isLender = (other: Candidate): boolean =>
    other.delaySec !== null && candidate.scheduledArrivalAt.getTime() - other.scheduledArrivalAt.getTime() <= MAX_DELAY_LENDER_GAP_MS;
  return ahead.filter(isLender).at(-1)?.delaySec ?? null;
}

// WHY: at the served station a train's arrival is observed whatever its delay, standing there delays only its
// departure (design D4), and a seen train is placed by its own sighting, never by another train's delay (design D16).
function toServedDelaySec(candidate: Candidate, ahead: readonly Candidate[]): number | null {
  if (candidate.sighting && isAtServedStation(candidate)) return toEventDelaySec(candidate.train, candidate.sighting.latest);
  return candidate.delaySec ?? (candidate.sighting ? null : toLentDelaySec(candidate, ahead));
}

function isSeenAtOrPast(candidate: Candidate): boolean {
  const platformIds = candidate.train.stops.map((stop) => stop.platformId);
  const latestPlatformId = candidate.sighting?.latest.platformId;
  return latestPlatformId !== undefined && platformIds.indexOf(latestPlatformId) >= platformIds.indexOf(candidate.servedAt.platformId);
}

// WHY: on the tracker's path every train is seen at the served station (2026-10-17: all 157 to 16:35), so one overdue
// there with a row stop before it is late, not gone, until a later train on its track (no local) is seen there.
function isAwaitedTrain(input: EstimateInput, candidate: Candidate, later: readonly Candidate[]): boolean {
  const isOvertaken = later.some((other) => other.train.express === candidate.train.express && isSeenAtOrPast(other));
  const isInDelayRange = plusSec(candidate.servedAt.departureAt ?? candidate.scheduledArrivalAt, MAX_DELAY_SEC) >= input.now;
  return input.isTracked && !isSeenAtOrPast(candidate) && candidate.train.stops[0] !== candidate.servedAt && isInDelayRange && !isOvertaken;
}

function toAwaitedArrival(candidate: Candidate, now: Date): TrainArrival {
  const runMs = candidate.scheduledArrivalAt.getTime() - (candidate.train.stops[0]?.departureAt ?? candidate.scheduledArrivalAt).getTime();
  return { ...toArrival(candidate, null), arrivalAt: new Date(now.getTime() + runMs), source: "estimated" };
}

function hasLeft(candidate: Candidate, delaySec: number | null, now: Date): boolean {
  const departureAt = plusSec(candidate.servedAt.departureAt ?? candidate.scheduledArrivalAt, delaySec ?? 0);
  if (hasPassed(candidate)) return true;
  if (isAtServedStation(candidate)) return plusSec(departureAt, MAX_STANDING_PAST_DEPARTURE_SEC) < now;
  return candidate.delaySec === null && departureAt < now;
}

function toArrival(candidate: Candidate, delaySec: number | null): TrainArrival {
  const { trainNo, direction, destination, express } = candidate.train;
  const latest = candidate.sighting?.latest;
  return {
    trainNo,
    direction,
    destination,
    express,
    arrivalAt: plusSec(candidate.scheduledArrivalAt, delaySec ?? 0),
    source: delaySec === null ? "scheduled" : "estimated",
    position: latest ? { platformId: latest.platformId, state: latest.state } : null,
  };
}

// WHY: a train seen at the station has outrun its countdown, a spent one counts no more, and one implying a delay
// out of range is likelier for a train not running yet, as a first train at its origin (design D4).
function toRejectionReason(candidate: Candidate, row: CountdownRow, now: Date): CountdownRejectionReason | null {
  const liveArrivalAt = plusSec(row.generatedAt, row.remainingSec);
  if (isAtServedStation(candidate)) return "at_station";
  if (row.remainingSec <= 0 || liveArrivalAt <= now) return "spent";
  return isDelayInRange(secondsBetween(liveArrivalAt, candidate.scheduledArrivalAt)) ? null : "out_of_range";
}

function withCountdown(arrival: TrainArrival, verdict: CountdownVerdict, findings: CountdownFindings): TrainArrival {
  const { row, reason } = verdict;
  const liveArrivalAt = plusSec(row.generatedAt, row.remainingSec);
  const finding = { trainNo: arrival.trainNo, platformId: row.platformId, liveArrivalAt, estimatedArrivalAt: arrival.arrivalAt };
  if (reason) {
    findings.rejections.push({ ...finding, reason });
    return arrival;
  }
  const divergenceSec = Math.abs(secondsBetween(liveArrivalAt, arrival.arrivalAt));
  if (divergenceSec > MAX_COUNTDOWN_DIVERGENCE_SEC) findings.divergences.push({ ...finding, divergenceSec });
  return { ...arrival, arrivalAt: liveArrivalAt, source: "live" };
}

export function toStationArrivals(input: EstimateInput): StationArrivals {
  const candidates = input.trains
    .flatMap((train) => (train.direction === input.direction ? (toCandidate(input, train) ?? []) : []))
    .sort((a, b) => a.scheduledArrivalAt.getTime() - b.scheduledArrivalAt.getTime());
  const findings: CountdownFindings = { divergences: [], rejections: [] };
  const arrivals = candidates.flatMap((candidate, index) => {
    const delaySec = toServedDelaySec(candidate, candidates.slice(0, index));
    const isOverdue = hasLeft(candidate, delaySec, input.now);
    if (isOverdue && !isAwaitedTrain(input, candidate, candidates.slice(index + 1))) return [];
    const row = input.countdownRows.find((r) => r.trainNo === candidate.train.trainNo && r.platformId === input.platformId);
    const arrival = isOverdue ? toAwaitedArrival(candidate, input.now) : toArrival(candidate, delaySec);
    return [row ? withCountdown(arrival, { row, reason: toRejectionReason(candidate, row, input.now) }, findings) : arrival];
  });
  return { arrivals: arrivals.sort((a, b) => a.arrivalAt.getTime() - b.arrivalAt.getTime()), ...findings };
}
