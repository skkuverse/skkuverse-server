import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { GeneralRateLimitMiddleware } from "../http/general-rate-limit.middleware";
import { Clock } from "../infra/clock";
import { GamesController } from "./games.controller";
import { GamesRepository } from "./games.repository";
import { GamesService } from "./games.service";

// SEE: docs/explanation/games-architecture.md
@Module({
  controllers: [GamesController],
  providers: [GamesService, GamesRepository, Clock],
})
export class GamesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GeneralRateLimitMiddleware).forRoutes("games");
  }
}
