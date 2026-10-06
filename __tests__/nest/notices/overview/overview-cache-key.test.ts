/**
 * Cache key (spec: "Overview cache"): what makes two requests share an overview.
 */
import {
  kstDate,
  normalizeQuery,
  overviewCacheKey,
  type OverviewCacheKeyInput,
} from "../../../../src/notices/overview/overview.cache-key";
import { candidate } from "../../../helpers/overview-fixtures";

const NOON_KST = new Date("2026-10-06T03:00:00Z");

function base(extra: Partial<OverviewCacheKeyInput> = {}): OverviewCacheKeyInput {
  return {
    q: "장학금 신청",
    sourceIds: ["skku-main", "cs"],
    lang: "ko",
    now: NOON_KST,
    candidates: [
      candidate({ title: "a", contentHash: "ha" }),
      candidate({ title: "b", contentHash: "hb" }),
    ],
    ...extra,
  };
}

describe("normalizeQuery", () => {
  it("trims, collapses inner whitespace and lower-cases", () => {
    expect(normalizeQuery("  ROTC   지원\t언제 ")).toBe("rotc 지원 언제");
  });
});

describe("kstDate", () => {
  it("uses the Asia/Seoul calendar date", () => {
    expect(kstDate(new Date("2026-10-06T14:59:00Z"))).toBe("2026-10-06");
    expect(kstDate(new Date("2026-10-06T15:01:00Z"))).toBe("2026-10-07");
  });
});

describe("overviewCacheKey", () => {
  it("is the same for queries that differ only in spacing", () => {
    const input = base();
    expect(overviewCacheKey({ ...input, q: "장학금  신청" })).toBe(
      overviewCacheKey({ ...input, q: " 장학금 신청" }),
    );
  });

  it("ignores the order and repetition of sourceIds", () => {
    const input = base();
    expect(overviewCacheKey({ ...input, sourceIds: ["cs", "skku-main", "cs"] })).toBe(
      overviewCacheKey(input),
    );
  });

  it("changes when a candidate's content hash changes", () => {
    const input = base();
    const edited = [
      { ...input.candidates[0]!, contentHash: "ha-edited" },
      input.candidates[1]!,
    ];
    expect(overviewCacheKey({ ...input, candidates: edited })).not.toBe(
      overviewCacheKey(input),
    );
  });

  it("changes across KST midnight", () => {
    const input = base();
    expect(
      overviewCacheKey({ ...input, now: new Date("2026-10-06T14:59:00Z") }),
    ).not.toBe(overviewCacheKey({ ...input, now: new Date("2026-10-06T15:01:00Z") }));
  });

  it("changes with the language", () => {
    const input = base();
    expect(overviewCacheKey({ ...input, lang: "en" })).not.toBe(overviewCacheKey(input));
  });
});
