/**
 * The ESLint import boundaries (eslint.config.js, blocks named `boundaries/...`)
 * keep the files that broke them when they were added in each block's
 * `ignores`. ESLint never reports an ignored file, so on its own a fixed file
 * would stay listed forever. This lints every listed file with its block's
 * rule and fails when one no longer violates it: the lists only shrink.
 */
import fs from "fs";
import path from "path";
import { Linter } from "eslint";
import { isSharedLayer } from "../helpers/architecture/ast";
import { ROOT } from "../helpers/architecture/ratchet";

const tsparser = require("@typescript-eslint/parser");
const tseslint = require("@typescript-eslint/eslint-plugin");
const config: Linter.Config[] = require("../../eslint.config.js");

const blocks = config.filter((c) => c.name?.startsWith("boundaries/"));
// Every plugin a block may name: a block's rules are linted here without the rest of the config.
const plugins = Object.assign({ "@typescript-eslint": tseslint }, ...config.map((c) => c.plugins ?? {}));

function lint(rules: Linter.Config["rules"], file: string, source: string): Linter.LintMessage[] {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    source,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tsparser },
        plugins,
        rules,
      },
    ],
    file,
  );
}

function block(name: string): Linter.Config {
  const found = blocks.find((b) => b.name === name);
  if (!found) throw new Error(`no ESLint block named ${name}`);
  return found;
}

describe("import boundary blocks apply as specified", () => {
  it("exist", () => {
    expect(blocks.map((b) => b.name)).toEqual(
      expect.arrayContaining([
        "boundaries/get-client",
        "boundaries/feature/ui/depth-2",
        "boundaries/shared",
        "boundaries/infra",
        "boundaries/pure",
        "boundaries/query",
        "boundaries/repository",
        "boundaries/wire",
      ]),
    );
  });

  it("get-client rejects getClient and nothing else from infra/db", () => {
    const rules = block("boundaries/get-client").rules!;
    expect(lint(rules, "src/building/x.controller.ts", 'import { getClient } from "../infra/db";')).toHaveLength(1);
    expect(lint(rules, "src/infra/x.ts", 'import { getClient } from "./db";')).toHaveLength(1);
    expect(lint(rules, "src/health/x.ts", 'import { ping, HOT_READ_MAX_TIME_MS } from "../infra/db";')).toEqual([]);
    expect(lint(rules, "src/building/x.service.ts", 'import { mongoCollection } from "../infra/mongo";')).toHaveLength(1);
    expect(lint(rules, "src/building/x.service.ts", 'import { ensureIndexesAtBoot } from "../infra/mongo";')).toEqual([]);
  });

  it("only a repository imports a .query, and a repository imports no mapper, service, controller, poller or client", () => {
    const query = 'import { searchPipeline } from "./building-search.query";';
    expect(lint(block("boundaries/get-client").rules!, "src/building/search/building-search.service.ts", query)).toHaveLength(1);
    const repository = block("boundaries/repository").rules!;
    const file = "src/building/search/building-search.repository.ts";
    expect(lint(repository, file, query)).toEqual([]);
    expect(lint(repository, file, 'import { getClient } from "../../infra/db";')).toEqual([]);
    expect(lint(repository, file, 'import type { BuildingDoc } from "../building.document";')).toEqual([]);
    for (const role of ["mapper", "service", "controller", "poller", "client"]) {
      expect(lint(repository, file, `import { x } from "./building-search.${role}";`)).toHaveLength(1);
    }
  });

  it("a .query is pure but speaks Mongo", () => {
    const rules = block("boundaries/query").rules!;
    const file = "src/building/search/building-search.query.ts";
    expect(lint(rules, file, 'import type { Document, Filter } from "mongodb";')).toEqual([]);
    expect(lint(rules, file, 'import { SPACE_TIERS } from "./building-search.rules";')).toEqual([]);
    expect(lint(rules, file, 'import { getClient } from "../../infra/db";')).toHaveLength(1);
    expect(lint(rules, file, 'import { X } from "./building-search.repository";')).toHaveLength(1);
    expect(lint(rules, file, "export const now = () => Date.now();")).toHaveLength(1);
  });

  it("a feature reaches another only through its module, its services or `import type`", () => {
    const rules = block("boundaries/feature/ui/depth-2").rules!;
    const ok = [
      'import { BusConfigService } from "../../bus/bus-config/bus-config.service";',
      'import { BusModule } from "../../bus/bus.module";',
      'import type { BusGroup } from "../../bus/types";',
      'import { AppError } from "../../http/app.error";',
      'import { escapeRegex } from "../../shared/regex.util";',
      'import { campus } from "../ui.campus";',
      'import { x } from "../../ui/ui.service";',
    ];
    for (const line of ok) expect(lint(rules, "src/ui/home/x.ts", line)).toEqual([]);
    const bad = [
      'import { busConfig } from "../../bus/bus-config/bus-config.data";',
      'import { type BusGroup, helper } from "../../bus/types";',
      'import { getMiniApps } from "../../miniapps/miniapps";',
    ];
    for (const line of bad) expect(lint(rules, "src/ui/home/x.ts", line)).toHaveLength(1);
  });

  it("lets a spec import the shared test helpers, and bounds deep folders too", () => {
    expect(
      lint(block("boundaries/feature/building/depth-1").rules!, "src/building/x.spec.ts", 'import { b } from "../../__tests__/helpers/nest/build-building-app";'),
    ).toEqual([]);
    expect(
      lint(block("boundaries/feature/bus/depth-4").rules!, "src/bus/a/b/c/x.ts", 'import { m } from "../../../../map/map-places.data";'),
    ).toHaveLength(1);
  });

  it("covers every top-level folder of src/ that is not shared code", () => {
    const featureBlocks = new Set(
      blocks.map((b) => b.name!.match(/^boundaries\/feature\/([^/]+)\//)?.[1]).filter(Boolean),
    );
    const topLevel = fs
      .readdirSync(path.join(ROOT, "src"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !isSharedLayer(d.name))
      .map((d) => d.name);
    expect([...featureBlocks].sort()).toEqual(topLevel.sort());
  });

  it("shared/ imports no feature, infra/ imports neither http/ nor a feature", () => {
    expect(lint(block("boundaries/shared").rules!, "src/shared/x.util.ts", 'import { a } from "../map/a";')).toHaveLength(1);
    expect(lint(block("boundaries/shared").rules!, "src/shared/x.util.ts", 'import { a } from "../infra/a";')).toEqual([]);
    expect(lint(block("boundaries/infra").rules!, "src/infra/x.ts", 'import { a } from "../http/a";')).toHaveLength(1);
    expect(lint(block("boundaries/infra").rules!, "src/infra/x.ts", 'import { a } from "./logger";')).toEqual([]);
  });

  it("a .rules or .mapper file does no IO, speaks no Mongo and does not read the clock", () => {
    const rules = block("boundaries/pure").rules!;
    const file = "src/building/x.rules.ts";
    for (const source of [
      'import { getClient } from "../infra/db";',
      'import logger from "../infra/logger";',
      'import { config } from "../infra/config";',
      'import { toWebviewUrl } from "../infra/webview-urls";',
      'import { MEDIA_ORIGIN } from "../infra/origins";',
      'import { BuildingRepository } from "./building.repository";',
      'import { BuildingClient } from "./building.client";',
      'import { AppError } from "../http/zod-validation.pipe";',
      'import axios from "axios";',
      'import { Injectable } from "@nestjs/common";',
      'import type { Filter } from "mongodb";',
      'import { ObjectId } from "mongodb";',
      'import { pipeline } from "./building.query";',
      "export const now = () => Date.now();",
      "export const today = () => new Date();",
    ]) {
      expect(lint(rules, file, source)).toHaveLength(1);
    }
    for (const source of [
      'import { t } from "../infra/i18n";',
      'import type { SupportedLang } from "../infra/types";',
      'import { toWebviewUrl } from "../infra/webview-url";',
      'import { isMediaUrl } from "../infra/media-url";',
      'import { AppError } from "../http/app.error";',
      'import { escapeRegex } from "../shared/regex.util";',
      'import { toDisplayNo } from "./building.rules";',
      'import type { BuildingDoc } from "./building.document";',
      "export const at = (ms: number) => new Date(ms);",
    ]) {
      expect(lint(rules, file, source)).toEqual([]);
    }
  });
});

describe("boundaries/wire", () => {
  const file = "src/infra/x.wire.ts";

  it("lets a wire file import zod, another .wire and a .constants, wherever they sit", () => {
    // Arrange
    const rules = block("boundaries/wire").rules!;
    const sources = [
      'import { z } from "zod";',
      'import { X_KINDS } from "./x.constants";',
      'import { xPiece } from "./x.wire";',
      'import { SHARED_PATTERN } from "../shared/x.constants";',
      'import { mapPiece } from "../map/map.wire";',
    ];

    // Act
    const reported = sources.filter((source) => lint(rules, file, source).length > 0);

    // Assert
    expect(reported).toEqual([]);
  });

  it("rejects every other import, a type-only one included", () => {
    // Arrange
    const rules = block("boundaries/wire").rules!;
    const sources = [
      'import { isX } from "./x.rules";',
      'import type { X } from "./x.types";',
      'import { xPipeline } from "./x.query";',
      'import { getClient } from "./db";',
      'import { config } from "./config";',
      'import { z } from "zod/v4";',
    ];

    // Act
    const counts = sources.map((source) => lint(rules, file, source).length);

    // Assert
    expect(counts).toEqual(sources.map(() => 1));
  });

  it("leaves a feature's wire import from src/infra/ to boundaries/infra", () => {
    // Act & Assert
    expect(lint(block("boundaries/infra").rules!, file, 'import { mapPiece } from "../map/map.wire";')).toHaveLength(1);
  });
});

describe("boundaries/lang", () => {
  it("rejects a controller that reads req.lang or casts to SupportedLang, and keeps the log selectors", () => {
    const rules = block("boundaries/lang").rules!;
    const file = "src/building/catalog/building-catalog.controller.ts";
    expect(lint(rules, file, "const lang = req.lang;")).toHaveLength(1);
    expect(lint(rules, file, 'const lang = (request.lang ?? "ko");')).toHaveLength(1);
    expect(lint(rules, file, 'const lang = x as SupportedLang;')).toHaveLength(1);
    expect(lint(rules, file, "function list(lang: SupportedLang) { return lang; }")).toEqual([]);
    expect(lint(rules, file, 'logger.info("no fields");')).toHaveLength(1);
  });
});

describe("files listed in a boundary block's ignores", () => {
  const listed = blocks.flatMap((b) =>
    (b.ignores ?? [])
      .filter((p) => !/[*{}]/.test(p) && p !== "src/infra/db.ts" && p !== "src/infra/mongo.ts")
      .map((file) => ({ block: b, file })),
  );

  it("exist", () => {
    expect(listed.filter(({ file }) => !fs.existsSync(path.join(ROOT, file))).map(({ file }) => file)).toEqual([]);
  });

  it("still violate their block (delete the entry once a file is fixed)", () => {
    const fixed = listed
      .filter(({ file }) => fs.existsSync(path.join(ROOT, file)))
      .filter(({ block: b, file }) => lint(b.rules!, file, fs.readFileSync(path.join(ROOT, file), "utf8")).length === 0)
      .map(({ block: b, file }) => `${b.name}: ${file}`);
    expect(fixed).toEqual([]);
  });
});
