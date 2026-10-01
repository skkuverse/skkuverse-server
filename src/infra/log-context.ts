/**
 * Per-request log context.
 *
 * Services, data modules and the exception filter log through the shared
 * `logger` singleton, not `req.log`, so a request id has to reach them without
 * being passed down. The request middleware (infra/http-logging.ts) opens an
 * AsyncLocalStorage scope per request, and the logger's `mixin` copies the
 * store into every line written inside it.
 *
 * Outside a request (pollers, boot, shutdown) there is no store and lines carry
 * no reqId — which is itself the signal that a line is not request-driven.
 */
import { AsyncLocalStorage } from "async_hooks";

export interface LogContext {
  reqId: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentLogContext(): LogContext | undefined {
  return storage.getStore();
}
