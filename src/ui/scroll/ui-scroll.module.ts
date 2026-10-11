import { Module } from "@nestjs/common";
import { UiModule } from "../ui.module";
import { UiScrollController } from "./ui-scroll.controller";
import { UiScrollService } from "./ui-scroll.service";

@Module({
  imports: [UiModule],
  controllers: [UiScrollController],
  providers: [UiScrollService],
})
export class UiScrollModule {}
