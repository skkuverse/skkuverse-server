import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";
import { SubwayRepository } from "./subway.repository";

// SEE: docs/explanation/subway-architecture.md
@Module({
  providers: [SubwayRepository],
  exports: [SubwayRepository],
})
export class SubwayModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("subway");
  }
}
