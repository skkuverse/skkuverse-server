import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";

// SEE: docs/explanation/bus-architecture.md
@Module({})
export class BusModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("bus/realtime", "bus/live", "bus/schedule", "bus/config", "bus/stops");
  }
}
