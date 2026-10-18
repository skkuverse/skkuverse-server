import { Injectable } from "@nestjs/common";
import { AppError } from "../../../http/app.error";
import { withMeta } from "../../../http/response.interceptor";
import type { WithMeta } from "../../../http/response.types";
import { Clock } from "../../../infra/clock";
import { jongroRoutes } from "../../bus.config";
import type { JongroRoute } from "../../bus.types";
import type { JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { BusRealtimeArrivalService } from "../arrival/bus-realtime-arrival.service";
import { BusRealtimeHsscService } from "../hssc/bus-realtime-hssc.service";
import { BusRealtimeJongroService } from "../jongro/bus-realtime-jongro.service";
import { toClockTime, toRealtimeBuses, toTrackedBus } from "./bus-realtime-group.mapper";
import { toJongroBusTracking, toStationEtas, toVehicleBuses } from "./bus-realtime-group.rules";
import type { GroupView } from "./bus-realtime-group.types";
import type { RealtimeBus, RealtimeGroup, RealtimeGroupMeta, StationEta } from "./bus-realtime-group.wire";

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
    const { buses } = view;
    return withMeta(
      { groupId, buses, stationEtas: view.stationEtas, ...(view.stationsVersion !== undefined && { stationsVersion: view.stationsVersion }) },
      { currentTime: toClockTime(this.clock.now()), totalBuses: buses.length },
    );
  }

  private sourcesByGroupId(): Map<string, GroupSource> {
    const sources = new Map<string, GroupSource>([["hssc", async () => ({ buses: toRealtimeBuses(await this.hssc.listBuses()), stationEtas: [] })]]);
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
    return {
      buses: (buses ?? []).map((position) => this.toJongroBus(registryRoute, rows ?? [], position)),
      stationEtas: this.toJongroStationEtas(registryRoute, rows ?? []),
      stationsVersion: registryRoute.stationsVersion,
    };
  }

  private toJongroBus(route: RegistryRoute, rows: readonly JongroArrivalDoc[], position: JongroBusPositionDoc): RealtimeBus {
    const { nextStop, firstNamed } = toVehicleBuses(rows, position.vehicleId, Number(position.sequence));
    const namedBus = nextStop?.bus ?? firstNamed;
    const [arrival] = namedBus ? this.arrival.toArrivals([namedBus], route.seatCount) : [];
    const context = { stationCount: route.topisIds.length, turnaroundTopisId: route.turnaroundTopisId, nextStop, arrival };
    return toTrackedBus(position, toJongroBusTracking(position, context));
  }

  private toJongroStationEtas(route: RegistryRoute, rows: readonly JongroArrivalDoc[]): StationEta[] {
    return rows.flatMap((row) =>
      toStationEtas(route, [row]).map((placed) => ({ ...placed, arrivals: this.arrival.toArrivals(row.buses, route.seatCount) })),
    );
  }
}
