/**
 * WHY: services log through the `logger` singleton, not `req.log`, so the request middleware opens
 * this scope and the logger's mixin copies it into every line; a line without reqId ran outside a request.
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
