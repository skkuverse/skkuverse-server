// Express Request augmentation for the NestJS app. Picked up by tsconfig
// include "src/**/*"; tsconfig.test.json lists this file by name.
// req.lang is set by LangMiddleware; req.uid by FirebaseAuthMiddleware.
// req.log is set by pino-http (declared here because pino-http only augments
// http.IncomingMessage, and the augmentation does not propagate to
// Express.Request reliably across all consumer setups).
import type { Logger } from "pino";
import type { SupportedLang } from "./infra/types";

declare global {
  namespace Express {
    interface Request {
      // Optional because middleware mounted before LangMiddleware (request
      // logging in main.ts) receives Request before req.lang is populated.
      // Consumers must `?? "ko"` or null-check; handlers behind LangMiddleware
      // can narrow this with a type guard or assertion at the route layer.
      lang?: SupportedLang;
      uid?: string;
      // pino-http installs `log` on every request. Declared non-optional so a
      // missing logger fails loud — accessing `.warn` on undefined throws →
      // 500 → ops alert. A test app without request logging hits the same
      // throw path.
      log: Logger;
      // WHY: X-Response-Time counts from here, LangMiddleware's startResponseTimer(), which bootstrapHttpApp
      // mounts after helmet, request logging and the JSON body parser, not at request entry.
      __startNs?: bigint;
    }
  }
}

export {};
