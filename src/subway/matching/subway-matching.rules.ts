import { APPROACH_LEAD_MS } from "../subway.constants";
import type { SubwayDirection, TrainEvent, TrainState } from "../subway.types";
import type { ScheduledStop, ScheduledTrain } from "../timetable/subway-timetable.types";
import { MAX_DELAY_SEC, MIN_DELAY_SEC, MISSING_TRAIN_HOLD_MS } from "./subway-matching.constants";
import type { MatchedRuns, MatchingTick, RunMatch, Sighting } from "./subway-matching.types";

const SECOND_MS = 1000;

export function toOneDirectionDestinations(trains: readonly Pick<ScheduledTrain, "direction" | "destination">[]): Map<string, SubwayDirection> {
  const directionByDestination = new Map<string, SubwayDirection | null>();
  for (const { destination, direction } of trains) {
    const known = directionByDestination.get(destination);
    directionByDestination.set(destination, known === undefined || known === direction ? direction : null);
  }
  return new Map([...directionByDestination].filter((entry): entry is [string, SubwayDirection] => entry[1] !== null));
}

// WHY: read as the estimate reads a state against a stop (subway-estimate.rules.ts), so a matched run's delay is
// the delay the estimate then computes for the train.
function toScheduledAt(stop: ScheduledStop, state: TrainState): Date | null {
  if (state === "departed") return stop.departureAt;
  if (stop.arrivalAt === null || state === "arrived") return stop.arrivalAt;
  return new Date(stop.arrivalAt.getTime() - APPROACH_LEAD_MS);
}

function toRunDelaySec(run: ScheduledTrain, event: TrainEvent): number | null {
  const stop = run.stops.find((candidate) => candidate.platformId === event.platformId);
  const scheduledAt = stop ? toScheduledAt(stop, event.state) : null;
  return scheduledAt === null ? null : (event.stateChangedAt.getTime() - scheduledAt.getTime()) / SECOND_MS;
}

// WHY: no run overtakes another on a line matched to runs (design D7), so two runs of a direction keep their order
// at the first stop both call at.
function isRunBefore(earlier: ScheduledTrain, later: ScheduledTrain): boolean {
  for (const stop of earlier.stops) {
    const laterStop = later.stops.find((candidate) => candidate.platformId === stop.platformId);
    const [earlierAt, laterAt] = [stop.departureAt ?? stop.arrivalAt, laterStop?.departureAt ?? laterStop?.arrivalAt];
    if (earlierAt && laterAt) return earlierAt < laterAt;
  }
  return true;
}

function toNewestByTrainset(events: readonly TrainEvent[]): TrainEvent[] {
  const newestByTrainset = new Map<string, TrainEvent>();
  for (const event of events) {
    const kept = newestByTrainset.get(event.trainNo);
    if (!kept || kept.stateChangedAt < event.stateChangedAt) newestByTrainset.set(event.trainNo, event);
  }
  return [...newestByTrainset.values()];
}

function findNearestRun(tick: MatchingTick, event: TrainEvent, direction: SubwayDirection): ScheduledTrain | null {
  const route = tick.routes[direction];
  const runByNo = new Map(tick.trains.map((train) => [train.trainNo, train]));
  const others = [...tick.matchesByTrainset].filter(([trainset, match]) => trainset !== event.trainNo && match.direction === direction);
  const isInOrder = (run: ScheduledTrain): boolean =>
    others.every(([, other]) => {
      const [otherRun, offset] = [runByNo.get(other.runNo), route.indexOf(other.platformId) - route.indexOf(event.platformId)];
      if (!otherRun || offset === 0) return true;
      return offset > 0 ? isRunBefore(otherRun, run) : isRunBefore(run, otherRun);
    });
  const candidates = tick.trains
    .filter((run) => run.direction === direction && !others.some(([, other]) => other.runNo === run.trainNo) && isInOrder(run))
    .map((run) => ({ run, delaySec: toRunDelaySec(run, event) }))
    .filter((candidate): candidate is { run: ScheduledTrain; delaySec: number } => candidate.delaySec !== null)
    .filter(({ delaySec }) => delaySec >= MIN_DELAY_SEC && delaySec <= MAX_DELAY_SEC);
  return candidates.sort((a, b) => Math.abs(a.delaySec) - Math.abs(b.delaySec))[0]?.run ?? null;
}

function toSightings(tick: MatchingTick): Sighting[] {
  const directionByDestination = toOneDirectionDestinations(tick.trains);
  const sightings = toNewestByTrainset(tick.events).map((event) => ({ event, direction: directionByDestination.get(event.destination) }));
  const positionOf = ({ event, direction }: Sighting): number => (direction ? tick.routes[direction].indexOf(event.platformId) : -1);
  return sightings.sort((a, b) => positionOf(b) - positionOf(a));
}

const keepsRun = (run: ScheduledTrain | undefined, { event, direction }: Sighting): boolean =>
  !!run && run.direction === direction && toRunDelaySec(run, event) !== null;

export function matchRuns(tick: MatchingTick): MatchedRuns {
  const runByNo = new Map(tick.trains.map((train) => [train.trainNo, train]));
  const isHeld = (match: RunMatch): boolean => tick.now.getTime() - match.lastSeenAt.getTime() <= MISSING_TRAIN_HOLD_MS;
  const matches = new Map([...tick.matchesByTrainset].filter(([, match]) => isHeld(match)));
  const runOf = (trainset: string): ScheduledTrain | undefined => runByNo.get(matches.get(trainset)?.runNo ?? "");
  const sightings = toSightings(tick);
  const turned = sightings.filter((sighting) => sighting.direction && !keepsRun(runOf(sighting.event.trainNo), sighting));
  for (const { event } of turned) matches.delete(event.trainNo);
  const runs: MatchedRuns = { matchesByTrainset: matches, events: [], unmatched: [] };
  for (const { event, direction } of sightings) {
    const run = direction && (runOf(event.trainNo) ?? findNearestRun({ ...tick, matchesByTrainset: matches }, event, direction));
    if (!direction || !run) {
      runs.unmatched.push(event);
      continue;
    }
    matches.set(event.trainNo, { runNo: run.trainNo, direction, platformId: event.platformId, lastSeenAt: tick.now });
    runs.events.push({ ...event, trainNo: run.trainNo });
  }
  return runs;
}
