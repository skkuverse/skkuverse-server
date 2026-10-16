import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { HealthModule } from "./health/health.module";
import { HolidaysModule } from "./holidays/holidays.module";
import { HolidaysSyncModule } from "./holidays/sync/holidays-sync.module";
import { BusModule } from "./bus/bus.module";
import { BusCacheModule } from "./bus/cache/bus-cache.module";
import { BusRealtimeModule } from "./bus/realtime/bus-realtime.module";
import { BusRealtimeHsscModule } from "./bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeJongroModule } from "./bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRealtimeGroupModule } from "./bus/realtime/group/bus-realtime-group.module";
import { BusStationModule } from "./bus/station/bus-station.module";
import { BusStopsModule } from "./bus/stops/bus-stops.module";
import { BusScheduleModule } from "./bus/schedule/bus-schedule.module";
import { BusEtaModule } from "./bus/eta/bus-eta.module";
import { BusEtaLiveModule } from "./bus/eta/live/bus-eta-live.module";
import { BusEtaBaselineModule } from "./bus/eta/baseline/bus-eta-baseline.module";
import { BusEtaSmartModule } from "./bus/eta/smart/bus-eta-smart.module";
import { BusConfigModule } from "./bus/config/bus-config.module";
import { BusRouteOverlayModule } from "./bus/route-overlay/bus-route-overlay.module";
import { AppConfigModule } from "./app-config/app-config.module";
import { UiModule } from "./ui/ui.module";
import { UiHomeModule } from "./ui/home/ui-home.module";
import { UiTransitListModule } from "./ui/transit-list/ui-transit-list.module";
import { UiScrollModule } from "./ui/scroll/ui-scroll.module";
import { UiCampusModule } from "./ui/campus/ui-campus.module";
import { BuildingModule } from "./building/building.module";
import { BuildingCatalogModule } from "./building/catalog/building-catalog.module";
import { BuildingSearchModule } from "./building/search/building-search.module";
import { BuildingSyncModule } from "./building/sync/building-sync.module";
import { MapModule } from "./map/map.module";
import { MapLayerSetModule } from "./map/layer-set/map-layer-set.module";
import { MapConfigModule } from "./map/config/map-config.module";
import { MapCampusModule } from "./map/campus/map-campus.module";
import { MapEventModule } from "./map/event/map-event.module";
import { MapEventDetailsModule } from "./map/event-details/map-event-details.module";
import { NoticesModule } from "./notices/notices.module";
import { NoticesTabsModule } from "./notices/tabs/notices-tabs.module";
import { NoticesListModule } from "./notices/list/notices-list.module";
import { NoticesOverviewModule } from "./notices/overview/notices-overview.module";
import { NoticesAttachmentModule } from "./notices/attachment/notices-attachment.module";
import { NoticesDetailModule } from "./notices/detail/notices-detail.module";
import { NoticesDispatchModule } from "./notices/dispatch/notices-dispatch.module";
import { MiniappsModule } from "./miniapps/miniapps.module";
import { MiniappsNotificationsModule } from "./miniapps/notifications/miniapps-notifications.module";
import { MiniappsCatalogModule } from "./miniapps/catalog/miniapps-catalog.module";
import { SubwayModule } from "./subway/subway.module";
import { SubwayTimetableModule } from "./subway/timetable/subway-timetable.module";
import { SubwayEstimateModule } from "./subway/estimate/subway-estimate.module";
import { SubwaySeoulApiModule } from "./subway/seoul-api/subway-seoul-api.module";
import { SubwaySeoulTrainmapModule } from "./subway/seoul-trainmap/subway-seoul-trainmap.module";
import { SubwayTrackingModule } from "./subway/tracking/subway-tracking.module";
import { SubwaySeoulModule } from "./subway/seoul/subway-seoul.module";
import { SubwayArrivalsModule } from "./subway/arrivals/subway-arrivals.module";

// WHY: imports in boot order: config (fails loud on a missing value), the poller registry, then health.
// LangMiddleware is not bound here but in bootstrapHttpApp (src/http/http-app.bootstrap.ts); its QUIRK says why.
@Module({
  imports: [
    ConfigModule,
    SchedulingModule,
    HealthModule,
    HolidaysModule,
    HolidaysSyncModule,
    BusModule,
    BusCacheModule,
    BusRealtimeModule,
    BusRealtimeHsscModule,
    BusRealtimeJongroModule,
    BusRealtimeGroupModule,
    BusStationModule,
    BusStopsModule,
    BusScheduleModule,
    BusEtaModule,
    BusEtaLiveModule,
    BusEtaBaselineModule,
    BusEtaSmartModule,
    BusConfigModule,
    BusRouteOverlayModule,
    AppConfigModule,
    UiModule,
    UiHomeModule,
    UiTransitListModule,
    UiScrollModule,
    UiCampusModule,
    BuildingModule,
    // WHY: before BuildingCatalogModule: Nest registers routes in module order, and /building/:skkuId would catch
    // /building/search (route-order.test.ts).
    BuildingSearchModule,
    BuildingCatalogModule,
    BuildingSyncModule,
    MapModule,
    MapLayerSetModule,
    MapConfigModule,
    MapCampusModule,
    MapEventModule,
    MapEventDetailsModule,
    NoticesModule,
    NoticesTabsModule,
    NoticesListModule,
    NoticesOverviewModule,
    NoticesAttachmentModule,
    // WHY: last of the /notices routes: /notices/:sourceId/:articleNo would catch every two-segment path above.
    NoticesDetailModule,
    NoticesDispatchModule,
    MiniappsModule,
    MiniappsNotificationsModule,
    MiniappsCatalogModule,
    SubwayModule,
    SubwayTimetableModule,
    SubwayEstimateModule,
    SubwaySeoulApiModule,
    SubwaySeoulTrainmapModule,
    SubwayTrackingModule,
    SubwaySeoulModule,
    SubwayArrivalsModule,
  ],
})
export class AppModule {}
