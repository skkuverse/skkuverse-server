/**
 * The server's .env is rendered from Doppler by scripts/render_env.py, which
 * writes exactly the names in config/env.{prd,dev}.keys and fails if Doppler
 * holds one name more or less. Those two lists are the contract between this
 * code and Doppler, and this file keeps them honest:
 *
 *   - a .env holding only the listed names passes the bootstrap validation, so
 *     a rendered file always boots;
 *   - every listed name is read somewhere in src/, so no dead key is rendered;
 *   - no listed name is also set inline in docker-compose.yml, where the inline
 *     value would silently win over the rendered one;
 *   - config.ts and the Nest bootstrap both check the one required list in
 *     src/infra/required-env.ts, so the two fail-loud layers cannot drift apart;
 *   - with every poller-scoped name gone, an api replica passes the check,
 *     boots every module and serves the bus, subway and map read routes from
 *     fakes (ADR 0012, D4), so no import, boot or read path needs a poller key.
 *
 * Files are read with patterns rather than parsers: their shape is fixed and
 * the repo avoids the dependency.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { requiredValues } from "../../../src/infra/required-env";

type BuildApiReplicaApp = typeof import("../../helpers/nest/api-replica-app")["buildApiReplicaApp"];

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function allowlist(rel: string): string[] {
  return read(rel)
    .split("\n")
    .map((line) => line.split("#", 1)[0]!.trim())
    .filter(Boolean);
}


function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    // A spec may name a variable without the app reading it.
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

const PRD = allowlist("config/env.prd.keys");
const DEV = allowlist("config/env.dev.keys");
// Production adds SENTRY_DSN, so its list is the longest.
const REQUIRED = requiredValues({ NODE_ENV: "production" }).map((v) => v.env);

/** Run describeMissingRequired() with exactly `names` set, under `nodeEnv`. */
function missingWithOnly(names: string[], nodeEnv: string): string[] {
  const touched = new Set([...REQUIRED, ...names, "NODE_ENV", "USE_PROD_API", "API_HSSC_NEW_DEV"]);
  const saved = new Map([...touched].map((k) => [k, process.env[k]]));
  try {
    for (const k of touched) delete process.env[k];
    for (const k of names) process.env[k] = `value-of-${k}`;
    process.env.NODE_ENV = nodeEnv;
    let missing: string[] = [];
    jest.isolateModules(() => {
      missing = require("../../../src/infra/required-env").describeMissingRequired();
    });
    return missing;
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("config/env.*.keys — the names render_env.py writes", () => {
  it("config.ts and ConfigModule check the shared list and keep none of their own", () => {
    for (const rel of ["src/infra/config.ts", "src/config/config.module.ts"]) {
      // Act & Assert
      expect(read(rel)).toMatch(/from "(?:\.\.\/infra|\.)\/required-env"/);
      expect(read(rel)).not.toMatch(/const required\b/);
    }
  });

  it.each([
    ["prd", PRD, "production"],
    ["dev", DEV, "development"],
  ])("a .env with only the %s names passes bootstrap validation", (_label, names, nodeEnv) => {
    // Act & Assert
    expect(missingWithOnly(names, nodeEnv)).toEqual([]);
  });

  it("the validation really fails when a listed required name is absent", () => {
    // Arrange
    const withoutMongo = PRD.filter((n) => n !== "MONGO_URL");

    // Act & Assert
    expect(missingWithOnly(withoutMongo, "production")).toEqual(["  mongo.url (env: MONGO_URL)"]);
  });

  it("every listed name is read somewhere in src/", () => {
    // Arrange
    const source = sourceFiles(path.join(root, "src"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");

    // Act
    const unread = [...new Set([...PRD, ...DEV])].filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(source),
    );

    // Assert
    expect(unread).toEqual([]);
  });

  it("no listed name is also set inline in docker-compose.yml", () => {
    // Act
    const inline = new Set(
      [...read("docker-compose.yml").matchAll(/^\s*-\s*([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]!),
    );

    // Assert
    expect(inline.size).toBeGreaterThan(0);
    expect(PRD.filter((name) => inline.has(name))).toEqual([]);
  });

  it.each([
    ["prd", PRD],
    ["dev", DEV],
  ])("the %s list has no duplicates", (_label, names) => {
    // Act & Assert
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("an api replica without the pollers' keys", () => {
  const POLLER_NAMES = [...requiredValues({ NODE_ENV: "production" }).filter((v) => v.scope === "poller").map((v) => v.env), "API_HSSC_NEW_DEV"];
  const saved = new Map([...POLLER_NAMES, "ROLE"].map((name) => [name, process.env[name]]));
  let app: NestExpressApplication;

  beforeAll(async () => {
    for (const name of POLLER_NAMES) delete process.env[name];
    process.env.ROLE = "api";
    const { buildApiReplicaApp } = require("../../helpers/nest/api-replica-app") as { buildApiReplicaApp: BuildApiReplicaApp };
    app = await buildApiReplicaApp();
  });

  afterAll(async () => {
    await app?.close();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("passes the boot check with every poller-scoped name missing", () => {
    // Arrange
    const missing: string[] = [];

    // Act
    jest.isolateModules(() => {
      missing.push(...require("../../../src/infra/required-env").describeMissingRequired({ ...process.env, NODE_ENV: "production", SENTRY_DSN: "x" }));
    });

    // Assert
    expect(POLLER_NAMES.every((name) => process.env[name] === undefined)).toBe(true);
    expect(missing).toEqual([]);
  });

  it.each(["/bus/config", "/bus/realtime/data/jongro07", "/subway/stations/hyehwa/arrivals", "/map/overlays/transit"])(
    "serves %s from the stored data",
    async (url) => {
      // Act
      const res = await request(app.getHttpServer()).get(url);

      // Assert
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    },
  );
});
