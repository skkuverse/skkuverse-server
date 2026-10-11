import { Module } from "@nestjs/common";
import { MapLayerSetModule } from "../layer-set/map-layer-set.module";
import { MapModule } from "../map.module";
import { MapEventDetailsController } from "./map-event-details.controller";
import { MapEventDetailsService } from "./map-event-details.service";

@Module({
  imports: [MapModule, MapLayerSetModule],
  controllers: [MapEventDetailsController],
  providers: [MapEventDetailsService],
})
export class MapEventDetailsModule {}
