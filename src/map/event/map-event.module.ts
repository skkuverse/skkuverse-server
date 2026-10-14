import { Module } from "@nestjs/common";
import { MiniappsModule } from "../../miniapps/miniapps.module";
import { MapLayerSetModule } from "../layer-set/map-layer-set.module";
import { MapModule } from "../map.module";
import { MapEventController } from "./map-event.controller";
import { MapEventService } from "./map-event.service";

@Module({
  imports: [MapModule, MapLayerSetModule, MiniappsModule],
  controllers: [MapEventController],
  providers: [MapEventService],
})
export class MapEventModule {}
