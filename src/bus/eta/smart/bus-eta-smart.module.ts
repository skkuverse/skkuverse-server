import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaSmartController } from "./bus-eta-smart.controller";
import { BusEtaSmartService } from "./bus-eta-smart.service";

@Module({
  imports: [BusEtaModule],
  controllers: [BusEtaSmartController],
  providers: [BusEtaSmartService, Clock],
  exports: [BusEtaSmartService],
})
export class BusEtaSmartModule {}
