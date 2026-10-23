import { Module } from "@nestjs/common";
import { BusRegistryModule } from "../registry/bus-registry.module";
import { BusRouteAttributesModule } from "../route-attributes/bus-route-attributes.module";
import { BusRoutePathModule } from "../route-path/bus-route-path.module";
import { BusStopsModule } from "../stops/bus-stops.module";
import { BusConfigController } from "./bus-config.controller";
import { BusConfigService } from "./bus-config.service";

@Module({
  imports: [BusStopsModule, BusRegistryModule, BusRouteAttributesModule, BusRoutePathModule],
  controllers: [BusConfigController],
  providers: [BusConfigService],
  exports: [BusConfigService],
})
export class BusConfigModule {}
