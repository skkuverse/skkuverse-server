// QUIRK(sentry): must stay the first import; the SDK instruments http and Express as they are loaded.
import "./instrument";
import "reflect-metadata";

import * as Sentry from "@sentry/nestjs";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import logger from "./infra/logger";
import config from "./infra/config";
import { closeClient, ping as pingDb } from "./infra/db";
import { AppModule } from "./app.module";
import { bootstrapHttpApp } from "./http/http-app.bootstrap";

const SHUTDOWN_TIMEOUT_MS = 5000;
const SENTRY_FLUSH_MS = 2000;

// WHY: a failed ping only warns, so a database outage at boot does not crash-loop the container;
// /health/ready reports it.
async function pingDatabase(): Promise<void> {
  try {
    await pingDb();
    logger.info({ event: "db.connected" }, "MongoDB connected");
  } catch (err) {
    logger.warn({ event: "db.connect_failed", err }, "MongoDB connection failed");
  }
}

function exitOnSignals(app: NestExpressApplication, message: string): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: "app.shutdown_started", signal }, message);
    const forceExit = setTimeout(() => {
      logger.error({ event: "app.shutdown_timed_out" }, "Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    await app.close();
    await closeClient();
    await Sentry.close(SENTRY_FLUSH_MS);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// WHY: init() runs the lifecycle hooks, so PollerRegistryService starts the pollers, and binds no port.
async function runPoller(app: NestExpressApplication, role: string): Promise<void> {
  logger.info({ event: "app.poller_mode", role, perimeter: config.perimeter.mode, ...config.getSideEffectsSummary() }, "Running in poller-only mode");
  await app.init();
  exitOnSignals(app, "Shutting down poller...");
}

async function serveHttp(app: NestExpressApplication, role: string): Promise<void> {
  await app.listen(config.port, config.host);
  logger.info(
    {
      event: "app.started",
      mode: config.getModeLabel(),
      port: config.port,
      host: config.host,
      perimeter: config.perimeter.mode,
      db: config.mongo.dbName,
      api: config.useProdApi ? "PROD" : "DEV",
      role,
      ...config.getSideEffectsSummary(),
    },
    "Server started (NestJS)",
  );
  exitOnSignals(app, "Shutting down...");
}

async function bootstrap(): Promise<void> {
  const app = await bootstrapHttpApp((adapter, options) =>
    NestFactory.create<NestExpressApplication>(AppModule, adapter, options),
  );
  app.enableShutdownHooks();
  await pingDatabase();
  const role = config.role();
  if (role === "poller") await runPoller(app, role);
  else await serveHttp(app, role);
}

// QUIRK(sentry): instrument.ts registers the SDK's handlers first and they capture the error; with these present the
// SDK leaves the exit to us. Without them a crash never reaches the JSON log; exiting is kept because the process
// state is unknown, and the container restarts it.
function exitAfterFlush(): void {
  void Sentry.flush(SENTRY_FLUSH_MS).finally(() => process.exit(1));
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
