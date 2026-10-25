import type { StopCall } from "../../../shared/call.types";
import { toAlightTime, toBoardTime } from "../../../shared/call.util";
import type { Departure, DepartureBoard, DepartureQuery } from "../../../shared/departure.types";
import type { NetworkPlatform } from "../../subway.types";
import { SERVICE_DAY_START_HOUR } from "../subway-timetable.constants";
import { findSubwayPlatform, findTimetable, toDayType, toLineRoutes, toPlatformTimetableKey, toScheduledTrains, toServiceInstant } from "../subway-timetable.rules";
import type { PlatformSchedule, ScheduledStop, Timetable } from "../subway-timetable.types";
import type { LegTrain, SubwayRide } from "./subway-timetable-departures.types";

const HOUR_SEC = 3600;
// WHY: a Monday, a Saturday and a Sunday, so toDayType picks every table a platform's source declares for the push check.
const SAMPLE_SERVICE_DATES = ["2026-01-05", "2026-01-10", "2026-01-11"] as const;

type Run = Pick<StopCall, "runId" | "headsign" | "isFirstRun" | "isLastRun" | "isExpress">;

const boardTimeOf = (stop: ScheduledStop): Date | null => stop.departureAt ?? stop.arrivalAt;
const alightTimeOf = (stop: ScheduledStop): Date | null => stop.arrivalAt ?? stop.departureAt;
const msOf = (at: Date | null): number => at?.getTime() ?? Number.NaN;

function isAfter(alight: ScheduledStop | undefined, board: ScheduledStop): alight is ScheduledStop {
  const [alightAt, boardAt] = [alight && alightTimeOf(alight), boardTimeOf(board)];
  return !!alightAt && !!boardAt && alightAt > boardAt;
}

// WHY: one table holds a train in one row, joined by its index (a trainset line reuses a number within a day); two
// tables share only the number, and a train they number apart still serves the ride, with no alight stop.
export function toLegTrains(board: PlatformSchedule, alight: PlatformSchedule): LegTrain[] {
  const isOneTable = toPlatformTimetableKey(board.platform, board.dayType) === toPlatformTimetableKey(alight.platform, alight.dayType);
  const alightRowByTrainNo = new Map(alight.trains.map((row) => [row.trainNo, row]));
  const candidates = board.trains.flatMap((train, index) => {
    const boardStop = train.stops.find((stop) => stop.platformId === board.platform.id);
    if (!boardStop || !boardTimeOf(boardStop)) return [];
    const alightRow = isOneTable ? alight.trains[index] : alightRowByTrainNo.get(train.trainNo);
    const alightStop = alightRow?.stops.find((stop) => stop.platformId === alight.platform.id);
    return [{ train, boardStop, alightStop: isAfter(alightStop, boardStop) ? alightStop : null }];
  });
  const joinedDirections = new Set(candidates.flatMap((each) => (each.alightStop ? [each.train.direction] : [])));
  const served = candidates.filter((each) => each.alightStop !== null || (!isOneTable && joinedDirections.has(each.train.direction)));
  return served.sort((a, b) => (boardTimeOf(a.boardStop)?.getTime() ?? 0) - (boardTimeOf(b.boardStop)?.getTime() ?? 0));
}

// SEE: docs/decisions/0022-journey-and-call-spec.md ("D2. The call"): the call the subway board serves for a timetable train.
function toTimetableCall(stop: ScheduledStop, run: Run): StopCall {
  return {
    ...{ status: "scheduled", expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: stop.arrivalAt, scheduledDepartureAt: stop.departureAt },
    ...{ basis: "timetable", stopsAway: null, vehicleId: null, providerText: null, ...run },
  };
}

// WHY: a stored train boards by the station board's call, the ride's flags kept; its delay there carries to the alight (ADR 0017, D5).
function withLiveBoard(departure: Departure, live: StopCall | undefined): Departure {
  const { board, alight } = departure;
  if (live === undefined || live.basis === "timetable") return departure;
  const delayMs = msOf(live.expectedArrivalAt) - msOf(toAlightTime(board));
  const lateAlight = alight && delayMs > 0 ? { ...alight, expectedArrivalAt: new Date(msOf(toAlightTime(alight)) + delayMs), basis: "estimate" as const } : alight;
  return { ...departure, board: { ...live, isFirstRun: board.isFirstRun, isLastRun: board.isLastRun }, alight: lateAlight };
}

type BoardWindow = Pick<DepartureQuery, "lineId" | "from" | "until"> & { liveCalls?: readonly StopCall[] };

/** WHY: the ride's trains boarding from the query's instant to its end, a stored one by its live call (withLiveBoard). */
export function toTimetableDepartureBoard(board: PlatformSchedule, alight: PlatformSchedule, query: BoardWindow): DepartureBoard {
  const legTrains = toLegTrains(board, alight);
  const liveByRunId = new Map((query.liveCalls ?? []).map((call) => [call.runId, call]));
  const timed = legTrains.map(({ train, boardStop, alightStop }, index) => {
    const runId = `${board.platform.line}/${board.serviceDate}/${train.trainNo}`;
    const run = { runId, headsign: train.destination, isFirstRun: index === 0, isLastRun: index === legTrains.length - 1, isExpress: train.express };
    const timetabled: Departure = { lineId: query.lineId, board: toTimetableCall(boardStop, run), alight: alightStop && toTimetableCall(alightStop, run), observedAt: null };
    const departure = withLiveBoard(timetabled, liveByRunId.get(runId));
    return { boardAtMs: toBoardTime(departure.board)?.getTime() ?? Number.NaN, departure };
  });
  const [fromMs, untilMs] = [query.from.getTime(), query.until.getTime()];
  const departures = timed.filter(({ boardAtMs }) => boardAtMs >= fromMs && boardAtMs <= untilMs).map(({ departure }) => departure);
  const next = timed.find(({ boardAtMs }) => boardAtMs > untilMs);
  return { departures, vehicles: {}, continuation: { kind: "listed" }, nextServiceAt: next ? new Date(next.boardAtMs) : null };
}

export function toNextServiceDayStart(serviceDate: string): Date {
  return toServiceInstant(serviceDate, (24 + SERVICE_DAY_START_HOUR) * HOUR_SEC);
}

function toSampleSchedule(tables: readonly Timetable[], platform: NetworkPlatform, serviceDate: string): PlatformSchedule | string {
  const dayType = toDayType(platform.timetable.source, serviceDate, false);
  const table = findTimetable(tables, platform, dayType);
  if (!table) return `no ${dayType} table for ${platform.id}`;
  return { platform, serviceDate, dayType, lineRoutes: toLineRoutes(table), trains: toScheduledTrains(table, serviceDate) };
}

function toPlatformIssue(platformId: string, lineId: string): NetworkPlatform | string {
  const platform = findSubwayPlatform(platformId);
  if (!platform) return `${platformId} is no platform the checkout serves`;
  return platform.line === lineId ? platform : `${platformId} is a platform of line ${platform.line}, not of line ${lineId}`;
}

/** WHY: at push, a ride's platforms are on its line and every day type's tables run a train from one to the other (ADR 0022, D4). */
export function toRideTimetableIssue(tables: readonly Timetable[], { lineId, boardPlatformId, alightPlatformId }: SubwayRide): string | null {
  const [board, alight] = [toPlatformIssue(boardPlatformId, lineId), toPlatformIssue(alightPlatformId, lineId)];
  if (typeof board === "string" || typeof alight === "string") return typeof board === "string" ? board : (alight as string);
  for (const serviceDate of SAMPLE_SERVICE_DATES) {
    const [boardSchedule, alightSchedule] = [toSampleSchedule(tables, board, serviceDate), toSampleSchedule(tables, alight, serviceDate)];
    if (typeof boardSchedule === "string" || typeof alightSchedule === "string") return typeof boardSchedule === "string" ? boardSchedule : (alightSchedule as string);
    if (!toLegTrains(boardSchedule, alightSchedule).some((each) => each.alightStop !== null)) return `no ${boardSchedule.dayType} train runs from ${board.id} to ${alight.id}`;
  }
  return null;
}
