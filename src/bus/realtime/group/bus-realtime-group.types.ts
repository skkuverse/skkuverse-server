import type { JongroRoute } from "../../bus.types";

export interface CachedBus {
  sequence: string;
  carNumber: string;
  estimatedTime: number;
  latitude?: string;
  longitude?: string;
}

export interface CachedArrival {
  stationId: string;
  sequence?: string;
  eta?: string;
}

export type JongroRouteStops = Pick<JongroRoute, "mapping" | "topisIds">;
