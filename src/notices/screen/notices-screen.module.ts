import { Module } from "@nestjs/common";
import { BuildingPlaceDisplayModule } from "../../building/place/display/building-place-display.module";
import { NoticesRowModule } from "../row/notices-row.module";
import { NoticesScreenService } from "./notices-screen.service";

@Module({
  imports: [NoticesRowModule, BuildingPlaceDisplayModule],
  providers: [NoticesScreenService],
  exports: [NoticesScreenService],
})
export class NoticesScreenModule {}
