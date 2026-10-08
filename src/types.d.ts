// Express Request augmentation for the NestJS app (additive; repeats
// src/infra/types.ts and adds __startNs used by the X-Response-Time machinery
// in src/common). Picked up by tsconfig include "src/**/*".
import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      lang?: import("./infra/types").SupportedLang;
      uid?: string;
      log: Logger;
      // Stashed by LangMiddleware at the front of the chain so every
      // X-Response-Time (sendSuccess(), HttpExceptionFilter, ...) is measured
      // from request entry.
      __startNs?: bigint;
    }
    interface Response {
      success(data: unknown, meta?: Record<string, unknown>): void;
      error(statusCode: number, code: string, message: string): void;
    }
  }
}

export {};
