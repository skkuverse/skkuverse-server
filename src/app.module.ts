import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { HealthModule } from "./health/health.module";
import { BusModule } from "./bus/bus.module";
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

// WHY: imports in boot order: config (fails loud on a missing value), the poller registry, then health.
// LangMiddleware is not bound here but in bootstrapHttpApp (src/http/http-app.bootstrap.ts); its QUIRK says why.
@Module({
  imports: [
    ConfigModule,
    SchedulingModule,
    HealthModule,
    BusModule,
    AppConfigModule,
    UiModule,
    UiHomeModule,
    UiTransitListModule,
    UiScrollModule,
    UiCampusModule,
    BuildingModule,
    // Before BuildingCatalogModule: Nest registers routes in module order, and
    // /building/:skkuId would catch /building/search (route-order.test.ts).
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
  ],
})
export class AppModule {}
