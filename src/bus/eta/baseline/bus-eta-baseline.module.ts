import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaForecastModule } from "../forecast/bus-eta-forecast.module";
import { BusEtaBaselinePoller } from "./bus-eta-baseline.poller";

@Module({
  imports: [BusEtaModule, BusEtaForecastModule],
  providers: [BusEtaBaselinePoller, Clock],
})
export class BusEtaBaselineModule {}
