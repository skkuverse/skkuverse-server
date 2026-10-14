import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusCacheRepository } from "./bus-cache.repository";
import { BusCacheService } from "./bus-cache.service";

@Module({
  providers: [BusCacheRepository, BusCacheService, Clock],
  exports: [BusCacheService],
})
export class BusCacheModule {}
