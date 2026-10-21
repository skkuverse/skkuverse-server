import type { BusStopArrivals } from "./bus-stop-arrivals.wire";

export type StopArrivalsRoute = BusStopArrivals["routes"][number];
export type StopBlock = BusStopArrivals["stop"];
export type JongroEntry = Extract<StopArrivalsRoute, { arrivals: unknown }>;
export type HsscEntry = Extract<StopArrivalsRoute, { approaching: unknown }>;
export type ShuttleEntry = Extract<StopArrivalsRoute, { kind: "schedule" }>;
export type ScheduledRun = ShuttleEntry["next"][number];
export type Approaching = HsscEntry["approaching"][number];
