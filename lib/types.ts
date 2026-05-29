import type { Logger } from "pino";

export type SupportedLang = "ko" | "en" | "zh";

// (A perimeter detail is left out of the public history.)
declare global {
  namespace Express {
    interface Request {
      // Optional because /api-docs and other routes mounted before langMiddleware
      // (see index.js) receive Request before req.lang is populated. Consumers
      // must `?? "ko"` or null-check; the langMiddleware-mounted subtree can
      // narrow this with a type guard or assertion at the route layer.
      lang?: SupportedLang;
      uid?: string;
      // pino-http installs `log` on every request; preserve original
      // fail-loud behavior — accessing `.warn` on undefined throws → 500
      // → ops alert. Tests using miniApp without pino-http hit the same
      // throw path, matching original .js semantics.
      log: Logger;
    }
    interface Response {
      success(data: unknown, meta?: Record<string, unknown>): void;
      error(statusCode: number, code: string, message: string): void;
    }
  }
}

export {};
