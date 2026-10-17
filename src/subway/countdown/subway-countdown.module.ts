import { Module } from "@nestjs/common";
import { SubwayModule } from "../subway.module";
import { SubwayCountdownService } from "./subway-countdown.service";

@Module({
  imports: [SubwayModule],
  providers: [SubwayCountdownService],
  exports: [SubwayCountdownService],
})
export class SubwayCountdownModule {}
