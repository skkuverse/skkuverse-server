/**
 * ResponseInterceptor wraps a returned value in { meta: { lang, ...withMeta keys }, data } with
 * X-Response-Time, as sendSuccess() does for an @Res() handler, and leaves errors to the filter.
 */
import { Controller, Get, type INestApplication, Req, Res } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import { AppError } from "./app.error";
import { HttpExceptionFilter } from "./http-exception.filter";
import { ResponseInterceptor, sendSuccess, withMeta } from "./response.interceptor";

@Controller("t")
class EnvelopeController {
  @Get("plain")
  plain() {
    return { a: 1 };
  }

  @Get("meta")
  meta() {
    return withMeta({ a: 1 }, { keyword: "도서", counts: { total: 3 } });
  }

  @Get("raw")
  raw(@Req() req: Request, @Res() res: Response) {
    sendSuccess(req, res, withMeta({ a: 1 }, { keyword: "raw" }));
  }

  @Get("error")
  error() {
    throw new AppError("INVALID_CAMPUS", "campus must be 'hssc' or 'nsc'", 400);
  }
}

describe("ResponseInterceptor", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EnvelopeController] }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: () => void) => {
      req.lang = "ko";
      next();
    });
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());

  it("wraps a returned value in { meta: { lang }, data }", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/plain");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: { a: 1 } });
    expect(res.headers["x-response-time"]).toMatch(/^\d+\.\dms$/);
  });

  it("adds withMeta() keys after lang, as sendSuccess() does", async () => {
    // Act
    const viaReturn = await request(app.getHttpServer()).get("/t/meta");

    // Assert
    expect(viaReturn.body).toEqual({
      meta: { lang: "ko", keyword: "도서", counts: { total: 3 } },
      data: { a: 1 },
    });
    expect(Object.keys(viaReturn.body.meta)).toEqual(["lang", "keyword", "counts"]);
    const viaRes = await request(app.getHttpServer()).get("/t/raw");
    expect(viaRes.body).toEqual({ meta: { lang: "ko", keyword: "raw" }, data: { a: 1 } });
  });

  it("leaves errors to the filter", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/error");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'" } });
  });
});
