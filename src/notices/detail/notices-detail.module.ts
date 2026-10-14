import { Module } from "@nestjs/common";
import { NoticesModule } from "../notices.module";

@Module({
  imports: [NoticesModule],
})
export class NoticesDetailModule {}
