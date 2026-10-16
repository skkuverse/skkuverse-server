import { captureGroups } from "../../shared/regex.util";
import type { CountdownRow, SubwayDirection, TrainEvent } from "../subway.types";
import type { TimetableTrain } from "../timetable/subway-timetable.types";
import { MAX_COUNTDOWN_SOURCE_AGE_MS, MAX_ROW_AHEAD_MS, MISSING_TRAIN_HOLD_MS, STATE_STEPS } from "./subway-tracking.constants";
import type { SourceCountdownRows, TrackingTick, TrainHistory, TrainProgress } from "./subway-tracking.types";

const TRAIN_NO = /^[A-Z]*(\d{1,4})$/;
const TRAIN_NO_DIGITS = 4;
const STATES_PER_STATION = Object.keys(STATE_STEPS).length;

export function toTrainNo(raw: string): string | null {
  const groups = captureGroups(raw, TRAIN_NO, 1);
  return groups ? groups[0].padStart(TRAIN_NO_DIGITS, "0") : null;
}

export function toProgressOrdinal(route: readonly string[], event: Pick<TrainEvent, "stationId" | "state">): number | null {
  const stationIndex = route.indexOf(event.stationId);
  return stationIndex < 0 ? null : STATES_PER_STATION * stationIndex + STATE_STEPS[event.state];
}

// WHY: both operators number up trains even and down trains odd (every train of the committed timetables);
// a destination the timetables name decides first.
export function toDirection(
  train: Pick<TrainEvent, "trainNo" | "destination">,
  directionByDestination: ReadonlyMap<string, SubwayDirection>,
): SubwayDirection {
  return directionByDestination.get(train.destination) ?? (Number(train.trainNo) % 2 === 0 ? "up" : "down");
}

export function toDirectionByDestination(
  trains: readonly Pick<TimetableTrain, "direction" | "destination">[],
): Map<string, SubwayDirection> {
  return new Map(trains.map((train) => [train.destination, train.direction]));
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
  const ordinal = toProgressOrdinal(tick.routes[direction], event);
  if (ordinal === null) return null;
  const candidate = { stationId: event.stationId, state: event.state, at: event.stateChangedAt, ordinal };
  const latest = known ? toLatestProgress(known.latest, candidate) : candidate;
  const destination = latest === candidate || !known ? event.destination : known.destination;
  return { trainNo: event.trainNo, direction, destination, latest, lastSeenAt: tick.now };
}

export function mergeObservations(tick: TrackingTick): Map<string, TrainHistory> {
  const histories = new Map(tick.histories);
  for (const event of tick.responseEvents.flatMap((events) => toNewestEvents(events, tick.now))) {
    const merged = withEvent(tick, histories.get(event.trainNo), event);
    if (merged) histories.set(merged.trainNo, merged);
  }
  const isHeld = (history: TrainHistory): boolean => tick.now.getTime() - history.lastSeenAt.getTime() <= MISSING_TRAIN_HOLD_MS;
  return new Map([...histories].filter(([, history]) => isHeld(history)));
}

export function toLiveCountdownRows(sources: readonly SourceCountdownRows[], now: Date): CountdownRow[] {
  return sources.filter((source) => now.getTime() - source.observedAt.getTime() <= MAX_COUNTDOWN_SOURCE_AGE_MS).flatMap((source) => source.rows);
}
