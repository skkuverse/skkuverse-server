import type { BusStopArrivals } from "./bus-stop-arrivals.wire";

export type StopArrivalsRoute = BusStopArrivals["routes"][number];
export type StopBlock = BusStopArrivals["stop"];
export type LiveEntry = Extract<StopArrivalsRoute, { kind: "live" }>;
export type TimetableEntry = Extract<StopArrivalsRoute, { kind: "timetable" }>;
export type TimetableArrival = TimetableEntry["arrivals"][number];
