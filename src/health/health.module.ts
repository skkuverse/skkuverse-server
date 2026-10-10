import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

// PollerRegistryService comes from the @Global SchedulingModule, so it needs no provider here.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
