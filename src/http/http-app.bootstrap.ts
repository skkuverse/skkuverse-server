import type { NestApplicationOptions } from "@nestjs/common";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import express, { type Request } from "express";
import type { IncomingMessage } from "node:http";
import helmet from "helmet";
import config from "../infra/config";
import { mountRequestLogging } from "../infra/http-logging";
import { PinoNestLogger } from "../infra/nest-logger";
import { OriginTrust } from "../perimeter/perimeter.ports";
import { corsOptions } from "./cors.config";
import { HttpExceptionFilter } from "./http-exception.filter";
import { LangMiddleware } from "./lang.middleware";
import { localDevRequestFilter } from "./local-dev-request.middleware";
import { noStoreMiddleware } from "./no-store.middleware";
import { ResponseInterceptor } from "./response.interceptor";

// SEE: docs/decisions/0023-perimeter-ports.md ("D6. Signed calls") — the one path whose raw body is kept.
const RAW_BODY_PATH_RE = /^\/internal\/miniapps\/[^/?]+\/notifications(?:\?|$)/;

function keepRawBody(req: IncomingMessage, _res: unknown, body: Buffer): void {
  if (RAW_BODY_PATH_RE.test(req.url ?? "")) (req as Request).rawBody = body;
}

type CreateApp = (adapter: ExpressAdapter, options: NestApplicationOptions) => NestExpressApplication | Promise<NestExpressApplication>;

/** WHY: main.ts and the route tests create the app differently, so the caller passes `create` and both get this pipeline. */
export async function bootstrapHttpApp(create: CreateApp): Promise<NestExpressApplication> {
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  if (config.perimeter.mode === "local-dev") expressInstance.use(localDevRequestFilter);
  expressInstance.use(helmet());
  mountRequestLogging(expressInstance);
  expressInstance.use(express.json({ limit: "100kb", verify: keepRawBody }));

  // QUIRK(nestjs): forRoutes("*") never fires against a pre-built ExpressAdapter, so LangMiddleware
  // is mounted here as raw Express middleware, before any handler.
  const langMiddleware = new LangMiddleware();
  expressInstance.use((req, res, next) => langMiddleware.use(req as never, res as never, next));

  // WHY: with CACHE=off every Cache-Control becomes no-store, so the phone's HTTP cache never answers.
  if (!config.cache.enabled) expressInstance.use(noStoreMiddleware);

  // QUIRK(nestjs): Nest's own body parser reads `app.router`, which express 4.22 made throw, so it is off;
  // express.json above parses the body instead.
  const app = await create(new ExpressAdapter(expressInstance), { logger: new PinoNestLogger(), bodyParser: false });

  // SEE: docs/decisions/0023-perimeter-ports.md ("D5. CORS before dependency injection")
  app.enableCors(corsOptions(app.get(OriginTrust)));

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
