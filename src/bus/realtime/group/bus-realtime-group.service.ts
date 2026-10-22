import { Injectable } from "@nestjs/common";
import { AppError } from "../../../http/app.error";
import { withMeta } from "../../../http/response.interceptor";
import type { WithMeta } from "../../../http/response.types";
import { Clock } from "../../../infra/clock";
import { createLogThrottle } from "../../../infra/log-throttle";
import logger from "../../../infra/logger";
import { JONGRO_ROUTES } from "../../bus.constants";
import { toJongroRoute, toKstInstant } from "../../bus.mapper";
import type { JongroRoute, JongroRouteAttributes } from "../../bus.types";
import type { BusCacheEntry, JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { BusRealtimeArrivalService } from "../arrival/bus-realtime-arrival.service";
import { BusRealtimeHsscService } from "../hssc/bus-realtime-hssc.service";
import { BusRealtimeJongroService } from "../jongro/bus-realtime-jongro.service";
import { toClockTime, toRealtimeBuses, toTrackedBus } from "./bus-realtime-group.mapper";
import {
  toHighestSectOrd,
  toJongroBusTracking,
  toMadeAtMs,
  toNamedBuses,
  toStationEtas,
  toVehicleBuses,
  toWaitingArrival,
  toWaitingVehicleIds,
} from "./bus-realtime-group.rules";
import { DEPRECATED_CALL_LOG_INTERVAL_MS } from "./bus-realtime-group.constants";
import type { DeprecatedCaller, GroupView, JongroBusTracking, JongroReading, PlacedArrivalRow } from "./bus-realtime-group.types";
import type { RealtimeBus, RealtimeGroup, RealtimeGroupMeta, StationEta } from "./bus-realtime-group.wire";

type GroupSource = () => Promise<GroupView>;
type SeatedRoute = RegistryRoute & Pick<JongroRouteAttributes, "seatCount">;

@Injectable()
export class BusRealtimeGroupService {
  private readonly deprecatedCallThrottle = createLogThrottle(DEPRECATED_CALL_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    private readonly hssc: BusRealtimeHsscService,
    private readonly jongro: BusRealtimeJongroService,
    private readonly arrival: BusRealtimeArrivalService,
    private readonly clock: Clock,
  ) {}

  // WHY: installed bundles call this route until their devices update (ADR 0019, D11); the app sends its version and
  // platform but no OTA bundle id, so an hourly line per group, version and platform counts them.
  recordDeprecatedCall(groupId: string, { appVersion, platform }: DeprecatedCaller): void {
    const ticket = this.deprecatedCallThrottle.take([groupId, appVersion, platform].join("|"));
    if (!ticket) return;
    logger.warn(
      { event: "bus.realtime.deprecated_route_called", groupId, appVersion, platform, suppressed: ticket.suppressed },
      "deprecated: /bus/realtime/data called, use /bus/live",
    );
  }

  async getGroup(groupId: string): Promise<WithMeta<RealtimeGroup, RealtimeGroupMeta>> {
    const view = await this.findGroupView(groupId);
    if (!view) throw new AppError("GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`, 404);
    const { buses } = view;
    const now = this.clock.now();
    return withMeta(
      { groupId, buses, stationEtas: view.stationEtas, ...(view.stationsVersion !== undefined && { stationsVersion: view.stationsVersion }) },
      { currentTime: toClockTime(now), totalBuses: buses.length, serverNow: toKstInstant(now.getTime()) },
    );
  }

  private findGroupView(groupId: string): Promise<GroupView | null> {
    const source = this.sourcesByGroupId().get(groupId);
    return source ? source() : Promise.resolve(null);
  }

  // WHY: the live route maps a Jongno group from the same reads and joins as this view, with when each key was written
  // (ADR 0019); null for a group that is not a Jongno route.
  async findJongroReading(groupId: string): Promise<JongroReading | null> {
    const route = JONGRO_ROUTES.map(toJongroRoute).find((candidate) => candidate.id === groupId);
    if (!route) return null;
    const seatCount = await this.arrival.seatCountOf(route.id);
    const [registryRoute, positionsEntry, arrivalsEntry] = await Promise.all([
      this.jongro.registryRouteOf(route.id),
      this.jongro.findPositionsEntry(route.code),
      this.jongro.findArrivalsEntry(route.code),
    ]);
    const seated = { ...registryRoute, seatCount };
    const rows = arrivalsEntry?.value ?? [];
    const track = (position: JongroBusPositionDoc, checkedAt: Date) => ({ position, tracking: this.trackPosition(seated, rows, position), checkedAt });
    const positions = positionsEntry ? positionsEntry.value.map((position) => track(position, positionsEntry.updatedAt)) : [];
    const waitingVehicleIds = new Set(positions.filter(({ tracking }) => tracking.status === "waiting").map(({ position }) => position.vehicleId));
    return { route: registryRoute, rows: this.toPlacedRows(seated, rows, waitingVehicleIds), positions, ...this.checkedAtOf(arrivalsEntry, positionsEntry) };
  }

  private checkedAtOf(arrivals: BusCacheEntry<`jongro_stations_${string}`> | null, positions: BusCacheEntry<`jongro_locations_${string}`> | null) {
    return { arrivalsCheckedAt: arrivals?.updatedAt ?? null, positionsCheckedAt: positions?.updatedAt ?? null };
  }

  private toPlacedRows(route: SeatedRoute, rows: readonly JongroArrivalDoc[], waitingVehicleIds: ReadonlySet<string>): PlacedArrivalRow[] {
    return rows.flatMap((row) =>
      toStationEtas(route, [row]).map(({ stationIndex }) => ({
        stationIndex,
        madeAtMs: toMadeAtMs(row.eventDate),
        slots: this.arrival
          .toTimedArrivals(row.buses, route.seatCount)
          .map((slot) => (waitingVehicleIds.has(slot.bus.vehId) ? { ...slot, arrival: toWaitingArrival(slot.arrival) } : slot)),
      })),
    );
  }

  private sourcesByGroupId(): Map<string, GroupSource> {
    const sources = new Map<string, GroupSource>([["hssc", async () => ({ buses: toRealtimeBuses(await this.hssc.listBuses()), stationEtas: [] })]]);
    for (const route of JONGRO_ROUTES.map(toJongroRoute)) sources.set(route.id, () => this.readJongroGroup(route));
    return sources;
  }

  // WHY: placed by the stored stations, which a missing registry route answers with a 503 (ADR 0012, D3);
  // the seat count is read first, so attributes never read answer their own 503 whatever the registry holds.
  private async readJongroGroup(route: JongroRoute): Promise<GroupView> {
    const seatCount = await this.arrival.seatCountOf(route.id);
    const [registryRoute, buses, rows] = await Promise.all([
      this.jongro.registryRouteOf(route.id),
      this.jongro.listPositions(route.code),
      this.jongro.listArrivals(route.code),
    ]);
    const seated = { ...registryRoute, seatCount };
    const trackedBuses = (buses ?? []).map((position) => this.toJongroBus(seated, rows ?? [], position));
    return {
      buses: trackedBuses,
      stationEtas: this.toJongroStationEtas(seated, rows ?? [], toWaitingVehicleIds(trackedBuses)),
      stationsVersion: registryRoute.stationsVersion,
    };
  }

  private toJongroBus(route: SeatedRoute, rows: readonly JongroArrivalDoc[], position: JongroBusPositionDoc): RealtimeBus {
    return toTrackedBus(position, this.trackPosition(route, rows, position));
  }

  private trackPosition(route: SeatedRoute, rows: readonly JongroArrivalDoc[], position: JongroBusPositionDoc): JongroBusTracking {
    const { nextStop, firstNamed } = toVehicleBuses(rows, position.vehicleId, Number(position.sequence));
    const namedBus = nextStop?.bus ?? firstNamed;
    const [arrival] = namedBus ? this.arrival.toArrivals([namedBus], route.seatCount) : [];
    const highestSectOrd = toHighestSectOrd(rows, position.vehicleId);
    const namedBuses = toNamedBuses(rows, position.vehicleId);
    const context = { stationCount: route.topisIds.length, turnaroundTopisId: route.turnaroundTopisId, nextStop, arrival, highestSectOrd, namedBuses };
    return toJongroBusTracking(position, context);
  }

  private toJongroStationEtas(route: SeatedRoute, rows: readonly JongroArrivalDoc[], waitingVehicleIds: ReadonlySet<string>): StationEta[] {
    const toArrivals = (row: JongroArrivalDoc) =>
      row.buses.flatMap((bus) =>
        this.arrival.toArrivals([bus], route.seatCount).map((arrival) => (waitingVehicleIds.has(bus.vehId) ? toWaitingArrival(arrival) : arrival)),
      );
    return rows.flatMap((row) => toStationEtas(route, [row]).map((placed) => ({ ...placed, arrivals: toArrivals(row) })));
  }
}
