import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";
import { MapRepository } from "./map.repository";

// SEE: docs/explanation/map-architecture.md
@Module({
  providers: [MapRepository],
  exports: [MapRepository],
})
export class MapModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("map/config", "map/overlays");
  }
}
