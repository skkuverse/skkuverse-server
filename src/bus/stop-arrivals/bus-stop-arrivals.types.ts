import type { StopCall } from "../bus.types";
import type { BusStopArrivals } from "./bus-stop-arrivals.wire";

export type StopArrivalsRoute = BusStopArrivals["routes"][number];
export type StopBlock = BusStopArrivals["stop"];
export type LiveEntry = Extract<StopArrivalsRoute, { kind: "live" }>;
export type TimetableEntry = Extract<StopArrivalsRoute, { kind: "timetable" }>;
export type TimetableArrival = TimetableEntry["arrivals"][number];
/** WHY: a timetabled run at the stop, which always has its run and its departure from the origin. */
export type RunCall = StopCall & { runId: string; runDepartureAt: Date };
