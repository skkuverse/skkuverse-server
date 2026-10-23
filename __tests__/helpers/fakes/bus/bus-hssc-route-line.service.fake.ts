/**
 * Scripted BusHsscRouteLineService for the map: `findCurrent` answers `routeLine`, null meaning no good line was
 * ever read (the real service has logged why).
 */
import type { BusHsscRouteLineService } from "../../../../src/bus/hssc-route-line/bus-hssc-route-line.service";
import type { HsscRouteLine } from "../../../../src/bus/hssc-route-line/bus-hssc-route-line.types";
import type { PublicOf } from "../public-of";

export class FakeBusHsscRouteLineService implements PublicOf<BusHsscRouteLineService> {
  routeLine: HsscRouteLine | null = null;

  async findCurrent(): Promise<HsscRouteLine | null> {
    return structuredClone(this.routeLine);
  }
}
