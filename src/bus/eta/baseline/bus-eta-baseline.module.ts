import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaBaselineClient } from "./bus-eta-baseline.client";
import { BusEtaBaselinePoller } from "./bus-eta-baseline.poller";

@Module({
  imports: [BusEtaModule],
  providers: [BusEtaBaselineClient, BusEtaBaselinePoller, Clock],
})
export class BusEtaBaselineModule {}
