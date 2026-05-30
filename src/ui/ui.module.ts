import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";

// SEE: docs/explanation/ui-architecture.md
@Module({})
export class UiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("ui");
  }
}
