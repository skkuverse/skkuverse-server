import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: the route renders it as a 503 and the poller tick rejects with it. Nothing falls back
// to the snapshot, which may be months old (improve-jongro-realtime D7).
export class BusRegistryMissingError extends AppError {
  constructor(readonly routeId: string) {
    super("JONGRO_REGISTRY_UNAVAILABLE", `The station registry of ${routeId} is unavailable`, 503);
    this.name = "BusRegistryMissingError";
  }
}
