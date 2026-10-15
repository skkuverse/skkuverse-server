import { Global, Module } from "@nestjs/common";
import { PollerRegistryService } from "./poller-registry.service";

// WHY: pollers run through PollerRegistryService, not @nestjs/schedule's @Interval, which has no
// in-flight guard, no warm-up run and no failure reporting.
@Global()
@Module({
  providers: [PollerRegistryService],
  exports: [PollerRegistryService],
})
export class SchedulingModule {}
