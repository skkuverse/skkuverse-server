import type { LatLng } from "../../shared/lat-lng.types";

export interface EtaRun {
  serviceId: string;
  routeType: string;
  /** WHY: YYYY-MM-DD in KST. */
  date: string;
  /** WHY: HH:mm, the departure from the first stop. */
  time: string;
  departAt: Date;
}

export interface EtaSequence {
  serviceId: string;
  routeType: string;
  stops: LatLng[];
}

export type RunKey = Pick<EtaRun, "serviceId" | "routeType" | "date" | "time">;

export type SequenceLength = (serviceId: string, routeType: string) => number | undefined;

export interface UpsertResult {
  written: number;
  skippedFrozen: number;
}

export interface SequenceRef {
  serviceId: string;
  routeType: string;
  sequenceLength: number;
}

export interface OffsetCheck {
  routeTotal: number;
  maxMismatch: number;
  unit: "s" | "ms";
}

export type DirectionsProvider = "naver" | "tmap";

// WHY: "auth" is a revoked or wrong key (401/403), which no retry fixes; "api" an HTTP 200 whose body reports a
// failure; "implausible" a route the clients' plausibility checks refuse.
export type DirectionsFailure = "auth" | "http" | "timeout" | "reset" | "network" | "api" | "implausible";
