/**
 * The bus_overrides write-time validator (scripts/lib/bus-overrides-validator.js)
 * against the read-time schema (busOverrideDoc): over the same documents, a real
 * mongod with the validator applied accepts exactly what the server parses, and
 * so does the check the seed scripts run before writing. A field added to one
 * and not the others fails here, so the two ends cannot drift apart.
 */

import { MongoClient, type Collection } from "mongodb";
import { busOverrideDoc } from "../../../src/bus/schedule/bus-schedule.schema";
import { MONGOD_START_TIMEOUT_MS, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS excluded from tsconfig, so these are requires.
const { BUS_OVERRIDES_VALIDATOR, overrideViolations, assertValidOverrides } = require("../../../scripts/lib/bus-overrides-validator");

const REPLACE = {
  serviceId: "campus-inja",
  date: "2026-10-21",
  type: "replace",
  label: "방학",
  notices: [{ style: "info", text: "2026 하계방학 시간표" }],
  entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null }],
};
const NO_SERVICE = { serviceId: "campus-inja", date: "2026-10-01", type: "noService", label: "축제", notices: [], entries: [] };

const FIELDS = ["serviceId", "date", "type", "label", "notices", "entries"];
const VALUES: unknown[] = [null, 1, true, "", "x", "replace", "noService", [], [{}], [[]], [1], ["a"], {}, { a: 1 }];

type Doc = Record<string, unknown>;

function without(doc: Doc, field: string): Doc {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => key !== field));
}

/** Every base document with each field missing, and with each field set to each value. */
function variants(): Array<[string, Doc]> {
  const cases: Array<[string, Doc]> = [];
  for (const [name, base] of [["replace", REPLACE], ["noService", NO_SERVICE]] as const) {
    cases.push([`${name} as written`, base]);
    for (const field of FIELDS) {
      cases.push([`${name} without ${field}`, without(base, field)]);
      for (const value of VALUES) cases.push([`${name} with ${field}=${JSON.stringify(value)}`, { ...base, [field]: value }]);
    }
  }
  return cases;
}

let mongod: TestMongod;
let client: MongoClient;
let overrides: Collection<Doc>;

beforeAll(async () => {
  mongod = await startMongod();
  client = await MongoClient.connect(mongod.uri);
  const db = client.db("bus_campus_test");
  await db.createCollection("bus_overrides", { validator: BUS_OVERRIDES_VALIDATOR, validationAction: "error", validationLevel: "strict" });
  overrides = db.collection("bus_overrides");
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

async function isAcceptedByMongod(doc: Doc): Promise<boolean> {
  try {
    await overrides.insertOne({ ...doc });
    return true;
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 121) return false;
    throw err;
  }
}

describe("BUS_OVERRIDES_VALIDATOR", () => {
  it.each(variants())("%s: mongod accepts it exactly when busOverrideDoc parses it", async (_name, doc) => {
    // Act
    const accepted = await isAcceptedByMongod(doc);

    // Assert
    expect(accepted).toBe(busOverrideDoc.safeParse(doc).success);
  });
});

describe("overrideViolations", () => {
  it.each(variants())("%s: finds nothing exactly when busOverrideDoc parses it", (_name, doc) => {
    // Act
    const violations: string[] = overrideViolations(doc);

    // Assert
    expect(violations.length === 0).toBe(busOverrideDoc.safeParse(doc).success);
  });
});

describe("assertValidOverrides", () => {
  it("passes the documents the seed scripts write", () => {
    // Act & Assert
    expect(() => assertValidOverrides([REPLACE, NO_SERVICE])).not.toThrow();
  });

  it("names every bad document and what is wrong with it", () => {
    // Act & Assert
    expect(() => assertValidOverrides([REPLACE, without(REPLACE, "entries"), { ...NO_SERVICE, type: "closed" }])).toThrow(
      /campus-inja\/2026-10-21: .*entries[\s\S]*campus-inja\/2026-10-01: .*type/,
    );
  });
});
