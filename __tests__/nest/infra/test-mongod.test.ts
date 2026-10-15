/**
 * The real `mongod` test helper (`__tests__/helpers/mongod.ts`, harden-test-suite
 * design D6): it starts the pinned binary on loopback, the app's own Mongo client
 * (src/infra/db.ts) reaches it through MONGO_URL when loaded after the start, and
 * a document written through that client reads back.
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, freeLoopbackPort, startMongod, type TestMongod } from "../../helpers/mongod";

type Db = typeof import("../../../src/infra/db");

const PINNED_VERSION = (
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8")) as {
    config: { mongodbMemoryServer: { version: string } };
  }
).config.mongodbMemoryServer.version;

let mongod: TestMongod;
let db: Db;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  assertConfigReaches(mongod, (require("../../../src/infra/config") as { mongo: { url: string } }).mongo.url);
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

describe("startMongod", () => {
  it("serves on loopback, through the app's own client", () => {
    // Assert
    expect(mongod.uri).toMatch(/^mongodb:\/\/127\.0\.0\.1:\d+\/$/);
    expect(process.env.MONGO_URL).toBe(mongod.uri);
  });

  it("runs the version package.json pins, the one Atlas runs", async () => {
    // Act
    const info = await db.getClient().db("admin").command({ buildInfo: 1 });

    // Assert
    expect(info.version).toBe(PINNED_VERSION);
  });

  it("reads back a document written through src/infra/db", async () => {
    // Arrange
    const collection = db.getClient().db("smoke_test").collection<{ _id: string; n: number }>("smoke");

    // Act
    await collection.insertOne({ _id: "one", n: 1 });
    const found = await collection.findOne({ _id: "one" });

    // Assert
    expect(found).toEqual({ _id: "one", n: 1 });
  });
});

describe("startMongod's mongod", () => {
  it("runs with the TTL monitor off, so a frozen-clock document is never reaped mid-test", async () => {
    // Act
    const parameter = await db.getClient().db("admin").command({ getParameter: 1, ttlMonitorEnabled: 1 });

    // Assert
    expect(parameter.ttlMonitorEnabled).toBe(false);
  });

  it(
    "starts on another port when the one it picked is taken before mongod binds it",
    async () => {
      // Arrange
      const holder = net.createServer();
      await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
      const taken = (holder.address() as net.AddressInfo).port;
      const ports = [Promise.resolve(taken), freeLoopbackPort()];
      const previousUrl = process.env.MONGO_URL;
      let second: TestMongod | undefined;

      try {
        // Act
        second = await startMongod(() => ports.shift() ?? freeLoopbackPort());

        // Assert
        expect(second.uri).toMatch(/^mongodb:\/\/127\.0\.0\.1:\d+\/$/);
        expect(second.uri).not.toContain(`:${taken}/`);
      } finally {
        await second?.stop();
        await new Promise<void>((resolve) => holder.close(() => resolve()));
        process.env.MONGO_URL = previousUrl;
      }
    },
    MONGOD_START_TIMEOUT_MS,
  );
});
