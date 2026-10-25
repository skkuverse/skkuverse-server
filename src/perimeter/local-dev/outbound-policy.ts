import type { AxiosRequestConfig } from "axios";
import { OutboundPolicy, type PerimeterDeps } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

export class LocalDevOutboundPolicy extends OutboundPolicy {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "outboundPolicy");
  }

  allows(_purpose: string, url: string): boolean {
    return URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol);
  }

  requestConfig(): AxiosRequestConfig {
    return {};
  }

  isBlocked(): boolean {
    return false;
  }
}
