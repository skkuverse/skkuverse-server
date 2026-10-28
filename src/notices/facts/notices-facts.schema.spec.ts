/**
 * noticeFacts: the server's reader of the `facts` record the crawler stores on a notice
 * (contracts/consumed/notice-facts.schema.json, `v: 1`).
 *
 * The 40 records in fixtures/notice-facts.dev-records.json, read from the DEV notices, and the one the crawler's
 * writer builds today (fixtures/notice-facts.writer-record.json, with `anchorDay` and `dateInput`) parse and come out
 * equal to what was stored, so the mirror drops no key a record carries. A copy missing any required top-level key
 * or any key of a nested item does not parse, and neither does another `v`. A key the mirror does not know is
 * stripped, never refused, because the crawler adds optional keys without a version bump.
 */
import fs from "fs";
import path from "path";
import { noticeFacts } from "./notices-facts.schema";

interface CapturedRecord {
  sourceId: string;
  articleNo: number;
  facts: Record<string, unknown>;
}

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-facts.dev-records.json");
const RECORDS = (JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { records: CapturedRecord[] }).records;

const WRITER_FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-facts.writer-record.json");
const WRITER_RECORD = (JSON.parse(fs.readFileSync(WRITER_FIXTURE, "utf8")) as { facts: Record<string, unknown> }).facts;

const copyOf = <T>(value: T): T => structuredClone(value);

/** A captured record with at least one dated item and one thing, for the cases that edit inside them. */
function datedRecord(): Record<string, unknown> {
  const found = RECORDS.find((r) => (r.facts.times as unknown[]).length > 0 && (r.facts.things as unknown[]).length > 0);
  if (!found) throw new Error("no captured record has a dated item");
  return copyOf(found.facts);
}

/** `facts` with `value` set at a dotted path of keys and indexes (`times.0.start`), or removed when it is undefined. */
function withValueAt(facts: Record<string, unknown>, keys: string[], value: unknown): Record<string, unknown> {
  const copy = copyOf(facts);
  let node = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  const last = keys[keys.length - 1]!;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return copy;
}

describe("noticeFacts", () => {
  it("parses the captured records and drops none of their keys", () => {
    // Act & Assert
    expect(RECORDS.length).toBeGreaterThanOrEqual(20);
    for (const record of RECORDS) {
      const parsed = noticeFacts.safeParse(record.facts);
      expect({ notice: `${record.sourceId} ${record.articleNo}`, success: parsed.success }).toEqual({
        notice: `${record.sourceId} ${record.articleNo}`,
        success: true,
      });
      if (parsed.success) expect(parsed.data).toEqual(record.facts);
    }
  });

  it.each(Object.entries(noticeFacts.shape).filter(([, field]) => !field.safeParse(undefined).success).map(([key]) => key))(
    "refuses a record without its %s",
    (key) => {
      // Arrange
      const facts = withValueAt(datedRecord(), [key], undefined);

      // Act & Assert
      expect(noticeFacts.safeParse(facts).success).toBe(false);
    },
  );

  it.each([
    ["another version", 2],
    ["a version written as text", "1"],
    ["no version", undefined],
  ])("refuses %s", (_label, v) => {
    // Arrange
    const facts = withValueAt(datedRecord(), ["v"], v);

    // Act & Assert
    expect(noticeFacts.safeParse(facts).success).toBe(false);
  });

  it.each([
    ["a thing without its tracks", ["things", "0", "tracks"]],
    ["a dated item without its recurrence", ["times", "0", "recurrence"]],
    ["a dated item without its place list", ["times", "0", "where", "places"]],
    ["a point without its latest day", ["times", "0", "start", "latest"]],
    ["the audience without its forStudentsEv", ["audience", "forStudentsEv"]],
    ["the short title without its compactOk", ["shortTitle", "compactOk"]],
    ["the sources without their posters", ["sources", "posters"]],
  ])("refuses %s", (_label, keys) => {
    // Arrange
    const facts = withValueAt(datedRecord(), keys, undefined);

    // Act & Assert
    expect(noticeFacts.safeParse(facts).success).toBe(false);
  });

  it.each([
    ["a dated item of an unknown kind", ["times", "0", "kind"], "deadline"],
    ["a point date that is not a day", ["times", "0", "start", "date"], "next week"],
    ["an evidence source that is not body, title or a poster", ["things", "0", "name", "src"], "attachment"],
  ])("refuses %s", (_label, keys, value) => {
    // Arrange
    const facts = withValueAt(datedRecord(), keys, value);

    // Act & Assert
    expect(noticeFacts.safeParse(facts).success).toBe(false);
  });

  it("strips a key it does not know, at the top and inside nested items", () => {
    // Arrange
    const facts = datedRecord();
    const edited = withValueAt(withValueAt(withValueAt(facts, ["futureField"], 1), ["things", "0", "futureField"], 2), ["times", "0", "where", "futureField"], 3);

    // Act
    const parsed = noticeFacts.safeParse(edited);

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(facts);
  });

  it("keeps the anchorDay and dateInput a current crawler writes, which no DEV record has yet", () => {
    // Act
    const parsed = noticeFacts.safeParse(WRITER_RECORD);

    // Assert
    expect(WRITER_RECORD.anchorDay).toBe("2026-10-20");
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(WRITER_RECORD);
  });

  it.each([
    ["an anchorDay that is not a day", ["anchorDay"], "2026-10-8"],
    ["a dateInput without its end", ["times", "0", "dateInput"], { start: { date: "XXXX-11-04" } }],
  ])("refuses %s", (_label, keys, value) => {
    // Arrange
    const facts = withValueAt(datedRecord(), keys, value);

    // Act & Assert
    expect(noticeFacts.safeParse(facts).success).toBe(false);
  });
});
