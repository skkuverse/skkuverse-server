import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";
import { JourneyRepository } from "./journey.repository";

// SEE: docs/explanation/journey-architecture.md
@Module({
  providers: [JourneyRepository],
  exports: [JourneyRepository],
})
export class JourneyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("journey");
  }
}
