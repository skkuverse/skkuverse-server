import { Module } from "@nestjs/common";
import { SubwayModule } from "../subway.module";
import { SubwaySeoulApiClient } from "./subway-seoul-api.client";
import { SubwaySeoulApiService } from "./subway-seoul-api.service";

@Module({
  imports: [SubwayModule],
  providers: [SubwaySeoulApiClient, SubwaySeoulApiService],
  exports: [SubwaySeoulApiService],
})
export class SubwaySeoulApiModule {}
