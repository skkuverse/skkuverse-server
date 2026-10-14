/**
 * EtagInterceptor sends a returned value's ETag, and answers a request whose
 * If-None-Match equals it exactly with a bare 304: no body, no ETag, no
 * Cache-Control, no X-Response-Time. A weak, listed or `*` match is left to
 * Express's own freshness check, which answers 304 with the success headers.
 */
import { Controller, Get, type INestApplication, UseInterceptors } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CacheControl } from "./cache-control.decorator";
import { EtagInterceptor, withEtag } from "./etag.interceptor";
import { HttpExceptionFilter } from "./http-exception.filter";
import { ResponseInterceptor } from "./response.interceptor";

const ETAG = '"week-x-2026-10-19-abc"';

@Controller("t")
class TaggedController {
  @Get("tagged")
  @UseInterceptors(EtagInterceptor)
  @CacheControl("public, max-age=300")
  tagged() {
    return withEtag({ a: 1 }, ETAG);
  }

  @Get("plain")
  @UseInterceptors(EtagInterceptor)
  plain() {
    return { b: 2 };
  }
}

describe("EtagInterceptor", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [TaggedController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends the ETag with the enveloped value and its Cache-Control", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/tagged");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(ETAG);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.body.data).toEqual({ a: 1 });
  });

  it("answers an exact If-None-Match with a bare 304", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/tagged").set("If-None-Match", ETAG);

    // Assert
    expect(res.status).toBe(304);
    expect(res.text).toBe("");
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers["x-response-time"]).toBeUndefined();
  });

  it.each([`W/${ETAG}`, `${ETAG}, "other"`, "*"])("leaves If-None-Match %s to Express: 304 with the ETag", async (header) => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/tagged").set("If-None-Match", header);

    // Assert
    expect(res.status).toBe(304);
    expect(res.headers.etag).toBe(ETAG);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("answers a different ETag with the full body", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/tagged").set("If-None-Match", '"stale"');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ a: 1 });
  });

  it("leaves a value without an ETag as it is", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/plain");

    // Assert
    expect(res.body.data).toEqual({ b: 2 });
    expect(res.headers.etag).toMatch(/^W\//);
  });
});
