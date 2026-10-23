import { Module } from "@nestjs/common";
import { BusStopIndexModule } from "../stop-index/bus-stop-index.module";
import { BusStopListController } from "./bus-stop-list.controller";
import { BusStopListService } from "./bus-stop-list.service";

@Module({
  imports: [BusStopIndexModule],
  controllers: [BusStopListController],
  providers: [BusStopListService],
})
export class BusStopListModule {}
