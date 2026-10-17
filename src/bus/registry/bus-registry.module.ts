import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusRegistryRepository } from "./bus-registry.repository";
import { BusRegistryService } from "./bus-registry.service";

@Module({
  providers: [BusRegistryRepository, BusRegistryService, Clock],
  exports: [BusRegistryService],
})
export class BusRegistryModule {}
