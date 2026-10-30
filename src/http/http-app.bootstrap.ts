import type { NestApplicationOptions } from "@nestjs/common";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import helmet from "helmet";
import config from "../infra/config";
import { mountRequestLogging } from "../infra/http-logging";
import { PinoNestLogger } from "../infra/nest-logger";
import { OriginTrust } from "../perimeter/perimeter.ports";
import { corsOptions } from "./cors.config";
import { HttpExceptionFilter } from "./http-exception.filter";
import { jsonBodyOptions } from "./json-body.config";
import { LangMiddleware } from "./lang.middleware";
import { localDevRequestFilter } from "./local-dev-request.middleware";
import { noStoreMiddleware } from "./no-store.middleware";
import { ResponseInterceptor } from "./response.interceptor";

type CreateApp = (adapter: ExpressAdapter, options: NestApplicationOptions) => NestExpressApplication | Promise<NestExpressApplication>;

/**
 * WHY: main.ts and the route tests create the app differently, so the caller passes `create` and both get this
 * pipeline, and the routes whose raw body is kept, which the features own (ADR 0023, D6).
 */
export async function bootstrapHttpApp(create: CreateApp, rawBodyRoutePaths: readonly string[]): Promise<NestExpressApplication> {
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  // WHY: the app sends only scalar keys, so no bracketed key (`a[b]=1`) may reach a schema as a nested object.
  expressInstance.set("query parser", "simple");
  if (config.perimeter.mode === "local-dev") expressInstance.use(localDevRequestFilter);
  expressInstance.use(helmet());
  mountRequestLogging(expressInstance);
  expressInstance.use(express.json(jsonBodyOptions(rawBodyRoutePaths)));

  // WHY: a raw mount, not forRoutes("*"), fixes its place ahead of every module's middleware, whose early
  // answers (auth, rate limit) read the response timer it starts.
  const langMiddleware = new LangMiddleware();
  expressInstance.use((req, res, next) => langMiddleware.use(req as never, res as never, next));

  // WHY: with CACHE=off every Cache-Control becomes no-store, so the phone's HTTP cache never answers.
  if (!config.cache.enabled) expressInstance.use(noStoreMiddleware);

  // WHY: express.json above is the only body parser; without this option Nest adds its own, an extended
  // urlencoded one among them, and a form body would reach the handlers parsed.
  const app = await create(new ExpressAdapter(expressInstance), { logger: new PinoNestLogger(), bodyParser: false });

  // SEE: docs/decisions/0023-perimeter-ports.md ("D5. CORS before dependency injection")
  app.enableCors(corsOptions(app.get(OriginTrust)));

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
