import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { SupportedLang } from "../infra/types";

/**
 * The request's language as LangMiddleware set it: `@Lang() lang: SupportedLang`.
 * main.ts runs LangMiddleware before every handler, so a missing value is a
 * wiring error: it throws, and the 500 reaches Sentry, instead of defaulting.
 */
export const Lang = createParamDecorator((_data: unknown, ctx: ExecutionContext): SupportedLang => {
  const { lang } = ctx.switchToHttp().getRequest<Request>();
  if (!lang) throw new Error("req.lang is unset: LangMiddleware did not run before this handler");
  return lang;
});
