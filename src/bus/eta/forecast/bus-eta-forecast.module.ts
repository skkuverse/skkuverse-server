import { Module } from "@nestjs/common";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaLaneModule } from "../lane/bus-eta-lane.module";
import { BusEtaForecastClient } from "./bus-eta-forecast.client";
import { BusEtaForecastService } from "./bus-eta-forecast.service";

@Module({
  imports: [BusEtaModule, BusEtaLaneModule],
  providers: [BusEtaForecastClient, BusEtaForecastService],
  exports: [BusEtaForecastService],
})
export class BusEtaForecastModule {}
