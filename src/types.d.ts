// QUIRK(pino-http): its types augment http.IncomingMessage only, which does not reach Express.Request in every
// consumer setup, so `log` is declared here. tsconfig.test.json lists this file by name.
import type { Logger } from "pino";
import type { SupportedLang } from "./infra/types";

declare global {
  namespace Express {
    interface Request {
      // WHY: optional because middleware mounted before LangMiddleware (request logging) sees the request first;
      // a handler takes @Lang(), which throws when it is unset.
      lang?: SupportedLang;
      uid?: string;
      // WHY: the JSON body's bytes, kept on the push path only (ADR 0023, D6); decoded when it came with a Content-Encoding.
      rawBody?: Buffer;
      // WHY: non-optional so a missing logger fails loud: reading `.warn` on undefined throws, a 500 that alerts.
      // A test app without request logging takes the same path.
      log: Logger;
      // WHY: X-Response-Time counts from here, LangMiddleware's startResponseTimer(), which bootstrapHttpApp
      // mounts after helmet, request logging and the JSON body parser, not at request entry.
      __startNs?: bigint;
    }
  }
}

export {};
