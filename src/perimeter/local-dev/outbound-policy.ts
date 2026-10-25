import type { AxiosRequestConfig } from "axios";
import { guardedPublicRequestConfig, isOutboundBlocked } from "../../shared/outbound-guard.util";
import { parseOutboundUrl } from "../../shared/outbound-url.util";
import { OutboundPolicy, type PerimeterDeps } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

// WHY: no domain allowlist, which is production policy; the address checks stay, so a local server is no SSRF relay.
export class LocalDevOutboundPolicy extends OutboundPolicy {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "outboundPolicy");
  }

  allows(_purpose: string, url: string): boolean {
    return parseOutboundUrl(url) !== null;
  }

  requestConfig(): AxiosRequestConfig {
    return guardedPublicRequestConfig();
  }

  isBlocked(err: unknown): boolean {
    return isOutboundBlocked(err);
  }
}
