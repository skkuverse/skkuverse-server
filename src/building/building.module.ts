import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";
import { BuildingRepository } from "./building.repository";
import { BuildingService } from "./building.service";

// SEE: docs/explanation/building-architecture.md
@Module({
  providers: [BuildingService, BuildingRepository],
  exports: [BuildingService, BuildingRepository],
})
export class BuildingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("building");
  }
}
