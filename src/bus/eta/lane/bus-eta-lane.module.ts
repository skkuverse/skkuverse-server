import { Module } from "@nestjs/common";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaLaneService } from "./bus-eta-lane.service";

@Module({
  imports: [BusEtaModule],
  providers: [BusEtaLaneService],
  exports: [BusEtaLaneService],
})
export class BusEtaLaneModule {}
