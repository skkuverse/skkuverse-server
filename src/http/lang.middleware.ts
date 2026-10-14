import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { SUPPORTED_LANGS, type SupportedLang } from "../infra/types";
import { startResponseTimer } from "../infra/response-time";

const SUPPORTED: readonly SupportedLang[] = SUPPORTED_LANGS;

@Injectable()
export class LangMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    startResponseTimer(req);
    const header = req.headers["accept-language"] || "ko";
    const primary = header.split(",")[0] ?? "ko";
    const candidate = (primary.split("-")[0] ?? "ko").toLowerCase();
    req.lang = (SUPPORTED as readonly string[]).includes(candidate)
      ? (candidate as SupportedLang)
      : "ko";
    res.set("Vary", "Accept-Language");
    next();
  }
}
