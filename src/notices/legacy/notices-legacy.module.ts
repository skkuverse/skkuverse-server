import { Module } from "@nestjs/common";
import { NoticesRowModule } from "../row/notices-row.module";
import { NoticesLegacyService } from "./notices-legacy.service";

@Module({
  imports: [NoticesRowModule],
  providers: [NoticesLegacyService],
  exports: [NoticesLegacyService],
})
export class NoticesLegacyModule {}
