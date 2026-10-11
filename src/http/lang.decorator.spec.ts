/** @Lang passes the language LangMiddleware set, and fails the request when it did not run. */
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import type { SupportedLang } from "../infra/types";
import { HttpExceptionFilter } from "./http-exception.filter";
import { Lang } from "./lang.decorator";
import { LangMiddleware } from "./lang.middleware";

@Controller("t")
class LangController {
  @Get()
  read(@Lang() lang: SupportedLang) {
    return { lang };
  }
}

async function buildApp({ langMiddleware }: { langMiddleware: boolean }): Promise<INestApplication> {
  const expressInstance = express();
  if (langMiddleware) {
    const lang = new LangMiddleware();
    expressInstance.use((req, res, next) => lang.use(req as never, res as never, next));
  }
  const moduleRef = await Test.createTestingModule({ controllers: [LangController] }).compile();
  const app = moduleRef.createNestApplication(new ExpressAdapter(expressInstance), {
    bodyParser: false,
    logger: false,
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, "127.0.0.1");
  return app;
}

describe("@Lang", () => {
  it("passes the language LangMiddleware set", async () => {
    // Arrange
    const app = await buildApp({ langMiddleware: true });

    // Act
    const res = await request(app.getHttpServer()).get("/t").set("Accept-Language", "en-US,en;q=0.9");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lang: "en" });
    await app.close();
  });

  it("fails the request when LangMiddleware did not run, instead of defaulting", async () => {
    // Arrange
    const app = await buildApp({ langMiddleware: false });

    // Act
    const res = await request(app.getHttpServer()).get("/t");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    await app.close();
  });
});
