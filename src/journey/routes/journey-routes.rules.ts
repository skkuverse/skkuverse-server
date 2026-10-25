import type { StopCall } from "../../shared/call.types";
import { toCallTime } from "../../shared/call.util";
import type { Departure, DepartureBoard } from "../../shared/departure.types";
import type { JourneyOption, RideLeg } from "../journey.document";
import { MAX_LATER_CALLS } from "./journey-routes.constants";
import type { PlanContext, PlannedLeg, PlannedOption, PlannedRide, PlannedStep } from "./journey-routes.types";

const MINUTE_MS = 60_000;
const BASIS_RANK: Readonly<Record<StopCall["basis"], number>> = { timetable: 0, provider: 1, estimate: 2 };
const NO_INSTANTS = { expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null };
const UNKNOWN_RUN = { stopsAway: null, runId: null, vehicleId: null, headsign: null, isFirstRun: null, isLastRun: null, isExpress: null, providerText: null };

type Ride = { planned: PlannedRide; boardAtMs: number; alightAtMs: number };

export function toLegBasis(board: StopCall, alight: StopCall): StopCall["basis"] {
  return BASIS_RANK[alight.basis] > BASIS_RANK[board.basis] ? alight.basis : board.basis;
}

const timeMsOf = (call: StopCall): number => toCallTime(call)?.getTime() ?? Number.NaN;

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
  return { planned, boardAtMs, alightAtMs: timeMsOf(alight) };
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

/** WHY: each ride boards the first run catchable a catch margin after the legs before it (ADR 0022, D5 and D7). */
export function planOption(option: JourneyOption, { now, catchMarginSec, lineById, boards }: PlanContext): PlannedOption {
  const marginMs = catchMarginSec * 1000;
  const legs: PlannedLeg[] = [];
  let atMs = now.getTime();
  let leaveAtMs: number | null = null;
  for (const [index, leg] of option.legs.entries()) {
    if (leg.kind !== "ride") {
      legs.push({ leg, startAt: new Date(atMs), endAt: new Date(atMs + leg.minutes * MINUTE_MS) });
      atMs += leg.minutes * MINUTE_MS;
      continue;
    }
    const board = boards.get(index);
    const line = lineById.get(leg.line);
    if (!board || board instanceof Error || !line) return { status: "notRunning", reason: "unavailable", nextServiceAt: null };
    const ride = toRide(leg, board, { arrivedAtMs: atMs, readyAtMs: atMs + marginMs, line });
    if (!ride) return { status: "notRunning", reason: "ended", nextServiceAt: board.nextServiceAt };
    if (leaveAtMs === null) {
      leaveAtMs = Math.max(now.getTime(), ride.boardAtMs - (atMs - now.getTime()) - marginMs);
      legs.splice(0, legs.length, ...timedBack(legs as PlannedStep[], leaveAtMs));
      ride.planned.waitSec = Math.round((ride.boardAtMs - (leaveAtMs + atMs - now.getTime())) / 1000);
    }
    legs.push(ride.planned);
    atMs = ride.alightAtMs;
  }
  return { status: "running", leaveAt: new Date(leaveAtMs ?? now.getTime()), arriveAt: new Date(atMs), legs };
}

/** WHY: no "fastest" flag: running options by arrival, data order breaking a tie, then the rest in data order (ADR 0022, D7). */
export function toOptionOrder(options: readonly PlannedOption[]): number[] {
  const arrivals = options.map((option) => (option.status === "running" ? option.arriveAt.getTime() : Number.POSITIVE_INFINITY));
  const arrivalAt = (index: number): number => arrivals[index] ?? Number.POSITIVE_INFINITY;
  return arrivals.map((_arrival, index) => index).sort((a, b) => arrivalAt(a) - arrivalAt(b) || a - b);
}
