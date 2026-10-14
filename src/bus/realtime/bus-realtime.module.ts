import { Module } from "@nestjs/common";
import { BusCacheModule } from "../cache/bus-cache.module";

@Module({
  imports: [BusCacheModule],
  exports: [BusCacheModule],
})
export class BusRealtimeModule {}
