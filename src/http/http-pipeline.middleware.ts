import type { NestApplicationOptions } from "@nestjs/common";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import helmet from "helmet";
import config from "../infra/config";
import { mountRequestLogging } from "../infra/http-logging";
import { PinoNestLogger } from "../infra/nest-logger";
import { CORS_METHODS, corsOrigins, EXPOSED_RESPONSE_HEADERS } from "../infra/origins";
import { HttpExceptionFilter } from "./http-exception.filter";
import { LangMiddleware } from "./lang.middleware";
import { noStoreMiddleware } from "./no-store.middleware";
import { ResponseInterceptor } from "./response.interceptor";

/** WHY: main.ts and the route tests create the app differently, so the caller passes `create` and both get this pipeline. */
export async function httpPipelineMiddleware(
  create: (
    adapter: ExpressAdapter,
    options: NestApplicationOptions,
  ) => NestExpressApplication | Promise<NestExpressApplication>,
): Promise<NestExpressApplication> {
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  expressInstance.use(helmet());
  mountRequestLogging(expressInstance);
  expressInstance.use(express.json({ limit: "100kb" }));

  // QUIRK(nestjs): forRoutes("*") never fires against a pre-built ExpressAdapter, so LangMiddleware
  // is mounted here as raw Express middleware, before any handler.
  const langMiddleware = new LangMiddleware();
  expressInstance.use((req, res, next) => langMiddleware.use(req as never, res as never, next));

  // WHY: with CACHE=off every Cache-Control becomes no-store, so the phone's HTTP cache never answers.
  if (!config.cache.enabled) expressInstance.use(noStoreMiddleware);

  // QUIRK(nestjs): Nest's own body parser reads `app.router`, which express 4.22 made throw, so it is off;
  // express.json above parses the body instead.
  const app = await create(new ExpressAdapter(expressInstance), {
    logger: new PinoNestLogger(),
    bodyParser: false,
  });

  // WHY: read-only methods from first-party origins, so a page cannot preflight a POST to /internal/*.
  app.enableCors({
    origin: corsOrigins(config.isDevelopment),
    methods: [...CORS_METHODS],
    exposedHeaders: EXPOSED_RESPONSE_HEADERS,
    credentials: false,
    maxAge: 86400,
  });

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
