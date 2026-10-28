import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesFactsService } from "./notices-facts.service";

@Module({
  providers: [NoticesFactsService, Clock],
  exports: [NoticesFactsService],
})
export class NoticesFactsModule {}
