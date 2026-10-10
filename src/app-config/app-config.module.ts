import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";
import { Clock } from "../infra/clock";
import { AppConfigController } from "./app-config.controller";
import { AppConfigRepository } from "./app-config.repository";
import { AppConfigService } from "./app-config.service";

// SEE: docs/explanation/app-config-architecture.md
@Module({
  controllers: [AppConfigController],
  providers: [AppConfigService, AppConfigRepository, Clock],
})
export class AppConfigModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("app");
  }
}
