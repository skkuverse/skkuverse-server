/**
 * Scripted BusLiveHsscService: the HSSC live group set in `group`, which a test sets before it is read.
 */
import type { BusLiveHsscService } from "../../../../src/bus/live/hssc/bus-live-hssc.service";
import type { LiveGroup } from "../../../../src/bus/live/bus-live.wire";
import type { PublicOf } from "../public-of";

export class FakeBusLiveHsscService implements PublicOf<BusLiveHsscService> {
  group: LiveGroup = { groupId: "hssc", stationsVersion: null, updatedAt: null, operation: "noData", vehicles: [], stations: [] };

  async findLiveGroup(): Promise<LiveGroup> {
    return structuredClone(this.group);
  }
}
