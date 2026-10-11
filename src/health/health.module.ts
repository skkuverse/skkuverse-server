import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

// WHY: no provider for PollerRegistryService: it comes from the @Global SchedulingModule, and a
// second provider here would be a second registry, one that never reports its pollers ready.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
