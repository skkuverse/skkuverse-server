import { Injectable } from "@nestjs/common";
import { BusRealtimeGbisService } from "../../realtime/gbis/bus-realtime-gbis.service";
import { BusRealtimeGroupService } from "../../realtime/group/bus-realtime-group.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import type { LiveGroup } from "../bus-live.wire";
import { toLiveJongroGroup, withSeatsLeft } from "./bus-live-jongro.mapper";

@Injectable()
export class BusLiveJongroService {
  constructor(
    private readonly realtime: BusRealtimeGroupService,
    private readonly stops: BusStopsService,
    private readonly seats: BusRealtimeGbisService,
  ) {}

  // WHY: from the realtime view's own reads (ADR 0019); the bus-stops aliases name each pole's stop (ADR 0019, D5), so
  // stops never read answer their 503, and GBIS's seats join by vehicle id (D17). Null for a group that is no Jongno route.
  async findLiveGroup(groupId: string): Promise<LiveGroup | null> {
    const reading = await this.realtime.findJongroReading(groupId);
    if (!reading) return null;
    const group = toLiveJongroGroup(groupId, reading, await this.stops.current());
    return withSeatsLeft(group, await this.seats.findSeatsLeft(groupId));
  }
}
