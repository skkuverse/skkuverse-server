import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaTravelModule } from "../travel/bus-eta-travel.module";
import { BusEtaLivePoller } from "./bus-eta-live.poller";

@Module({
  imports: [BusEtaModule, BusEtaTravelModule],
  providers: [BusEtaLivePoller, Clock],
})
export class BusEtaLiveModule {}
