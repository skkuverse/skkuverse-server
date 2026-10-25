import type { StopCall } from "../../shared/call.types";
import type { DepartureBoard } from "../../shared/departure.types";
import type { Vehicle } from "../../shared/vehicle.wire";
import type { JourneyLine, RideLeg, TransferLeg, WalkLeg } from "../journey.document";
import type { JourneyRoutes } from "./journey-routes.wire";

export type ServedRoute = JourneyRoutes["routes"][number];
export type ServedOption = ServedRoute["options"][number];
export type ServedLeg = ServedOption["legs"][number];

/** WHY: a place as a leg cites it, a platform being part of where a subway leg starts or ends. */
export interface CitedLegPlace {
  ref: string;
  platformId: string | null;
}

/** WHY: an option's ride legs' boards by leg index; an Error where the door could not answer. */
export type LegBoards = ReadonlyMap<number, DepartureBoard | Error>;

export interface PlanContext {
  now: Date;
  catchMarginSec: number;
  lineById: ReadonlyMap<string, JourneyLine>;
  boards: LegBoards;
}

export interface PlannedStep {
  leg: WalkLeg | TransferLeg;
  startAt: Date;
  endAt: Date;
}

export interface PlannedRide {
  leg: RideLeg;
  line: JourneyLine;
  board: StopCall;
  alight: StopCall;
  later: StopCall[];
  vehicles: Vehicle[];
  waitSec: number;
  observedAt: Date | null;
}

export type PlannedLeg = PlannedStep | PlannedRide;

export type PlannedOption =
  | { status: "running"; leaveAt: Date; arriveAt: Date; legs: PlannedLeg[] }
  | { status: "notRunning"; reason: "ended" | "notStarted" | "unavailable"; nextServiceAt: Date | null };
