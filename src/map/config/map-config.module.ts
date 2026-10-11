import { Module } from "@nestjs/common";
import { MapLayerSetModule } from "../layer-set/map-layer-set.module";
import { MapModule } from "../map.module";
import { MapConfigController } from "./map-config.controller";
import { MapConfigService } from "./map-config.service";

@Module({
  imports: [MapModule, MapLayerSetModule],
  controllers: [MapConfigController],
  providers: [MapConfigService],
})
export class MapConfigModule {}
