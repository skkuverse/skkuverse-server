import type { JongroRoute, JongroRouteAttributes, TransferLine } from "../bus.types";
import type { RegistryStation } from "./bus-registry.document";

export type ObservedStation = Omit<RegistryStation, "sequence">;

/** WHY: what a sync reads from a cached arrival row. */
export type ArrivalRowStation = Record<"stationId" | "sequence" | "stationName" | "stationNumber", string>;

export interface JongroStation {
  sequence: string;
  stationName: string;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  transferLines: TransferLine[];
}

export type JongroStationMapping = Record<string, { sequence: number; stationName: string }>;

export interface RegistryRoute extends JongroRoute, JongroRouteAttributes {
  readonly stationsVersion: string;
  readonly turnaroundTopisId: string;
  readonly registryStations: ReadonlyArray<RegistryStation>;
  readonly stations: ReadonlyArray<JongroStation>;
  readonly mapping: Readonly<JongroStationMapping>;
  readonly topisIds: ReadonlyArray<string>;
}

export type StationAt = Pick<RegistryStation, "topisId" | "stationName"> & { ord: number };
export type MovedStation = Pick<RegistryStation, "topisId" | "stationName"> & { fromOrd: number; toOrd: number };
export type RenamedStation = Pick<RegistryStation, "topisId"> & { ord: number; fromName: string; toName: string };
export type StationDiff = Record<"added" | "removed", StationAt[]> & { moved: MovedStation[]; renamed: RenamedStation[] };

/** WHY: the differing list the last ticks agreed on, and how many ticks in a row saw it. */
export interface PendingObservation {
  stationsVersion: string;
  count: number;
}

export interface SyncObservation {
  storedVersion: string;
  observedVersion: string;
  pending: PendingObservation | undefined;
  changedShare: number;
}

export type SyncDecision =
  | { kind: "unchanged" }
  | { kind: "pending"; pending: PendingObservation }
  | { kind: "hold"; pending: PendingObservation }
  | { kind: "apply" };

export interface BootstrapObservation {
  stations: readonly ObservedStation[];
  turnaroundTopisId: string | null;
  pending: PendingObservation | undefined;
}

export type BootstrapDecision =
  | { kind: "skip" }
  | { kind: "pending"; pending: PendingObservation }
  | { kind: "insert"; stationsVersion: string; turnaroundTopisId: string };
