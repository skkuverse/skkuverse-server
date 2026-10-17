import { Module } from "@nestjs/common";
import { SubwayModule } from "../subway.module";
import { SubwayStationsService } from "./subway-stations.service";

@Module({
  imports: [SubwayModule],
  providers: [SubwayStationsService],
  exports: [SubwayStationsService],
})
export class SubwayStationsModule {}
