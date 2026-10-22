/**
 * The golden fixtures of the produced contracts (ADR 0010, D13): every id in
 * `contracts/produced/index.json` has a fixture in
 * `contracts/produced/fixtures/<id>/`, each fixture is
 * `{ "_about": …, "data": … }`, its `data` parses with the wire schema the
 * index names, and the published `<id>.schema.json` declares every property
 * in it. A fixture folder that names no id fails too, so a renamed id does
 * not leave its fixtures unchecked.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { ROOT } from "../helpers/architecture/ratchet";
import { filesUnder } from "../helpers/architecture/tree";
import { INDEX_FILE, SCHEMA_SUFFIX, type IndexEntry } from "../helpers/contracts/artifacts";
import { FIXTURES_DIR, fixtureViolations, type Fixture, type FixtureSubject } from "../helpers/contracts/fixtures";
import { PRODUCED_DIR } from "../helpers/contracts/produced";

const jsonOf = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", target: "draft-7" });

describe("fixture rules apply as specified", () => {
  const item = z.object({ name: z.string(), sentAt: z.iso.datetime().optional() });
  const subjects: Record<string, FixtureSubject> = {
    "x.xItem": { schema: item, published: jsonOf(item) },
    "x.xList": { schema: z.array(item), published: jsonOf(z.array(item)) },
  };
  const subjectOf = (id: string) => subjects[id]!;
  const fixture = (file: string, json: unknown): Fixture => ({ file: `${FIXTURES_DIR}/${file}`, json });
  const about = "GET /x captured 2026-10-11; trimmed to two items";

  it("pass ids whose fixtures parse and declare every property", () => {
    // Arrange
    const fixtures = [
      fixture("x.xItem/plain.json", { _about: about, data: { name: "a" } }),
      fixture("x.xItem/sent.json", { _about: about, data: { name: "b", sentAt: "2026-10-11T00:00:00.000Z" } }),
      fixture("x.xList/two.json", { _about: about, data: [{ name: "a" }, { name: "b" }] }),
    ];

    // Act & Assert
    expect(fixtureViolations(Object.keys(subjects), fixtures, subjectOf)).toEqual([]);
  });

  it("fail an id without a fixture, and a fixture outside fixtures/<id>/ or under no id", () => {
    // Arrange
    const fixtures = [
      fixture("x.xItem/plain.json", { _about: about, data: { name: "a" } }),
      fixture("loose.json", { _about: about, data: {} }),
      fixture("x.gone/old.json", { _about: about, data: {} }),
      fixture("x.xItem/deeper/case.json", { _about: about, data: {} }),
    ];

    // Act & Assert
    expect(fixtureViolations(Object.keys(subjects), fixtures, subjectOf)).toEqual([
      `${FIXTURES_DIR}/loose.json: not at ${FIXTURES_DIR}/<id>/<case>.json`,
      `${FIXTURES_DIR}/x.gone/old.json: x.gone is no id in index.json`,
      `${FIXTURES_DIR}/x.xItem/deeper/case.json: not at ${FIXTURES_DIR}/<id>/<case>.json`,
      `x.xList: no fixture in ${FIXTURES_DIR}/x.xList/`,
    ]);
  });

  it("fail a fixture that is not { _about, data } with a non-empty _about", () => {
    // Arrange
    const fixtures = [
      fixture("x.xItem/bare.json", { name: "a" }),
      fixture("x.xItem/extra.json", { _about: about, data: { name: "a" }, note: "x" }),
      fixture("x.xItem/blank.json", { _about: " ", data: { name: "a" } }),
      fixture("x.xList/ok.json", { _about: about, data: [] }),
    ];

    // Act & Assert
    expect(fixtureViolations(Object.keys(subjects), fixtures, subjectOf)).toEqual([
      `${FIXTURES_DIR}/x.xItem/bare.json: is not { _about, data }`,
      `${FIXTURES_DIR}/x.xItem/blank.json: _about is not a non-empty string`,
      `${FIXTURES_DIR}/x.xItem/extra.json: is not { _about, data }`,
    ]);
  });

  it("fail data the wire schema does not parse, and a property the published schema does not declare", () => {
    // Arrange
    const fixtures = [
      fixture("x.xItem/wrong.json", { _about: about, data: { name: 1 } }),
      fixture("x.xList/extra.json", { _about: about, data: [{ name: "a", rank: 1 }] }),
    ];

    // Act & Assert
    expect(fixtureViolations(Object.keys(subjects), fixtures, subjectOf)).toEqual([
      `${FIXTURES_DIR}/x.xItem/wrong.json: data does not parse (name: Invalid input: expected string, received number)`,
      `${FIXTURES_DIR}/x.xList/extra.json: $[0].rank is not declared in x.xList.schema.json`,
    ]);
  });

  it("fail an id whose index entry names no zod schema or whose schema file is missing", () => {
    // Arrange
    const fixtures = [fixture("x.stale/case.json", { _about: about, data: {} })];
    const stale = () => ({ schema: undefined, published: undefined });

    // Act & Assert
    expect(fixtureViolations(["x.stale"], fixtures, stale)).toEqual([
      "x.stale: the index's source and export name no zod schema",
      "x.stale: x.stale.schema.json is missing",
    ]);
  });
});

describe("contracts/produced/fixtures/", () => {
  it("cover every produced id with fixtures that parse and declare every property", () => {
    // Arrange
    const index = JSON.parse(fs.readFileSync(path.join(PRODUCED_DIR, INDEX_FILE), "utf8")) as Record<string, IndexEntry>;
    const fixtures = filesUnder(FIXTURES_DIR).map((file) => ({
      file,
      json: file.endsWith(".json") ? (JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as unknown) : undefined,
    }));
    const subjectOf = (id: string): FixtureSubject => {
      const entry = index[id]!;
      const published = path.join(PRODUCED_DIR, `${id}${SCHEMA_SUFFIX}`);
      return {
        schema: (require(path.join(ROOT, entry.source)) as Record<string, unknown>)[entry.export],
        published: fs.existsSync(published) ? (JSON.parse(fs.readFileSync(published, "utf8")) as unknown) : undefined,
      };
    };

    // Act
    const violations = fixtureViolations(Object.keys(index), fixtures, subjectOf);

    // Assert
    expect(violations).toEqual([]);
  });
});
