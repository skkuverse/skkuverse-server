import { captureGroups } from "../../shared/regex.util";
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

export function toProgressOrdinal(route: readonly string[], event: Pick<TrainEvent, "stationId" | "state">): number | null {
  const stationIndex = route.indexOf(event.stationId);
  return stationIndex < 0 ? null : toOrdinal(stationIndex, event.state);
}

// WHY: a station a train's row does not call at, which an express passes, has no scheduled time to measure a
// delay against (design D4); a train seen there has left its last stop before it, at the latest at that time.
function toStopProgress(route: readonly string[], stopStationIds: readonly string[] | undefined, event: TrainEvent): TrainProgress | null {
  const stationIndex = route.indexOf(event.stationId);
  const at = event.stateChangedAt;
  if (stationIndex < 0) return null;
  if (!stopStationIds || stopStationIds.includes(event.stationId)) return { stationId: event.stationId, state: event.state, at, ordinal: toOrdinal(stationIndex, event.state) };
  const lastStopId = route.slice(0, stationIndex).filter((stationId) => stopStationIds.includes(stationId)).at(-1);
  return lastStopId === undefined ? null : { stationId: lastStopId, state: "departed", at, ordinal: toOrdinal(route.indexOf(lastStopId), "departed") };
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

export function toStopStationIdsByTrainNo(trains: readonly Pick<ScheduledTrain, "trainNo" | "stops">[]): Map<string, string[]> {
  return new Map(trains.map((train) => [train.trainNo, train.stops.map((stop) => stop.stationId)]));
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
  const candidate = toStopProgress(tick.routes[direction], tick.stopStationIdsByTrainNo.get(event.trainNo), event);
  if (candidate === null) return null;
  const latest = known ? toLatestProgress(known.latest, candidate) : candidate;
  const destination = latest === candidate || !known ? event.destination : known.destination;
  return { trainNo: event.trainNo, direction, destination, latest, lastSeenAt: tick.now };
}

function hasPassedStation(tick: TrackingTick, history: TrainHistory): boolean {
  const departedOrdinal = toProgressOrdinal(tick.routes[history.direction], { stationId: tick.stationId, state: "departed" });
  return departedOrdinal !== null && history.latest.ordinal >= departedOrdinal;
}

export function mergeObservations(tick: TrackingTick): Map<string, TrainHistory> {
  const histories = new Map(tick.histories);
  for (const event of tick.responseEvents.flatMap((events) => toNewestEvents(events, tick.now))) {
    const merged = withEvent(tick, histories.get(event.trainNo), event);
    if (merged) histories.set(merged.trainNo, merged);
  }
  const isHeld = (history: TrainHistory): boolean =>
    tick.now.getTime() - history.lastSeenAt.getTime() <= (hasPassedStation(tick, history) ? PASSED_TRAIN_HOLD_MS : MISSING_TRAIN_HOLD_MS);
  return new Map([...histories].filter(([, history]) => isHeld(history)));
}

export function toLiveCountdownRows(sources: readonly SourceCountdownRows[], now: Date): CountdownRow[] {
  return sources.filter((source) => now.getTime() - source.observedAt.getTime() <= MAX_COUNTDOWN_SOURCE_AGE_MS).flatMap((source) => source.rows);
}
