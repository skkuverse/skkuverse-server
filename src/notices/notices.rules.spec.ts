/**
 * The root's shared decisions: the cluster key that makes the copies of one article one push and one list row, the
 * summary type, the search text, the source-id list, the cross-references of the committed tab files, and a fact's
 * quote as the row and the screen show it: after its table label (codebook v3.11) unless the label is empty or the
 * quote already says it, with a draw always marked. A row that cannot fit that text takes the crawler's compact of it,
 * which keeps the label and the draw mark, so the texts a fact offers are its full text first.
 */

import { ObjectId } from "mongodb";
import { AppError } from "../http/app.error";
import {
  categoryReferenceProblems,
  clusterKeyOf,
  excludeReasonProblems,
  groupByClusterKey,
  isSummaryType,
  normalizeSummaryType,
  toSearchQuery,
  toBenefitText,
  toBenefitTexts,
  toQuoteText,
  toQuoteTexts,
  toSourceIds,
} from "./notices.rules";
import type { CategoryConfig, SourceConfig } from "./notices.types";

describe("isSummaryType", () => {
  it.each([
    ["action_required", true],
    ["event", true],
    ["informational", true],
    ["bogus", false],
    ["", false],
    [undefined, false],
  ])("%j → %j", (value, expected) => {
    // Act & Assert
    expect(isSummaryType(value)).toBe(expected);
  });
});

describe("normalizeSummaryType", () => {
  it("keeps a known type and turns anything else into informational", () => {
    // Act & Assert
    expect([normalizeSummaryType("event"), normalizeSummaryType("bogus"), normalizeSummaryType(null)]).toEqual([
      "event",
      "informational",
      "informational",
    ]);
  });
});

describe("toSearchQuery", () => {
  it.each([
    ["  hello  ", "hello"],
    ["가".repeat(100), "가".repeat(100)],
    ["😀".repeat(100), "😀".repeat(100)],
    ["", null],
    ["   ", null],
    ["x".repeat(101), null],
    ["😀".repeat(101), null],
    ["abc\u0000def", null],
    ["abc\u007fdef", null],
    [["a"], null],
    [undefined, null],
  ])("%j → %j", (raw, expected) => {
    // Act & Assert
    expect(toSearchQuery(raw)).toBe(expected);
  });
});

describe("toSourceIds", () => {
  const known = (id: string): boolean => id.startsWith("ok-");

  it("splits, trims and drops empty ids", () => {
    // Act & Assert
    expect(toSourceIds(" ok-a, ,ok-b ,", known)).toEqual(["ok-a", "ok-b"]);
  });

  it("takes one id and twenty ids", () => {
    // Arrange
    const twenty = Array.from({ length: 20 }, (_, i) => `ok-${i}`).join(",");

    // Act & Assert
    expect([toSourceIds("ok-a", known), toSourceIds(twenty, known)].map((ids) => ids.length)).toEqual([1, 20]);
  });

  it.each(["", " , ", Array.from({ length: 21 }, (_, i) => `ok-${i}`).join(",")])("refuses no ids or more than twenty (%#)", (raw) => {
    // Act & Assert
    expect(() => toSourceIds(raw, known)).toThrow(
      new AppError("INVALID_PARAMS", "sourceIds: 1-20 comma-separated source IDs required", 400),
    );
  });

  it("checks the count before the ids, and names the first unknown id", () => {
    // Act & Assert
    expect(() => toSourceIds("ok-a,nope,also-nope", known)).toThrow(
      new AppError("INVALID_SOURCE_ID", "unknown sourceId: nope", 400),
    );
  });
});

describe("categoryReferenceProblems", () => {
  const sourceIds = new Set(["a", "b", "c"]);
  const label = { ko: "가", en: "A" };

  it("passes tabs whose sources, defaults and campus seeds all hold", () => {
    // Arrange
    const categories: CategoryConfig[] = [
      { id: "fixed", label, tabMode: "fixed", sourceId: "a" },
      { id: "picker", label, tabMode: "picker", sourceIds: ["a", "b"], maxSelection: 2, defaultIds: ["a"], campusDefaultIds: { hssc: ["b"] } },
    ];

    // Act & Assert
    expect(categoryReferenceProblems(categories, sourceIds)).toEqual([]);
  });

  it("names each broken reference with its category's index and id", () => {
    // Arrange
    const categories: CategoryConfig[] = [
      { id: "fixed", label, tabMode: "fixed", sourceId: "x" },
      { id: "picker", label, tabMode: "picker", sourceIds: ["a", "y"], maxSelection: 1, defaultIds: ["c"], campusDefaultIds: { nsc: ["a"] } },
    ];

    // Act
    const problems = categoryReferenceProblems(categories, sourceIds);

    // Assert
    expect(problems).toEqual([
      'categories[0] (fixed): sourceId "x" not found in sources.json',
      'categories[1] (picker): sourceId "y" in sourceIds not found in sources.json',
      'categories[1] (picker): defaultIds "c" is not in sourceIds',
      'categories[1] (picker): seed for campus "nsc" has 2 ids > maxSelection 1',
    ]);
  });
});

describe("excludeReasonProblems", () => {
  const source = (excludeReason: string | null): SourceConfig => ({
    id: "s",
    name: "S",
    campus: "hssc",
    college: null,
    crawlAvailable: excludeReason === null,
    excludeReason,
  });

  it("names a source whose reason has no copy, and passes one that has or needs none", () => {
    // Act
    const problems = excludeReasonProblems([source(null), source("known"), source("missing")], { known: { ko: "알려진" } });

    // Assert
    expect(problems).toEqual(['sources.json: "s" has excludeReason "missing" with no entry in exclude-reasons.json']);
  });
});

describe("clusterKeyOf", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

  it.each([
    ["the crawler's dupOf", { _id: id(2), dupOf: id(1) }, id(1)],
    ["its own _id when the crawler has not linked it yet", { _id: id(2) }, id(2)],
    ["its own _id when dupOf is null", { _id: id(2), dupOf: null }, id(2)],
  ])("keys a notice on %s", (_case, notice, anchor) => {
    // Act & Assert
    expect(clusterKeyOf(notice)).toBe(anchor.toHexString());
  });
});

describe("groupByClusterKey", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

  it("groups the notices whose key is equal, each group in the order given, the groups in order of their first notice", () => {
    // Arrange
    const notices = [{ _id: id(3), dupOf: id(1) }, { _id: id(4), dupOf: id(4) }, { _id: id(1), dupOf: id(1) }, { _id: id(5) }];

    // Act
    const groups = groupByClusterKey(notices);

    // Assert
    expect(groups.map((group) => group.map((notice) => notice._id))).toEqual([[id(3), id(1)], [id(4)], [id(5)]]);
  });

  it("forms no group from no notices", () => {
    // Act & Assert
    expect(groupByClusterKey([])).toEqual([]);
  });
});

describe("toQuoteText", () => {
  it.each<[string, { quote: string; label?: string }, string]>([
    ["puts the label before the quote", { quote: "3,000,000원", label: "장학금" }, "장학금 · 3,000,000원"],
    ["shows the quote alone when there is no label", { quote: "3,000,000원" }, "3,000,000원"],
    ["shows the quote alone when the label is empty", { quote: "3,000,000원", label: "" }, "3,000,000원"],
    ["shows the quote alone when the label is only spaces", { quote: "3,000,000원", label: " \n " }, "3,000,000원"],
    ["shows the quote alone when it already says the label", { quote: "장학금 3,000,000원", label: "장학금" }, "장학금 3,000,000원"],
    ["compares the two without their spaces", { quote: "지원 자격: 재학생", label: "지원자격" }, "지원 자격: 재학생"],
    ["compares the two without their line breaks", { quote: "지원\n자격 재학생", label: "지원 자격" }, "지원\n자격 재학생"],
    ["writes a label's line break and padding as one space", { quote: "100명", label: "  모집\n인원 " }, "모집 인원 · 100명"],
    ["keeps the quote's own spacing", { quote: "월\n50만원", label: "혜택" }, "혜택 · 월\n50만원"],
    ["keeps a label that only contains the quote, which says less than the quote", { quote: "재학생", label: "재학생 대상 지원 자격" }, "재학생 대상 지원 자격 · 재학생"],
  ])("%s", (_title, evidence, expected) => {
    // Act & Assert
    expect(toQuoteText(evidence)).toBe(expected);
  });
});

describe("toBenefitText", () => {
  const benefit = (quote: string, isDraw: boolean, label?: string) => ({ isDraw, ev: { quote, ...(label === undefined ? {} : { label }) } });

  it.each([
    ["a benefit that is no draw, as its quote text", benefit("월 50만원", false, "장학금"), "장학금 · 월 50만원"],
    ["a draw, marked after its text", benefit("커피 쿠폰", true), "커피 쿠폰 (추첨)"],
    ["a labelled draw, marked after the label and the quote", benefit("커피 쿠폰", true, "경품"), "경품 · 커피 쿠폰 (추첨)"],
    ["a draw whose quote says so", benefit("추첨을 통해 상품권 지급", true), "추첨을 통해 상품권 지급"],
    ["a draw whose label says so, and the quote does not", benefit("커피 쿠폰", true, "추첨 경품"), "추첨 경품 · 커피 쿠폰"],
    ["a benefit that is no draw but says 추첨", benefit("추첨 결과 발표", false), "추첨 결과 발표"],
  ])("writes %s", (_title, input, expected) => {
    // Act & Assert
    expect(toBenefitText(input)).toBe(expected);
  });
});

describe("toQuoteTexts", () => {
  it.each<[string, { quote: string; label?: string; compact?: string }, string[]]>([
    ["offers the quote alone when the crawler stored no compact", { quote: "석사과정만" }, ["석사과정만"]],
    ["offers the quote, then its compact", { quote: "석사과정 재학생만 신청 가능", compact: "석사과정만" }, ["석사과정 재학생만 신청 가능", "석사과정만"]],
    ["offers no compact the crawler stored empty", { quote: "석사과정만", compact: "" }, ["석사과정만"]],
    ["puts the label before the quote and before its compact", { quote: "석사과정 재학생만", label: "대상", compact: "석사과정" }, ["대상 · 석사과정 재학생만", "대상 · 석사과정"]],
    ["keeps the label on the compact when the quote already says it", { quote: "대상: 석사과정 재학생만", label: "대상", compact: "석사과정" }, ["대상: 석사과정 재학생만", "대상 · 석사과정"]],
    ["offers a compact that says the label itself alone", { quote: "대상: 석사과정 재학생만", label: "대상", compact: "대상: 석사과정" }, ["대상: 석사과정 재학생만", "대상: 석사과정"]],
    ["leaves out the label when it is empty", { quote: "석사과정 재학생만", label: " ", compact: "석사과정" }, ["석사과정 재학생만", "석사과정"]],
  ])("%s", (_title, evidence, expected) => {
    // Act & Assert
    expect(toQuoteTexts(evidence)).toEqual(expected);
  });
});

describe("toBenefitTexts", () => {
  const benefit = (quote: string, isDraw: boolean, extra: { label?: string; compact?: string } = {}) => ({ isDraw, ev: { quote, ...extra } });

  it.each([
    ["a benefit that is no draw, its quote text then its compact", benefit("월 50만원 지급 및 기숙사비 면제", false, { compact: "월 50만원" }), ["월 50만원 지급 및 기숙사비 면제", "월 50만원"]],
    ["a draw, marked after the quote and after its compact", benefit("커피 쿠폰 100명 랜덤 증정", true, { compact: "커피 쿠폰" }), ["커피 쿠폰 100명 랜덤 증정 (추첨)", "커피 쿠폰 (추첨)"]],
    ["a labelled draw, the label before each", benefit("커피 쿠폰", true, { label: "경품", compact: "쿠폰" }), ["경품 · 커피 쿠폰 (추첨)", "경품 · 쿠폰 (추첨)"]],
    ["a draw whose compact says so, with no second mark", benefit("추첨으로 커피 쿠폰 증정", true, { compact: "추첨 쿠폰" }), ["추첨으로 커피 쿠폰 증정", "추첨 쿠폰"]],
    ["a benefit with no compact, as its one text", benefit("커피 쿠폰", true), ["커피 쿠폰 (추첨)"]],
  ])("offers %s", (_title, input, expected) => {
    // Act & Assert
    expect(toBenefitTexts(input)).toEqual(expected);
  });
});
