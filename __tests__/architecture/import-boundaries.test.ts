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
import { ROOT } from "../helpers/architecture/ratchet";

const tsparser = require("@typescript-eslint/parser");
const tseslint = require("@typescript-eslint/eslint-plugin");
const config: Linter.Config[] = require("../../eslint.config.js");

const blocks = config.filter((c) => c.name?.startsWith("boundaries/"));

function lint(rules: Linter.Config["rules"], file: string, source: string): Linter.LintMessage[] {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    source,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tsparser },
        plugins: { "@typescript-eslint": tseslint },
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
      ]),
    );
  });

  it("get-client rejects getClient and nothing else from infra/db", () => {
    const rules = block("boundaries/get-client").rules!;
    expect(lint(rules, "src/building/x.controller.ts", 'import { getClient } from "../infra/db";')).toHaveLength(1);
    expect(lint(rules, "src/infra/x.ts", 'import { getClient } from "./db";')).toHaveLength(1);
    expect(lint(rules, "src/health/x.ts", 'import { ping, HOT_READ_MAX_TIME_MS } from "../infra/db";')).toEqual([]);
  });

  it("a feature reaches another only through its module, its services or `import type`", () => {
    const rules = block("boundaries/feature/ui/depth-2").rules!;
    const ok = [
      'import { BusConfigService } from "../../bus/bus-config/bus-config.service";',
      'import { BusModule } from "../../bus/bus.module";',
      'import type { BusGroup } from "../../bus/types";',
      'import { AppError } from "../../common/app.error";',
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
    const shared = new Set(["common", "config", "infra", "scheduling", "shared"]);
    const topLevel = fs
      .readdirSync(path.join(ROOT, "src"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !shared.has(d.name))
      .map((d) => d.name);
    expect([...featureBlocks].sort()).toEqual(topLevel.sort());
  });

  it("shared/ imports no feature, infra/ imports neither common/ nor a feature", () => {
    expect(lint(block("boundaries/shared").rules!, "src/shared/x.util.ts", 'import { a } from "../map/a";')).toHaveLength(1);
    expect(lint(block("boundaries/shared").rules!, "src/shared/x.util.ts", 'import { a } from "../infra/a";')).toEqual([]);
    expect(lint(block("boundaries/infra").rules!, "src/infra/x.ts", 'import { a } from "../common/a";')).toHaveLength(1);
    expect(lint(block("boundaries/infra").rules!, "src/infra/x.ts", 'import { a } from "./logger";')).toEqual([]);
  });
});

describe("files listed in a boundary block's ignores", () => {
  const listed = blocks.flatMap((b) =>
    (b.ignores ?? []).filter((p) => !/[*{}]/.test(p) && p !== "src/infra/db.ts").map((file) => ({ block: b, file })),
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
