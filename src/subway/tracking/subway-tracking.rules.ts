import { captureGroups } from "../../shared/regex.util";
import { MAX_UPSTREAM_PLATFORMS } from "../subway.constants";
import type { CountdownRow, SubwayDirection, TrainEvent, TrainState } from "../subway.types";
import type { ScheduledTrain, TimetableTrain } from "../timetable/subway-timetable.types";
import { MAX_COUNTDOWN_SOURCE_AGE_MS, MAX_ROW_AHEAD_MS, MISSING_TRAIN_HOLD_MS, PASSED_TRAIN_HOLD_MS, STATE_STEPS } from "./subway-tracking.constants";
import type { SourceCountdownRows, TrackingTick, TrainHistory, TrainProgress } from "./subway-tracking.types";

const TRAIN_NO = /^[A-Z]*(\d{1,4})$/;
const TRAIN_NO_DIGITS = 4;
const STATES_PER_STATION = Object.keys(STATE_STEPS).length;

export function toTrainNo(raw: string): string | null {
  const groups = captureGroups(raw, TRAIN_NO, 1);
  return groups ? groups[0].padStart(TRAIN_NO_DIGITS, "0") : null;
}

const toOrdinal = (stationIndex: number, state: TrainState): number => STATES_PER_STATION * stationIndex + STATE_STEPS[state];

export function toProgressOrdinal(route: readonly string[], event: Pick<TrainEvent, "platformId" | "state">): number | null {
  const stationIndex = route.indexOf(event.platformId);
  return stationIndex < 0 ? null : toOrdinal(stationIndex, event.state);
}

// WHY: a train seen at a station its row passes has left its last stop before it, at the latest then, so it never replaces
// a stop event; before its first stop or its stop at the served station it stays there, as that stop may be an express run back.
function toStopProgress(tick: TrackingTick, route: readonly string[], event: TrainEvent): TrainProgress | null {
  const stopPlatformIds = tick.stopPlatformIdsByTrainNo.get(event.trainNo);
  const stationIndex = route.indexOf(event.platformId);
  const at = event.stateChangedAt;
  if (stationIndex < 0) return null;
  const progress: TrainProgress = { platformId: event.platformId, state: event.state, at, ordinal: toOrdinal(stationIndex, event.state) };
  if (!stopPlatformIds || stopPlatformIds.includes(event.platformId)) return progress;
  const lastStopId = route.slice(0, stationIndex).filter((platformId) => stopPlatformIds.includes(platformId)).at(-1);
  const nextStopId = route.slice(stationIndex).find((platformId) => stopPlatformIds.includes(platformId));
  if (lastStopId === undefined || nextStopId === tick.platformId) return progress;
  return { platformId: lastStopId, state: "departed", at, ordinal: toOrdinal(route.indexOf(lastStopId), "departed") };
}

// WHY: every operator numbers up trains even, down odd (all of subway-timetables); a one-direction destination decides first.
export function toDirection(
  train: Pick<TrainEvent, "trainNo" | "destination">,
  directionByDestination: ReadonlyMap<string, SubwayDirection>,
): SubwayDirection {
  return directionByDestination.get(train.destination) ?? (Number(train.trainNo) % 2 === 0 ? "up" : "down");
}

export function toDirectionByDestination(trains: readonly Pick<TimetableTrain, "direction" | "destination">[]): Map<string, SubwayDirection> {
  const toDestinations = (direction: SubwayDirection): Set<string> => new Set(trains.filter((t) => t.direction === direction).map((t) => t.destination));
  const [upDestinations, downDestinations] = [toDestinations("up"), toDestinations("down")];
  return new Map(trains.filter((t) => !(upDestinations.has(t.destination) && downDestinations.has(t.destination))).map((t) => [t.destination, t.direction]));
}

export function toStopPlatformIdsByTrainNo(trains: readonly Pick<ScheduledTrain, "trainNo" | "stops">[]): Map<string, string[]> {
  return new Map(trains.map((train) => [train.trainNo, train.stops.map((stop) => stop.platformId)]));
}

export function toPassedPlatformIds(route: readonly string[], platformId: string, stopPlatformIds: readonly string[]): string[] {
  const [from, to] = [Math.max(route.indexOf(stopPlatformIds[0] ?? "") + 1, route.indexOf(platformId) - MAX_UPSTREAM_PLATFORMS), Math.max(0, route.indexOf(platformId))];
  return route.slice(from, to).filter((id) => !stopPlatformIds.includes(id)).reverse();
}

export function toLatestProgress(latest: TrainProgress, candidate: TrainProgress): TrainProgress {
  if (candidate.ordinal === latest.ordinal) return candidate.at < latest.at ? { ...latest, at: candidate.at } : latest;
  const isForwardAndNoOlder = candidate.ordinal > latest.ordinal && candidate.at >= latest.at;
  return isForwardAndNoOlder ? candidate : latest;
}

export function toNewestEvents(events: readonly TrainEvent[], now: Date): TrainEvent[] {
  const newestByTrainNo = new Map<string, TrainEvent>();
  for (const event of events) {
    const trainNo = toTrainNo(event.trainNo);
    const isTooFarAhead = event.stateChangedAt.getTime() - now.getTime() > MAX_ROW_AHEAD_MS;
    const kept = trainNo === null ? undefined : newestByTrainNo.get(trainNo);
    if (trainNo === null || isTooFarAhead || (kept && kept.stateChangedAt >= event.stateChangedAt)) continue;
    newestByTrainNo.set(trainNo, { ...event, trainNo });
  }
  return [...newestByTrainNo.values()];
}

function withEvent(tick: TrackingTick, known: TrainHistory | undefined, event: TrainEvent): TrainHistory | null {
  const direction = known?.direction ?? toDirection(event, tick.directionByDestination);
  const candidate = toStopProgress(tick, tick.routes[direction], event);
  if (candidate === null) return null;
  const latest = known ? toLatestProgress(known.latest, candidate) : candidate;
  const destination = latest === candidate || !known ? event.destination : known.destination;
  return { trainNo: event.trainNo, direction, destination, latest, lastSeenAt: tick.now };
}

function isSeenAtOrPastStation(tick: TrackingTick, history: TrainHistory): boolean {
  const approachingOrdinal = toProgressOrdinal(tick.routes[history.direction], { platformId: tick.platformId, state: "approaching" });
  return approachingOrdinal !== null && history.latest.ordinal >= approachingOrdinal;
}

export function mergeObservations(tick: TrackingTick): Map<string, TrainHistory> {
  const histories = new Map(tick.histories);
  for (const event of tick.responseEvents.flatMap((events) => toNewestEvents(events, tick.now))) {
    const merged = withEvent(tick, histories.get(event.trainNo), event);
    if (merged) histories.set(merged.trainNo, merged);
  }
  const isHeld = (history: TrainHistory): boolean =>
    tick.now.getTime() - history.lastSeenAt.getTime() <= (isSeenAtOrPastStation(tick, history) ? PASSED_TRAIN_HOLD_MS : MISSING_TRAIN_HOLD_MS);
  return new Map([...histories].filter(([, history]) => isHeld(history)));
}

export function toLiveCountdownRows(sources: readonly SourceCountdownRows[], now: Date): CountdownRow[] {
  return sources.filter((source) => now.getTime() - source.observedAt.getTime() <= MAX_COUNTDOWN_SOURCE_AGE_MS).flatMap((source) => source.rows);
}
