// Must stay first: Sentry instruments http and Express as they are loaded.
import "./instrument";
import "reflect-metadata";

import * as Sentry from "@sentry/nestjs";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import logger from "./infra/logger";
import config from "./infra/config";
import { closeClient, ping as pingDb } from "./infra/db";
import { AppModule } from "./app.module";
import { httpPipelineMiddleware } from "./http/http-pipeline.middleware";
import { BusCacheService } from "./bus/cache/bus-cache.service";

/**
 * NestJS entrypoint:
 *  - the HTTP pipeline (http/http-pipeline.middleware.ts): trust proxy,
 *    helmet, request logging, JSON body, LangMiddleware, no-store, CORS,
 *    the Nest logger, the global ResponseInterceptor + HttpExceptionFilter
 *  - ROLE branch (poller: init only, no listen; api/combined: listen)
 *  - graceful shutdown (enableShutdownHooks + 5s force-exit + closeClient)
 */
async function bootstrap(): Promise<void> {
  const app = await httpPipelineMiddleware((adapter, options) =>
    NestFactory.create<NestExpressApplication>(AppModule, adapter, options),
  );
  app.enableShutdownHooks();

  // Verify MongoDB connectivity (non-fatal — bus/station read from cache).
  try {
    await pingDb();
    logger.info({ event: "db.connected" }, "MongoDB connected");
  } catch (err) {
    logger.warn(
      { event: "db.connect_failed", err },
      "MongoDB connection failed",
    );
  }

  // Ensure bus_cache TTL index exists (non-fatal). Runs for every ROLE (NOT
  // ROLE-gated). The schedule indexes are ensured by
  // ScheduleService.onModuleInit instead.
  try {
    await app.get(BusCacheService).ensureIndex();
    logger.info({ event: "bus.cache.index_ensured" }, "bus_cache TTL index ensured");
  } catch (err) {
    logger.warn(
      { event: "bus.cache.index_failed", err },
      "bus_cache TTL index setup failed",
    );
  }

  const role = process.env.ROLE || "combined";

  if (role === "poller") {
    // Poller-only: run lifecycle hooks (onApplicationBootstrap starts pollers)
    // but do NOT bind an HTTP listener.
    logger.info(
      { event: "app.poller_mode", role, ...config.getSideEffectsSummary() },
      "Running in poller-only mode",
    );
    await app.init();
    let shuttingDownPoller = false;
    const shutdownPoller = async (signal: NodeJS.Signals): Promise<void> => {
      if (shuttingDownPoller) return;
      shuttingDownPoller = true;
      logger.info({ event: "app.shutdown_started", signal }, "Shutting down poller...");
      const forceExit = setTimeout(() => {
        logger.error({ event: "app.shutdown_timed_out" }, "Shutdown timed out, forcing exit");
        process.exit(1);
      }, 5000);
      forceExit.unref();
      await app.close(); // triggers onApplicationShutdown → stopAll()
      await closeClient();
      await Sentry.close(2000); // send buffered logs before the process goes
      process.exit(0);
    };
    process.on("SIGTERM", shutdownPoller);
    process.on("SIGINT", shutdownPoller);
    return;
  }

  // api / combined: bind HTTP. Pollers (combined) are started by
  // PollerRegistryService.onApplicationBootstrap (ROLE !== "api").
  await app.listen(config.port);
  logger.info(
    {
      event: "app.started",
      mode: config.getModeLabel(),
      port: config.port,
      db: config.mongo.dbName,
      api: config.useProdApi ? "PROD" : "DEV",
      role,
      // push / rateLimit / buildingSync / cache / shuttleEta as resolved (infra/runtime-switches.ts)
      ...config.getSideEffectsSummary(),
    },
    "Server started (NestJS)",
  );

  // Graceful shutdown.
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: "app.shutdown_started", signal }, "Shutting down...");
    const forceExit = setTimeout(() => {
      logger.error({ event: "app.shutdown_timed_out" }, "Shutdown timed out, forcing exit");
      process.exit(1);
    }, 5000);
    forceExit.unref();
    await app.close(); // runs onApplicationShutdown → stopAll()
    await closeClient();
    await Sentry.close(2000); // send buffered logs before the process goes
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Without these, Node prints a crash to stderr as plain text and exits, and
// the reason never reaches the JSON log. Exiting is kept: after an uncaught
// error the process state is unknown, and the container restarts it.
//
// Sentry's own handlers (registered by instrument.ts, so they run first)
// capture the error; because these handlers exist, Sentry leaves the exit to
// us, and the flush gives the event up to 2 s to leave.
function exitAfterFlush(): void {
  void Sentry.flush(2000).finally(() => process.exit(1));
}
process.on("uncaughtException", (err, origin) => {
  logger.fatal(
    { event: "process.uncaught_exception", err, origin },
    "Uncaught exception — exiting",
  );
  exitAfterFlush();
});
process.on("unhandledRejection", (reason) => {
  logger.fatal(
    { event: "process.unhandled_rejection", err: reason },
    "Unhandled promise rejection — exiting",
  );
  exitAfterFlush();
});

bootstrap().catch((err) => {
  logger.fatal({ event: "app.bootstrap_failed", err }, "Nest bootstrap failed");
  Sentry.captureException(err);
  exitAfterFlush();
});
