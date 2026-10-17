import { Module } from "@nestjs/common";
import { SubwayCountdownModule } from "../countdown/subway-countdown.module";
import { SubwayModule } from "../subway.module";
import { SubwayEstimateService } from "./subway-estimate.service";

@Module({
  imports: [SubwayModule, SubwayCountdownModule],
  providers: [SubwayEstimateService],
  exports: [SubwayEstimateService],
})
export class SubwayEstimateModule {}
