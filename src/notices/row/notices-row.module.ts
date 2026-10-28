import { Module } from "@nestjs/common";
import { NoticesFactsModule } from "../facts/notices-facts.module";
import { NoticesRowService } from "./notices-row.service";

@Module({
  imports: [NoticesFactsModule],
  providers: [NoticesRowService],
  exports: [NoticesRowService],
})
export class NoticesRowModule {}
