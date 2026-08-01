import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";
import { Clock } from "../infra/clock";
import { MiniappsRepository } from "./miniapps.repository";
import { MiniappsService } from "./miniapps.service";

// SEE: docs/explanation/miniapps-architecture.md
@Module({
  providers: [MiniappsService, MiniappsRepository, Clock],
  exports: [MiniappsService],
})
export class MiniappsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("miniapps");
  }
}
