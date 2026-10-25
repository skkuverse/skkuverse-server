import moment from "moment-timezone";
import type { RunIdentity, StopCall } from "../../../shared/call.types";
import { toCallTime, toTimetabledCall } from "../../../shared/call.util";
import type { Departure, DepartureBoard, DepartureQuery } from "../../../shared/departure.types";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import type { RunStopTime, ShuttleRun } from "../../eta/smart/bus-eta-smart.types";
import type { SequenceStop } from "../../stops/bus-stops.types";
import type { LegStops, LegStopsByRouteType } from "./bus-departures-timetable.types";

const MINUTE_MS = 60_000;
const NO_STOP_TIME: RunStopTime = { shownAt: null, isEstimated: false, latestEstimateAt: null, timetableAt: null };

type Sequences = Readonly<Record<string, readonly SequenceStop[]>>;
type DayEnds = { firstAt: number; lastAt: number };

function toLegStopsOf(sequence: readonly SequenceStop[], boardStopId: string, alightStopId: string | null): LegStops | null {
  const boardIndex = sequence.findIndex((each) => each.stopId === boardStopId);
  const boardStop = sequence[boardIndex];
  if (boardStop === undefined) return null;
  const board = { index: boardIndex, action: boardStop.action };
  if (alightStopId === null) return { board, alight: null };
  const alightIndex = sequence.findIndex((each, index) => index > boardIndex && each.stopId === alightStopId);
  const alightStop = sequence[alightIndex];
  return alightStop === undefined ? null : { board, alight: { index: alightIndex, action: alightStop.action } };
}

/** WHY: a route type serves a leg only when its sequence calls at the board stop and, after it, at the alight stop. */
export function toLegStops(sequences: Sequences | undefined, boardStopId: string, alightStopId: string | null): LegStopsByRouteType {
  const entries = Object.entries(sequences ?? {}).flatMap(([routeType, sequence]) => {
    const legStops = toLegStopsOf(sequence, boardStopId, alightStopId);
    return legStops ? [[routeType, legStops] as const] : [];
  });
  return new Map(entries);
}

export function toKstDayStart(at: Date): Date {
  return moment(at).tz(KST_TIME_ZONE).startOf("day").toDate();
}

// WHY: every route type of the service is one line here (ADR 0022, D7), so a run's first and last are its day's across them.
function toDayEnds(runs: readonly ShuttleRun[]): ReadonlyMap<string, DayEnds> {
  const endsByDate = new Map<string, DayEnds>();
  for (const { date, departureAt } of runs) {
    const ends = endsByDate.get(date);
    const at = departureAt.getTime();
    endsByDate.set(date, ends ? { firstAt: Math.min(ends.firstAt, at), lastAt: Math.max(ends.lastAt, at) } : { firstAt: at, lastAt: at });
  }
  return endsByDate;
}

// WHY: an alight with no time there cannot be placed, so the planner falls back to the leg's ride minutes.
function toDeparture(run: ShuttleRun, { board, alight }: LegStops, identity: RunIdentity): Omit<Departure, "lineId"> {
  const alightCall: StopCall | null = alight && toTimetabledCall(run.stopTimes[alight.index] ?? NO_STOP_TIME, alight.action, identity);
  const boardCall = toTimetabledCall(run.stopTimes[board.index] ?? NO_STOP_TIME, board.action, identity);
  return { board: boardCall, alight: alightCall && toCallTime(alightCall) ? alightCall : null, observedAt: run.estimate?.updatedAt ?? null };
}

/** WHY: the runs that call at both stops, joined by run, by board time; listed from the current minute, as the stop page lists them. */
export function toTimetableBoard(runs: readonly ShuttleRun[], query: DepartureQuery, { legStops, headsign }: { legStops: LegStopsByRouteType; headsign: string }): DepartureBoard {
  const served = runs.flatMap((run) => {
    const stops = legStops.get(run.routeType);
    return stops ? [{ run, stops }] : [];
  });
  const dayEnds = toDayEnds(served.map(({ run }) => run));
  const timed = served.flatMap(({ run, stops }) => {
    const ends = dayEnds.get(run.date);
    const at = run.departureAt.getTime();
    const identity = { runId: run.runId, headsign, isFirstRun: ends?.firstAt === at, isLastRun: ends?.lastAt === at };
    const departure = { lineId: query.lineId, ...toDeparture(run, stops, identity) };
    const boardAt = toCallTime(departure.board);
    return boardAt ? [{ boardAtMs: boardAt.getTime(), departure }] : [];
  });
  timed.sort((a, b) => a.boardAtMs - b.boardAtMs);
  const fromMs = Math.floor(query.from.getTime() / MINUTE_MS) * MINUTE_MS;
  const untilMs = query.until.getTime();
  const departures = timed.filter(({ boardAtMs }) => boardAtMs >= fromMs && boardAtMs <= untilMs).map(({ departure }) => departure);
  const next = timed.find(({ boardAtMs }) => boardAtMs > untilMs);
  return { departures, vehicles: {}, continuation: { kind: "listed" }, nextServiceAt: next ? new Date(next.boardAtMs) : null };
}
