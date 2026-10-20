import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayTopologyRepository } from "./subway-topology.repository";
import { SubwayTopologyService } from "./subway-topology.service";

@Module({
  providers: [SubwayTopologyService, SubwayTopologyRepository, Clock],
  exports: [SubwayTopologyService],
})
export class SubwayTopologyModule {}
