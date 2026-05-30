import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from "@nestjs/common";
import { NoticesOverviewRateLimitMiddleware } from "../http/notices-overview-rate-limit.middleware";
import { NoticesRateLimitMiddleware } from "../http/notices-rate-limit.middleware";
import { RequestAuthenticationMiddleware } from "../http/request-authentication.middleware";

// WHY: auth binds before the limiter so the policy may key on its principal (a guard would run after it); "notices" matches no
// /internal/notices route, so the crawler's ping has neither.

// SEE: docs/explanation/notices-architecture.md
@Module({})
export class NoticesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestAuthenticationMiddleware).forRoutes("notices");
    consumer.apply(NoticesRateLimitMiddleware).forRoutes("notices");
    consumer.apply(NoticesOverviewRateLimitMiddleware).forRoutes({ path: "notices/overview", method: RequestMethod.GET });
  }
}
