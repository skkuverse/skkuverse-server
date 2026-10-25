import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { JourneyDeparturesModule } from "../departures/journey-departures.module";
import { JourneyModule } from "../journey.module";
import { JourneyPlacesModule } from "../places/journey-places.module";
import { JourneyRoutesController } from "./journey-routes.controller";
import { JourneyRoutesService } from "./journey-routes.service";

@Module({
  imports: [JourneyModule, JourneyDeparturesModule, JourneyPlacesModule],
  controllers: [JourneyRoutesController],
  providers: [JourneyRoutesService, Clock],
})
export class JourneyRoutesModule {}
