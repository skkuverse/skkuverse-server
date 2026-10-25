import { Module } from "@nestjs/common";
import { MiniappsModule } from "../miniapps.module";
import { MiniappsSenderService } from "./miniapps-sender.service";

@Module({
  imports: [MiniappsModule],
  providers: [MiniappsSenderService],
  exports: [MiniappsSenderService],
})
export class MiniappsSenderModule {}
