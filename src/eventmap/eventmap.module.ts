import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { BusRateLimitMiddleware } from "../common/private-file";
import { EventMapMaterializerService } from "./eventmap-materializer.service";
import { EventMapController } from "./eventmap.controller";
import { PrivateFile } from "./private-file";
import { EventMapService } from "./eventmap.service";

/**
 * (A perimeter detail is left out of the public history.)
 *
 *
 *
 */
@Module({
  controllers: [EventMapController, PrivateFile],
  providers: [EventMapService, EventMapMaterializerService],
  exports: [EventMapService],
})
export class EventMapModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BusRateLimitMiddleware).forRoutes("eventmap");
  }
}
