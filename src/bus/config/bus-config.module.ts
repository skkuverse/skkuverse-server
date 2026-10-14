import { Module } from "@nestjs/common";
import { BusStopsModule } from "../stops/bus-stops.module";
import { BusConfigController } from "./bus-config.controller";
import { BusConfigService } from "./bus-config.service";

@Module({
  imports: [BusStopsModule],
  controllers: [BusConfigController],
  providers: [BusConfigService],
  exports: [BusConfigService],
})
export class BusConfigModule {}
