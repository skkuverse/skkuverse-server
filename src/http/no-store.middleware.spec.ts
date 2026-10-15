/**
 * noStoreMiddleware, mounted by main.ts under CACHE=off. Handlers set
 * Cache-Control after middleware runs, so it must win however a route sets the
 * header — Express's res.set, a raw res.setHeader, or one Nest's @Header turns
 * into res.set. isSharedCacheable still reads what the handler declared, so the envelope is the
 * same with CACHE=off as in production.
 */
import express from "express";
import request from "supertest";
import { LoopbackServers } from "../../__tests__/helpers/nest/loopback-servers";
import { isSharedCacheable, noStoreMiddleware } from "./no-store.middleware";

function app(): express.Express {
  const a = express();
  a.use(noStoreMiddleware);
  a.get("/set", (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400").json({ ok: true });
  });
  a.get("/raw", (_req, res) => {
    res.setHeader("cache-control", "public, max-age=300");
    res.json({ ok: true });
  });
  a.get("/append", (_req, res) => {
    res.appendHeader("Cache-Control", "max-age=7");
    res.json({ ok: true });
  });
  a.get("/none", (_req, res) => {
    res.json({ ok: true });
  });
  a.get("/other", (_req, res) => {
    res.set("X-Other", "kept").json({ ok: true });
  });
  return a;
}

describe("noStoreMiddleware", () => {
  const servers = new LoopbackServers();
  afterEach(() => servers.closeAll());

  it.each(["/set", "/raw", "/append", "/none"])("%s answers with Cache-Control: no-store", async (path) => {
    // Arrange
    const server = await servers.serve(app());

    // Act
    const res = await request(server).get(path);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("leaves every other header alone", async () => {
    // Arrange
    const server = await servers.serve(app());

    // Act
    const res = await request(server).get("/other");

    // Assert
    expect(res.headers["x-other"]).toBe("kept");
  });
});

describe("isSharedCacheable", () => {
  const servers = new LoopbackServers();
  afterEach(() => servers.closeAll());

  function echo(withMiddleware: boolean, set?: string): express.Express {
    const a = express();
    if (withMiddleware) a.use(noStoreMiddleware);
    a.get("/", (_req, res) => {
      if (set !== undefined) res.setHeader("Cache-Control", set);
      res.json({ shared: isSharedCacheable(res) });
    });
    return a;
  }

  it.each([
    [true, "public, max-age=300", true],
    [true, undefined, false],
    [false, "max-age=0, S-Maxage=600", true],
    [false, "private, max-age=60", false],
    [false, "no-store", false],
    [false, undefined, false],
  ])("with the middleware %s and a handler setting %s, answers %s", async (withMiddleware, set, expected) => {
    // Arrange
    const server = await servers.serve(echo(withMiddleware, set));

    // Act
    const res = await request(server).get("/");

    // Assert
    expect(res.body.shared).toBe(expected);
  });
});
