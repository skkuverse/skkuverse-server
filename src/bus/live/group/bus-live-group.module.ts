import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusConfigModule } from "../../config/bus-config.module";
import { BusLiveHsscModule } from "../hssc/bus-live-hssc.module";
import { BusLiveJongroModule } from "../jongro/bus-live-jongro.module";
import { BusLiveModule } from "../bus-live.module";
import { BusLiveGroupController } from "./bus-live-group.controller";
import { BusLiveGroupService } from "./bus-live-group.service";

@Module({
  imports: [BusLiveModule, BusLiveJongroModule, BusLiveHsscModule, BusConfigModule],
  controllers: [BusLiveGroupController],
  providers: [BusLiveGroupService, Clock],
  exports: [BusLiveGroupService],
})
export class BusLiveGroupModule {}
