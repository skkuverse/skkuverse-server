import moment from "moment-timezone";
import type { StopCall } from "../../../shared/call.types";
import { toCallTime } from "../../../shared/call.util";
import type { Departure, DepartureBoard, DepartureContinuation, DepartureQuery } from "../../../shared/departure.types";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import type { JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { LiveGroup, LiveStation } from "../../live/bus-live.wire";
import type { IndexedStop } from "../../stop-index/bus-stop-index.types";
import { toBoardVehicles, toFirstRunCall, toInstant, toStopCall } from "./bus-departures-topis.mapper";
import type { BoardHours, ServiceSpan, TopisLegStations, TopisRide } from "./bus-departures-topis.types";

const DAY_MS = 86_400_000;
const MINUTE_SEC = 60;

type TopisBoardInput = { group: LiveGroup; row: JongroArrivalDoc | undefined; legStations: TopisLegStations; query: DepartureQuery };

/** WHY: an index placed by another stations version would read another stop's arrivals, so it places nothing. */
export function toRouteStationIndexes(stop: Pick<IndexedStop, "routes"> | null, groupId: string, stationsVersion: string | null): number[] {
  return (stop?.routes ?? []).flatMap((route) => (route.kind === "jongro" && route.groupId === groupId && route.stationsVersion === stationsVersion ? [route.stationIndex] : []));
}

// WHY: a loop calls at a stop twice (route 02 lists its terminal twice), so the ride takes the nearest alight station after a board one.
export function toLegStations(boardIndexes: readonly number[], alightIndexes: readonly number[] | null): TopisLegStations | null {
  if (alightIndexes === null) return boardIndexes[0] === undefined ? null : { boardIndex: boardIndexes[0], alightIndex: null };
  const pairs = boardIndexes.flatMap((boardIndex) => alightIndexes.filter((alightIndex) => alightIndex > boardIndex).map((alightIndex) => ({ boardIndex, alightIndex })));
  pairs.sort((a, b) => a.alightIndex - a.boardIndex - (b.alightIndex - b.boardIndex));
  return pairs[0] ?? null;
}

const routeVersionOf = (stop: Pick<IndexedStop, "routes"> | null, groupId: string): string | null =>
  stop?.routes.flatMap((route) => (route.kind === "jongro" && route.groupId === groupId ? [route.stationsVersion] : []))[0] ?? null;

/** WHY: the push refuses a ride this door could not place, by the same stop index and pairing (ADR 0022, D4). */
export function toTopisRideIssue(stopOf: (stopId: string) => Pick<IndexedStop, "routes"> | null, { lineId, boardStopId, alightStopId }: TopisRide): string | null {
  const [boardStop, alightStop] = [stopOf(boardStopId), stopOf(alightStopId)];
  const [boardIndexes, alightIndexes] = [toRouteStationIndexes(boardStop, lineId, routeVersionOf(boardStop, lineId)), toRouteStationIndexes(alightStop, lineId, routeVersionOf(alightStop, lineId))];
  const offRoute = [boardIndexes.length === 0 ? [boardStopId] : [], alightIndexes.length === 0 ? [alightStopId] : []].flat();
  if (offRoute.length > 0) return `${lineId} does not call at ${offRoute.join(" or ")}`;
  return toLegStations(boardIndexes, alightIndexes) === null ? `${lineId} does not call at ${boardStopId} and then at ${alightStopId}` : null;
}

const kstDayStartMs = (ms: number): number => moment(ms).tz(KST_TIME_ZONE).startOf("day").valueOf();
const toLaterSpan = ({ startsAt, endsAt }: ServiceSpan, days: number): ServiceSpan => ({ startsAt: new Date(startsAt.getTime() + days * DAY_MS), endsAt: new Date(endsAt.getTime() + days * DAY_MS) });

// QUIRK(topis): firstTm and lastTm carry the date of TOPIS's own service day, which may lag the rider's, so only their
// time of day is read; the span is the stop's service day ending at or after `at`.
export function toServiceSpan({ firstTm, lastTm }: Pick<JongroArrivalDoc, "firstTm" | "lastTm">, at: Date): ServiceSpan | null {
  if (firstTm === undefined || lastTm === undefined) return null;
  const [firstMs, lastMs] = [Date.parse(firstTm), Date.parse(lastTm)];
  const firstDayMs = kstDayStartMs(firstMs);
  const dayBeforeMs = kstDayStartMs(at.getTime()) - DAY_MS;
  const dayBefore = { startsAt: new Date(dayBeforeMs + firstMs - firstDayMs), endsAt: new Date(dayBeforeMs + lastMs - firstDayMs + (lastMs < firstMs ? DAY_MS : 0)) };
  const days = [0, 1, 2].find((offset) => toLaterSpan(dayBefore, offset).endsAt.getTime() >= at.getTime()) ?? 2;
  return toLaterSpan(dayBefore, days);
}

const callsAt = (stations: readonly LiveStation[], stationIndex: number | null): StopCall[] =>
  (stations.find((station) => station.stationIndex === stationIndex)?.arrivals ?? []).map(toStopCall);
const timeMsOf = (call: StopCall): number => toCallTime(call)?.getTime() ?? Number.NaN;

function toPredictedDepartures({ group, legStations, query }: TopisBoardInput): Departure[] {
  const observedAt = toInstant(group.updatedAt);
  const alightCalls = callsAt(group.stations, legStations.alightIndex);
  return callsAt(group.stations, legStations.boardIndex)
    .filter((board) => board.vehicleId !== null && timeMsOf(board) <= query.until.getTime())
    .map((board) => {
      const alight = alightCalls.find((call) => call.vehicleId === board.vehicleId && timeMsOf(call) > timeMsOf(board)) ?? null;
      return { lineId: query.lineId, board, alight, observedAt };
    });
}

// WHY: TOPIS's end-of-service text at the board station ends its day early, so the next span is the next day's.
function toActiveSpan(row: JongroArrivalDoc | undefined, isEnded: boolean, from: Date): ServiceSpan | null {
  const span = row ? toServiceSpan(row, from) : null;
  return span && isEnded && span.startsAt.getTime() <= from.getTime() ? toLaterSpan(span, 1) : span;
}

function toContinuation(term: number | undefined, isServing: boolean, serviceEndsAt: Date | null): DepartureContinuation {
  return term !== undefined && isServing ? { kind: "headway", headwaySec: term * MINUTE_SEC, serviceEndsAt } : { kind: "listed" };
}

// WHY: a stop with no first and last run stored serves a headway until TOPIS says the service ended, and names no next run.
function toBoardHours(row: JongroArrivalDoc | undefined, isEnded: boolean, { from, until }: DepartureQuery): BoardHours {
  const span = toActiveSpan(row, isEnded, from);
  if (span === null) return { firstRunAt: null, continuation: toContinuation(row?.term, !isEnded, null), nextServiceAt: null };
  const isServing = span.startsAt.getTime() <= until.getTime();
  const firstRunAt = isServing && span.startsAt.getTime() > from.getTime() ? span.startsAt : null;
  return { firstRunAt, continuation: toContinuation(row?.term, isServing, span.endsAt), nextServiceAt: isServing ? toLaterSpan(span, 1).startsAt : span.startsAt };
}

/**
 * WHY: TOPIS predicts two vehicles a stop and nothing past them, so the board lists those and, while the stop's service
 * day runs, a headway from `term`; without `term` it extrapolates nothing (ADR 0022, D7). SEE: docs/plans/transit-route-planner.md ("The doors")
 */
export function toTopisBoard(input: TopisBoardInput): DepartureBoard {
  const { group, row, legStations, query } = input;
  const boardStation = group.stations.find((station) => station.stationIndex === legStations.boardIndex);
  const hours = toBoardHours(row, boardStation?.operation === "ended", query);
  const predicted = toPredictedDepartures(input);
  const headsign = boardStation?.arrivals[0]?.headsign ?? null;
  const firstRuns = hours.firstRunAt === null ? [] : [{ lineId: query.lineId, board: toFirstRunCall(hours.firstRunAt, headsign), alight: null, observedAt: null }];
  const departures = [...firstRuns, ...predicted].sort((a, b) => timeMsOf(a.board) - timeMsOf(b.board));
  return { departures, vehicles: toBoardVehicles(group.vehicles, predicted), continuation: hours.continuation, nextServiceAt: hours.nextServiceAt };
}
