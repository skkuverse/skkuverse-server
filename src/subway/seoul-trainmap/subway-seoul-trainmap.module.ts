import { Module } from "@nestjs/common";
import { SubwayModule } from "../subway.module";
import { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapService } from "./subway-seoul-trainmap.service";

@Module({
  imports: [SubwayModule],
  providers: [SubwaySeoulTrainmapClient, SubwaySeoulTrainmapService],
  exports: [SubwaySeoulTrainmapService],
})
export class SubwaySeoulTrainmapModule {}
