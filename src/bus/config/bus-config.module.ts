import { Module } from "@nestjs/common";
import { BusRegistryModule } from "../registry/bus-registry.module";
import { BusStopsModule } from "../stops/bus-stops.module";
import { BusConfigController } from "./bus-config.controller";
import { BusConfigService } from "./bus-config.service";

@Module({
  imports: [BusStopsModule, BusRegistryModule],
  controllers: [BusConfigController],
  providers: [BusConfigService],
  exports: [BusConfigService],
})
export class BusConfigModule {}
