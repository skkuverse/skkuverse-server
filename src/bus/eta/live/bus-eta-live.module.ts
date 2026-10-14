import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaLiveClient } from "./bus-eta-live.client";
import { BusEtaLivePoller } from "./bus-eta-live.poller";

@Module({
  imports: [BusEtaModule],
  providers: [BusEtaLiveClient, BusEtaLivePoller, Clock],
})
export class BusEtaLiveModule {}
