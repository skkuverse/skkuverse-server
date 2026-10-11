/**
 * Every fixture says where its data came from (harden-test-suite design D6,
 * task 3.5; docs/decisions/0011-test-strategy.md). A JSON file under a
 * `fixtures/` folder is an object whose `_about` string either names the date
 * it was captured (`YYYY-MM-DD`, next to the source and what was trimmed) or
 * says it is synthetic or hand-written (and why it was never captured). Without
 * that, a stale capture and an invented payload look the same once the upstream
 * changes. Whether `_about` names the right endpoint is a reviewer's call.
 */
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "fixture-provenance";
const FIXTURE = /(?:^|\/)fixtures\/.+\.json$/;
const CAPTURE_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const NEVER_CAPTURED = /\b(?:synthetic|hand-written)\b/i;

export function isFixture(file: string): boolean {
  return FIXTURE.test(file);
}

/** `<file>: <reason>` when the fixture does not state its origin, or nothing. */
export function provenanceViolations(file: string, text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [`${file}: not valid JSON`];
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return [`${file}: not a JSON object`];
  const about = (json as Record<string, unknown>)._about;
  if (typeof about !== "string" || about.trim() === "") return [`${file}: no _about string`];
  if (!CAPTURE_DATE.test(about) && !NEVER_CAPTURED.test(about)) {
    return [`${file}: _about has no capture date and does not say synthetic`];
  }
  return [];
}

describe("fixture provenance rule applies as specified", () => {
  const FILE = "__tests__/nest/bus/fixtures/hssc-realtime.json";

  it.each([
    ["__tests__/nest/bus/fixtures/hssc-realtime.json", true],
    ["contracts/produced/fixtures/building.buildingCard/facility.json", true],
    ["fixtures/root.json", true],
    ["__tests__/architecture/fixtures/ratchet/sorted.json", true],
    ["__tests__/nest/bus/fixtures/notes.md", false],
    ["__fixtures__/raw.json", false],
    ["src/map/config/eskara-2026.json", false],
    ["__tests__/nest/bus/fixtures.json", false],
  ])("%s is a fixture: %s", (file, expected) => {
    // Act & Assert
    expect(isFixture(file)).toBe(expected);
  });

  it.each([
    [
      "a capture with its date",
      '{ "_about": "GET https://upstream.example/list?campus=1, captured 2026-10-10. Trimmed to 2 of 40 items.", "items": [] }',
      [],
    ],
    ["a synthetic payload", '{ "_about": "SYNTHETIC: the terms forbid storing responses. Shaped after a live probe.", "x": 1 }', []],
    ["a hand-written input", '{ "_about": "Hand-written: the smallest config with two groups." }', []],
    ["a contract fixture", '{ "_about": "Synthetic, never captured: a capture would record an event.", "data": {} }', []],
    ["no _about", '{ "items": [] }', [`${FILE}: no _about string`]],
    ["a blank _about", '{ "_about": "  ", "items": [] }', [`${FILE}: no _about string`]],
    ["a number for _about", '{ "_about": 20261010 }', [`${FILE}: no _about string`]],
    ["_about only inside data", '{ "data": { "_about": "captured 2026-10-10" } }', [`${FILE}: no _about string`]],
    [
      "a source without a date",
      '{ "_about": "GET /building/list captured from production", "data": [] }',
      [`${FILE}: _about has no capture date and does not say synthetic`],
    ],
    [
      "a partial date",
      '{ "_about": "captured 2026-10", "data": [] }',
      [`${FILE}: _about has no capture date and does not say synthetic`],
    ],
    ["a top-level array", '["a", "b"]', [`${FILE}: not a JSON object`]],
    ["a top-level string", '"captured 2026-10-10"', [`${FILE}: not a JSON object`]],
    ["malformed JSON", '{ "_about": "captured 2026-10-10", }', [`${FILE}: not valid JSON`]],
  ])("%s", (_case, text, expected) => {
    // Act & Assert
    expect(provenanceViolations(FILE, text)).toEqual(expected);
  });
});

describe("fixture provenance", () => {
  it("gives every JSON fixture an _about that names its capture date or says it is synthetic", () => {
    // Arrange
    const fixtures = filesUnder(".").filter(isFixture);

    // Act
    const violations = fixtures.flatMap((f) => provenanceViolations(f, readSource(f)));

    // Assert
    expectAllowlisted(RULE, violations);
  });
});
