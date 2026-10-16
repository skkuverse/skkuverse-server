import { Module } from "@nestjs/common";
import { SubwayModule } from "../subway.module";
import { SubwayEstimateService } from "./subway-estimate.service";

@Module({
  imports: [SubwayModule],
  providers: [SubwayEstimateService],
  exports: [SubwayEstimateService],
})
export class SubwayEstimateModule {}
