import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwaySeoulApiModule } from "../seoul-api/subway-seoul-api.module";
import { SubwaySeoulTrainmapModule } from "../seoul-trainmap/subway-seoul-trainmap.module";
import { SubwayModule } from "../subway.module";
import { SubwayTimetableModule } from "../timetable/subway-timetable.module";
import { SubwayTrackingModule } from "../tracking/subway-tracking.module";
import { SubwaySeoulPoller } from "./subway-seoul.poller";
import { SubwaySeoulService } from "./subway-seoul.service";

@Module({
  imports: [SubwayModule, SubwaySeoulApiModule, SubwaySeoulTrainmapModule, SubwayTimetableModule, SubwayTrackingModule],
  providers: [SubwaySeoulService, SubwaySeoulPoller, Clock],
})
export class SubwaySeoulModule {}
