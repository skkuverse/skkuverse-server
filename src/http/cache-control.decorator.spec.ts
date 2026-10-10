import { Controller, Get, type INestApplication, Query } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppError } from "./app.error";
import { CacheControl } from "./cache-control.decorator";
import { HttpExceptionFilter } from "./http-exception.filter";
import { ResponseInterceptor } from "./response.interceptor";

@Controller("t")
class CachedController {
  @Get("cached")
  @CacheControl("public, max-age=300")
  cached(@Query("fail") fail?: string) {
    if (fail) throw new AppError("INVALID_PARAMS", "bad", 400);
    return { a: 1 };
  }

  @Get("uncached")
  uncached() {
    return { a: 1 };
  }
}

describe("@CacheControl", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [CachedController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());

  it("sets Cache-Control on a successful response", async () => {
    const res = await request(app.getHttpServer()).get("/t/cached");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("never on an error response, which a shared cache would keep", async () => {
    const res = await request(app.getHttpServer()).get("/t/cached?fail=1");
    expect(res.status).toBe(400);
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("not on a handler without it", async () => {
    const res = await request(app.getHttpServer()).get("/t/uncached");
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});
