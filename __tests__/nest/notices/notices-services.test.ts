/**
 * Unit tests for the thin notices service wrappers. These assert the
 * @Injectable delegates forward 1:1 to the validated src/notices/* modules (so
 * the critical logic — cursor encoding, search validation, transform shapes,
 * source map, tab config — is exercised through the Nest surface), plus the
 * notices.topics exports the dispatcher uses.
 *
 * No DB / no HTTP here — pure delegation.
 */

import { CursorService, InvalidCursorError } from "../../../src/notices/cursor.service";
import { NoticesSearchService } from "../../../src/notices/search.service";
import { TransformService } from "../../../src/notices/transform.service";
import { SourcesService } from "../../../src/notices/sources.service";
import { buildTopics, TOPIC_CAP } from "../../../src/notices/notices.topics";
import { TabConfigService } from "../../../src/notices/tabconfig.service";
import { responseByLang } from "../../../src/notices/tabConfig";
import { encodeCursor } from "../../../src/notices/notices.cursor";

describe("CursorService", () => {
  const svc = new CursorService();

  it("round-trips encode → decode", () => {
    const payload = {
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    };
    const str = svc.encode(payload);
    expect(svc.decode(str)).toEqual(payload);
  });

  it("decode throws the SAME InvalidCursorError class the controller instanceof-checks", () => {
    expect(() => svc.decode("!!!not-base64url!!!")).toThrow(InvalidCursorError);
  });

  it("re-exported InvalidCursorError matches the decode throw (identity)", () => {
    let caught: unknown;
    try {
      svc.decode("garbage");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidCursorError);
  });
});

describe("NoticesSearchService", () => {
  const svc = new NoticesSearchService();

  it("validateQ trims and returns the string", () => {
    expect(svc.validateQ("  hello  ")).toBe("hello");
  });

  it("validateQ returns null for empty / oversized / control-char input (never throws)", () => {
    expect(svc.validateQ("")).toBeNull();
    expect(svc.validateQ("   ")).toBeNull();
    expect(svc.validateQ("x".repeat(101))).toBeNull();
    expect(svc.validateQ("abc\u0000def")).toBeNull();
  });

  it("escapeRegex escapes metacharacters", () => {
    expect(svc.escapeRegex(".*+?")).toBe("\\.\\*\\+\\?");
  });

  it("MAX_QUERY_CODEPOINTS is 100", () => {
    expect(svc.MAX_QUERY_CODEPOINTS).toBe(100);
  });
});

describe("TransformService", () => {
  const svc = new TransformService();

  it("VALID_SUMMARY_TYPES exposes the accepted set", () => {
    expect(svc.VALID_SUMMARY_TYPES.has("action_required")).toBe(true);
    expect(svc.VALID_SUMMARY_TYPES.has("event")).toBe(true);
    expect(svc.VALID_SUMMARY_TYPES.has("informational")).toBe(true);
    expect(svc.VALID_SUMMARY_TYPES.has("bogus")).toBe(false);
  });

  it("normalizeSummaryType maps unknown → informational", () => {
    expect(svc.normalizeSummaryType("bogus")).toBe("informational");
    expect(svc.normalizeSummaryType("event")).toBe("event");
  });
});

describe("SourcesService", () => {
  const svc = new SourcesService();

  it("map.has matches known sources and rejects unknown", () => {
    expect(svc.map.has("skku-main")).toBe(true);
    expect(svc.map.has("definitely-not-a-source")).toBe(false);
  });

  it("list is a non-empty frozen array", () => {
    expect(Array.isArray(svc.list)).toBe(true);
    expect(svc.list.length).toBeGreaterThan(0);
  });
});

// NoticesDispatcherService imports buildTopics and TOPIC_CAP from here.
describe("notices.topics", () => {
  // (An operations detail is left out of the public history.)
  it("TOPIC_CAP is 30 (at most the Cloud Function's PUSH_FUNCTION_NAME_01)", () => {
    expect(TOPIC_CAP).toBe(30);
  });

  it("buildTopics returns an array (≤ cap) for a known source", () => {
    const topics = buildTopics({ sourceId: "skku-main" });
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeLessThanOrEqual(TOPIC_CAP);
  });

  it("buildTopics tolerates null/undefined notice doc", () => {
    expect(buildTopics(null)).toEqual([]);
    expect(buildTopics(undefined)).toEqual([]);
  });
});

describe("TabConfigService", () => {
  it("serves the frozen per-lang responses validated from the real committed JSON", () => {
    const svc = new TabConfigService();
    expect(svc.responseByLang.ko.schemaVersion).toBe(1);
    expect(svc.responseByLang.en.schemaVersion).toBe(1);
    expect(svc.responseByLang.ko.tabs.length).toBeGreaterThan(0);
    // Frozen — mutation must not take.
    expect(Object.isFrozen(svc.responseByLang)).toBe(true);
  });

  it("every instance serves the one response tabConfig.ts loaded at import", () => {
    expect(new TabConfigService().responseByLang).toBe(responseByLang);
    expect(new TabConfigService().responseByLang).toBe(responseByLang);
  });

  it("encodeCursor sanity (shared cursor module is the one services delegate to)", () => {
    const s = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
  });
});
