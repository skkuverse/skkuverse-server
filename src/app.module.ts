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
import { MiniAppsModule } from "./miniapps/miniapps.module";

/**
 * Root module.
 *
 * Order of imports mirrors the boot-time concerns: config (fail-loud validation)
 * → scheduling (poller registry) → health. The MongoDB client is not a module:
 * it is the lazy singleton in infra/db, closed by main.ts on shutdown.
 *
 * LangMiddleware is NOT applied here via consumer.forRoutes("*"): Nest's
 * wildcard forRoutes binding does NOT fire against the pre-built ExpressAdapter
 * instance main.ts uses (empirically verified — "*"/"(.*)"/"{*path}"/"*path"
 * all produce zero invocations). Instead main.ts mounts LangMiddleware as raw
 * app-level express middleware before NestFactory.create, as the
 * build-bus-app.ts test helper does, so req.lang + req.__startNs + Vary are set
 * on every request. The per-route bus rate limiter is still applied inside
 * BusModule.configure() (exact prefixes, which DO fire), so the order is
 * lang → limiter → handler.
 */
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
    MiniAppsModule,
  ],
})
export class AppModule {}
