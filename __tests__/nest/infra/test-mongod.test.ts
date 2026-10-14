/**
 * The real `mongod` test helper (`__tests__/helpers/mongod.ts`, harden-test-suite
 * design D6): it starts the pinned binary on loopback, the app's own Mongo client
 * (src/infra/db.ts) reaches it through MONGO_URL when loaded after the start, and
 * a document written through that client reads back.
 */
import fs from "node:fs";
import path from "node:path";
import { startMongod, type TestMongod } from "../../helpers/mongod";

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
});

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
