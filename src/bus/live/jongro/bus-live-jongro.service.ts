import { Injectable } from "@nestjs/common";
import { BusRealtimeGroupService } from "../../realtime/group/bus-realtime-group.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import type { LiveGroup } from "../bus-live.wire";
import { toLiveJongroGroup } from "./bus-live-jongro.mapper";

@Injectable()
export class BusLiveJongroService {
  constructor(
    private readonly realtime: BusRealtimeGroupService,
    private readonly stops: BusStopsService,
  ) {}

  // WHY: from the realtime view's own reads (ADR 0019); the bus-stops aliases name each pole's stop (ADR 0019, D5), so
  // stops never read answer their 503. Null for a group that is not a Jongno route.
  async findLiveGroup(groupId: string): Promise<LiveGroup | null> {
    const reading = await this.realtime.findJongroReading(groupId);
    if (!reading) return null;
    const { stopIdByArsId } = await this.stops.current();
    return toLiveJongroGroup(groupId, reading, stopIdByArsId);
  }
}
