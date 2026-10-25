import type { StopCall } from "../../shared/call.types";
import { toAlightTime, toBoardTime } from "../../shared/call.util";
import type { Departure, DepartureBoard } from "../../shared/departure.types";
import { toKstDate } from "../../shared/kst-date.util";
import type { JourneyOption, RideLeg } from "../journey.document";
import { ESTIMATE_UNCERTAINTY_SEC, MAX_LATER_CALLS, SERVICE_DAY_START_MS, TIGHT_TRANSFER_SEC } from "./journey-routes.constants";
import type { PlanContext, PlannedLeg, PlannedOption, PlannedRide, PlannedStep, PlannedWarning } from "./journey-routes.types";

const MINUTE_MS = 60_000;
const BASIS_RANK: Readonly<Record<StopCall["basis"], number>> = { timetable: 0, provider: 1, estimate: 2 };
const NO_INSTANTS = { expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null };
const UNKNOWN_RUN = { stopsAway: null, runId: null, vehicleId: null, headsign: null, isFirstRun: null, isLastRun: null, isExpress: null, providerText: null };

type Ride = { planned: PlannedRide; boardAtMs: number; alightAtMs: number };

export function toLegBasis(board: StopCall, alight: StopCall): StopCall["basis"] {
  return BASIS_RANK[alight.basis] > BASIS_RANK[board.basis] ? alight.basis : board.basis;
}

const timeMsOf = (call: StopCall): number => toBoardTime(call)?.getTime() ?? Number.NaN;

// WHY: a vehicle with no seat left is skipped; unknown seats count as boardable, as 7800 seats no standing riders (ADR 0022, D7).
function isCatchable({ board }: Departure, readyAtMs: number, { vehicles }: DepartureBoard): boolean {
  return timeMsOf(board) >= readyAtMs && (board.vehicleId === null || vehicles[board.vehicleId]?.seatsLeft !== 0);
}

// WHY: past the source's listed vehicles, the next one comes on average half a headway after the rider is ready (ADR 0022, D7).
function toHeadwayDeparture({ continuation, departures }: DepartureBoard, readyAtMs: number): Departure | null {
  if (continuation.kind !== "headway" || (continuation.serviceEndsAt !== null && readyAtMs >= continuation.serviceEndsAt.getTime())) return null;
  const board: StopCall = { status: "unknown", ...NO_INSTANTS, expectedArrivalAt: new Date(readyAtMs + continuation.headwaySec * 500), basis: "estimate", ...UNKNOWN_RUN };
  return { lineId: departures[0]?.lineId ?? "", board, alight: null, observedAt: null };
}

// WHY: with no alight call from the door, the ride takes the dataset's minutes, as an estimate of this server (ADR 0022, D5).
function toAlight({ board, alight }: Departure, rideMinutes: number): StopCall {
  if (alight) return alight;
  return { ...board, status: "unknown", ...NO_INSTANTS, expectedArrivalAt: new Date(timeMsOf(board) + rideMinutes * MINUTE_MS), basis: "estimate", stopsAway: null, providerText: null };
}

function toRide(leg: RideLeg, board: DepartureBoard, { arrivedAtMs, readyAtMs, line }: { arrivedAtMs: number; readyAtMs: number; line: PlannedRide["line"] }): Ride | null {
  const catchable = board.departures.filter((departure) => isCatchable(departure, readyAtMs, board));
  const boarded = catchable[0] ?? toHeadwayDeparture(board, readyAtMs);
  if (!boarded) return null;
  const alight = toAlight(boarded, leg.rideMinutes);
  const later = catchable.slice(1, 1 + MAX_LATER_CALLS).map((departure) => departure.board);
  const vehicleIds = new Set([boarded.board, alight, ...later].flatMap((call) => call.vehicleId ?? []));
  const vehicles = [...vehicleIds].flatMap((id) => board.vehicles[id] ?? []);
  const boardAtMs = timeMsOf(boarded.board);
  const planned = { leg, line, board: boarded.board, alight, later, vehicles, waitSec: Math.round((boardAtMs - arrivedAtMs) / 1000), observedAt: boarded.observedAt };
  return { planned, boardAtMs, alightAtMs: toAlightTime(alight)?.getTime() ?? Number.NaN };
}

// WHY: the legs before the first ride start as late as the boarding allows, so the option says when to leave.
function timedBack(steps: readonly PlannedStep[], leaveAtMs: number): PlannedStep[] {
  let atMs = leaveAtMs;
  return steps.map((step) => {
    const startAt = new Date(atMs);
    atMs += step.leg.minutes * MINUTE_MS;
    return { ...step, startAt, endAt: new Date(atMs) };
  });
}

type FirstRide = { leaveAtMs: number; boardAtMs: number; nextServiceAt: Date | null };

// WHY: a later ride's next first run is caught by boarding the first ride as much earlier, never before it runs again (ADR 0022, D7).
function toChainNextServiceAt(first: FirstRide | null, endedNextAt: Date | null, readyAtMs: number): Date | null {
  if (first === null || endedNextAt === null) return endedNextAt;
  return new Date(Math.max(endedNextAt.getTime() - (readyAtMs - first.boardAtMs), first.nextServiceAt?.getTime() ?? 0));
}

// WHY: an estimated arrival may come this much later: by the estimate's error, and by half the headway for a ride boarded on one.
function toArrivalUncertaintySec({ board, alight }: PlannedRide, { continuation }: DepartureBoard): number {
  if (toLegBasis(board, alight) !== "estimate") return 0;
  const headwaySec = continuation.kind === "headway" && board.runId === null && board.vehicleId === null ? continuation.headwaySec : 0;
  return ESTIMATE_UNCERTAINTY_SEC + headwaySec / 2;
}

// WHY: a named run's estimated board may come early by its error; a headway names no run to miss, a first ride no ride before it.
function toConnectionWarnings({ board, waitSec }: PlannedRide, arrivingUncertaintySec: number | null, legIndex: number): PlannedWarning[] {
  if (arrivingUncertaintySec === null) return [];
  const isNamedEstimate = board.basis === "estimate" && (board.runId !== null || board.vehicleId !== null);
  const riskSec = Math.max(arrivingUncertaintySec, isNamedEstimate ? ESTIMATE_UNCERTAINTY_SEC : 0);
  const codes = [...(waitSec < TIGHT_TRANSFER_SEC ? ["tightTransfer" as const] : []), ...(waitSec < riskSec ? ["connectionAtRisk" as const] : [])];
  return codes.map((code) => ({ code, legIndex }));
}

// WHY: an option whose next run falls later in this service day has not started; one whose next run is in another, or unknown, has ended.
function toNoService(nextServiceAt: Date | null, now: Date): PlannedOption {
  const [nextDate, nowDate] = [nextServiceAt, now].map((at) => at && toKstDate(new Date(at.getTime() - SERVICE_DAY_START_MS)));
  return { status: "notRunning", reason: nextDate !== null && nextDate === nowDate ? "notStarted" : "ended", nextServiceAt };
}

/** WHY: each ride boards the first run catchable a catch margin after the legs before it (ADR 0022, D5 and D7). */
export function planOption(option: JourneyOption, { now, catchMarginSec, lineById, boards }: PlanContext): PlannedOption {
  const [marginMs, legs]: [number, PlannedLeg[]] = [catchMarginSec * 1000, []];
  let atMs = now.getTime();
  let first: FirstRide | null = null;
  const warnings: PlannedWarning[] = [];
  let arrivingUncertaintySec: number | null = null;
  for (const [index, leg] of option.legs.entries()) {
    if (leg.kind !== "ride") {
      legs.push({ leg, startAt: new Date(atMs), endAt: new Date(atMs + leg.minutes * MINUTE_MS) });
      atMs += leg.minutes * MINUTE_MS;
      continue;
    }
    const [board, line] = [boards.get(index), lineById.get(leg.line)];
    if (!board || board instanceof Error || !line) return { status: "notRunning", reason: "unavailable", nextServiceAt: null };
    const ride = toRide(leg, board, { arrivedAtMs: atMs, readyAtMs: atMs + marginMs, line });
    if (!ride) return toNoService(toChainNextServiceAt(first, board.nextServiceAt, atMs + marginMs), now);
    if (first === null) {
      first = { leaveAtMs: Math.max(now.getTime(), ride.boardAtMs - (atMs - now.getTime()) - marginMs), boardAtMs: ride.boardAtMs, nextServiceAt: board.nextServiceAt };
      legs.splice(0, legs.length, ...timedBack(legs as PlannedStep[], first.leaveAtMs));
      ride.planned.waitSec = Math.round((ride.boardAtMs - (first.leaveAtMs + atMs - now.getTime())) / 1000);
    }
    warnings.push(...toConnectionWarnings(ride.planned, arrivingUncertaintySec, index));
    arrivingUncertaintySec = toArrivalUncertaintySec(ride.planned, board);
    legs.push(ride.planned);
    atMs = ride.alightAtMs;
  }
  return { status: "running", leaveAt: new Date(first === null ? now.getTime() : first.leaveAtMs), arriveAt: new Date(atMs), legs, warnings };
}

/** WHY: no "fastest" flag: running options by arrival, data order breaking a tie, then the rest in data order (ADR 0022, D7). */
export function toOptionOrder(options: readonly PlannedOption[]): number[] {
  const arrivals = options.map((option) => (option.status === "running" ? option.arriveAt.getTime() : Number.POSITIVE_INFINITY));
  const arrivalAt = (index: number): number => arrivals[index] ?? Number.POSITIVE_INFINITY;
  return arrivals.map((_arrival, index) => index).sort((a, b) => arrivalAt(a) - arrivalAt(b) || a - b);
}
