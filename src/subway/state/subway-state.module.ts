import { Module } from "@nestjs/common";
import { SubwayModule } from "../subway.module";
import { SubwayStateService } from "./subway-state.service";

@Module({
  imports: [SubwayModule],
  providers: [SubwayStateService],
  exports: [SubwayStateService],
})
export class SubwayStateModule {}
