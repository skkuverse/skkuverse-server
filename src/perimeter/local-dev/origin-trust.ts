import { OriginTrust, type PerimeterDeps } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

export class LocalDevOriginTrust extends OriginTrust {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "originTrust");
  }

  isCorsOrigin(origin: string): boolean {
    return LOOPBACK_ORIGIN.test(origin);
  }
}
