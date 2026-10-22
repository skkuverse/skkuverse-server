import { AppError } from "../../http/app.error";
import { OBSERVATIONS_TO_APPLY } from "./bus-registry.constants";

// WHY: an answer, not a fault: the route renders it as a 503, and the poller bootstraps the route instead. Nothing
// serves a committed list, which may be months old (ADR 0012, D3).
export class BusRegistryMissingError extends AppError {
  constructor(readonly routeId: string) {
    super("JONGRO_REGISTRY_UNAVAILABLE", `The station registry of ${routeId} is unavailable`, 503);
    this.name = "BusRegistryMissingError";
  }
}

// WHY: the poller's tick rejects while it bootstraps a missing route, so poller.failing alerts on a route that stays
// missing (overnight, or TOPIS disagreeing) and poller.recovered marks the insert.
export class BusRegistryBootstrappingError extends Error {
  constructor(
    readonly routeId: string,
    readonly observationCount: number,
  ) {
    super(`The station registry of ${routeId} is missing; bootstrapping it from TOPIS (${observationCount} of ${OBSERVATIONS_TO_APPLY} identical observations)`);
    this.name = "BusRegistryBootstrappingError";
  }
}
