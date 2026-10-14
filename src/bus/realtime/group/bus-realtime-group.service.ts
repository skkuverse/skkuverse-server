import { Injectable } from "@nestjs/common";
import { AppError } from "../../../http/app.error";
import { withMeta } from "../../../http/response.interceptor";
import type { WithMeta } from "../../../http/response.types";
import { Clock } from "../../../infra/clock";
import { jongroRoutes } from "../../bus.config";
import type { JongroRoute } from "../../bus.types";
import { BusRealtimeHsscService } from "../hssc/bus-realtime-hssc.service";
import { BusRealtimeJongroService } from "../jongro/bus-realtime-jongro.service";
import { toClockTime, toRealtimeBuses } from "./bus-realtime-group.mapper";
import { toStationEtas } from "./bus-realtime-group.rules";
import type { RealtimeGroup, RealtimeGroupMeta, StationEta } from "./bus-realtime-group.wire";

interface GroupSource {
  listBuses: () => Promise<unknown>;
  listStationEtas: (() => Promise<StationEta[]>) | null;
}

@Injectable()
export class BusRealtimeGroupService {
  constructor(
    private readonly hssc: BusRealtimeHsscService,
    private readonly jongro: BusRealtimeJongroService,
    private readonly clock: Clock,
  ) {}

  async getGroup(groupId: string): Promise<WithMeta<RealtimeGroup, RealtimeGroupMeta>> {
    // QUIRK(js): a plain-object lookup, so a groupId that names an Object.prototype member is no 404.
    const source = this.sourcesByGroupId()[groupId];
    if (!source) throw new AppError("GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`, 404);
    const buses = toRealtimeBuses(await source.listBuses());
    const stationEtas = source.listStationEtas ? await source.listStationEtas() : [];
    return withMeta(
      { groupId, buses, stationEtas },
      { currentTime: toClockTime(this.clock.now()), totalBuses: buses.length },
    );
  }

  private sourcesByGroupId(): Record<string, GroupSource> {
    const sources: Record<string, GroupSource> = {
      hssc: { listBuses: () => this.hssc.listBuses(), listStationEtas: null },
    };
    for (const route of jongroRoutes) sources[route.id] = this.jongroSource(route);
    return sources;
  }

  private jongroSource(route: JongroRoute): GroupSource {
    return {
      listBuses: () => this.jongro.listPositions(route.code),
      listStationEtas: async () => toStationEtas(route, await this.jongro.listArrivals(route.code)),
    };
  }
}
