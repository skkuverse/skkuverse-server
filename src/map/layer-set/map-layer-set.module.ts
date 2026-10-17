import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MiniappsModule } from "../../miniapps/miniapps.module";
import { MapModule } from "../map.module";
import { MapLayerSetService } from "./map-layer-set.service";

@Module({
  imports: [MapModule, MiniappsModule],
  providers: [MapLayerSetService, Clock],
  exports: [MapLayerSetService],
})
export class MapLayerSetModule {}
