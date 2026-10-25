import { AbuseSignals, type AbuseSignal, type PerimeterDeps } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

export class LocalDevAbuseSignals extends AbuseSignals {
  constructor(private readonly deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "abuseSignals");
  }

  report({ kind, request, principal }: AbuseSignal): void {
    this.deps.logger.info({ event: "perimeter.abuse_signal", kind, method: request.method, principal: principal?.kind }, "Abuse signal");
  }
}
