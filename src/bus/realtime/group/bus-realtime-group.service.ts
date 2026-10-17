import { Injectable } from "@nestjs/common";
import { AppError } from "../../../http/app.error";
import { withMeta } from "../../../http/response.interceptor";
import type { WithMeta } from "../../../http/response.types";
import { Clock } from "../../../infra/clock";
import logger from "../../../infra/logger";
import { jongroRoutes } from "../../bus.config";
import type { JongroRoute } from "../../bus.types";
import type { CachedJongroArrivalDoc } from "../../cache/bus-cache.document";
import { BusRealtimeArrivalService } from "../arrival/bus-realtime-arrival.service";
import { BusRealtimeHsscService } from "../hssc/bus-realtime-hssc.service";
import { BusRealtimeJongroService } from "../jongro/bus-realtime-jongro.service";
import { toClockTime, toRealtimeBuses } from "./bus-realtime-group.mapper";
import { toStationEtas } from "./bus-realtime-group.rules";
import type { CachedBusFields } from "./bus-realtime-group.types";
import type { RealtimeGroup, RealtimeGroupMeta, StationEta } from "./bus-realtime-group.wire";

interface GroupSource {
  listBuses: () => Promise<readonly CachedBusFields[] | undefined>;
  listStationEtas: (() => Promise<StationEta[]>) | null;
}

@Injectable()
export class BusRealtimeGroupService {
  private hasLoggedLegacyArrivals = false;

  constructor(
    private readonly hssc: BusRealtimeHsscService,
    private readonly jongro: BusRealtimeJongroService,
    private readonly arrival: BusRealtimeArrivalService,
    private readonly clock: Clock,
  ) {}

  async getGroup(groupId: string): Promise<WithMeta<RealtimeGroup, RealtimeGroupMeta>> {
    const source = this.sourcesByGroupId().get(groupId);
    if (!source) throw new AppError("GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`, 404);
    const buses = toRealtimeBuses(await source.listBuses());
    const stationEtas = source.listStationEtas ? await source.listStationEtas() : [];
    return withMeta(
      { groupId, buses, stationEtas },
      { currentTime: toClockTime(this.clock.now()), totalBuses: buses.length },
    );
  }

  private sourcesByGroupId(): Map<string, GroupSource> {
    const sources = new Map<string, GroupSource>([["hssc", { listBuses: () => this.hssc.listBuses(), listStationEtas: null }]]);
    for (const route of jongroRoutes) sources.set(route.id, this.jongroSource(route));
    return sources;
  }

  private jongroSource(route: JongroRoute): GroupSource {
    return {
      listBuses: () => this.jongro.listPositions(route.code),
      listStationEtas: () => this.listJongroStationEtas(route),
    };
  }

  private async listJongroStationEtas(route: JongroRoute): Promise<StationEta[]> {
    const rows = (await this.jongro.listArrivals(route.code)) ?? [];
    return rows.flatMap((row) =>
      toStationEtas(route, [row]).map((placed) => ({ ...placed, arrivals: this.toArrivals(route, row) })),
    );
  }

  // WHY: the previous poller's rows carry no buses; one can be read for 60 s after a deploy (design D2).
  private toArrivals(route: JongroRoute, row: CachedJongroArrivalDoc): StationEta["arrivals"] {
    if ("buses" in row) return this.arrival.toArrivals(row.buses, route.seatCount);
    if (!this.hasLoggedLegacyArrivals) {
      this.hasLoggedLegacyArrivals = true;
      logger.info({ event: "bus.jongro.legacy_arrivals", code: route.code }, "Serving Jongro arrivals cached by the previous poller");
    }
    return [];
  }
}
