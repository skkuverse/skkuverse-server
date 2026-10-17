import { Injectable } from "@nestjs/common";
import { AppError } from "../../../http/app.error";
import { withMeta } from "../../../http/response.interceptor";
import type { WithMeta } from "../../../http/response.types";
import { Clock } from "../../../infra/clock";
import { jongroRoutes } from "../../bus.config";
import type { JongroRoute } from "../../bus.types";
import type { JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { BusRealtimeArrivalService } from "../arrival/bus-realtime-arrival.service";
import { BusRealtimeHsscService } from "../hssc/bus-realtime-hssc.service";
import { BusRealtimeJongroService } from "../jongro/bus-realtime-jongro.service";
import { toClockTime, toRealtimeBuses } from "./bus-realtime-group.mapper";
import { toStationEtas } from "./bus-realtime-group.rules";
import type { GroupView } from "./bus-realtime-group.types";
import type { RealtimeGroup, RealtimeGroupMeta, StationEta } from "./bus-realtime-group.wire";

type GroupSource = () => Promise<GroupView>;

@Injectable()
export class BusRealtimeGroupService {
  constructor(
    private readonly hssc: BusRealtimeHsscService,
    private readonly jongro: BusRealtimeJongroService,
    private readonly arrival: BusRealtimeArrivalService,
    private readonly clock: Clock,
  ) {}

  async getGroup(groupId: string): Promise<WithMeta<RealtimeGroup, RealtimeGroupMeta>> {
    const source = this.sourcesByGroupId().get(groupId);
    if (!source) throw new AppError("GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`, 404);
    const view = await source();
    const buses = toRealtimeBuses(view.buses);
    return withMeta(
      { groupId, buses, stationEtas: view.stationEtas, ...(view.stationsVersion !== undefined && { stationsVersion: view.stationsVersion }) },
      { currentTime: toClockTime(this.clock.now()), totalBuses: buses.length },
    );
  }

  private sourcesByGroupId(): Map<string, GroupSource> {
    const sources = new Map<string, GroupSource>([["hssc", async () => ({ buses: await this.hssc.listBuses(), stationEtas: [] })]]);
    for (const route of jongroRoutes) sources.set(route.id, () => this.readJongroGroup(route));
    return sources;
  }

  // WHY: placed by the stored stations, which a missing registry route answers with a 503 (improve-jongro-realtime D7).
  private async readJongroGroup(route: JongroRoute): Promise<GroupView> {
    const [registryRoute, buses, rows] = await Promise.all([
      this.jongro.registryRouteOf(route.id),
      this.jongro.listPositions(route.code),
      this.jongro.listArrivals(route.code),
    ]);
    return { buses, stationEtas: this.toJongroStationEtas(registryRoute, rows ?? []), stationsVersion: registryRoute.stationsVersion };
  }

  private toJongroStationEtas(route: RegistryRoute, rows: readonly JongroArrivalDoc[]): StationEta[] {
    return rows.flatMap((row) =>
      toStationEtas(route, [row]).map((placed) => ({ ...placed, arrivals: this.arrival.toArrivals(row.buses, route.seatCount) })),
    );
  }
}
