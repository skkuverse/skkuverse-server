/**
 * The tabs response from the committed tab files: a fixed tab names its source, a picker tab lists its sources
 * with availability and the excluded reason's copy in the requested language (en, then ko), and caps
 * maxSelection at the sources it lists. Every optional field missing has its default.
 */
import type { CategoryConfig, SourceConfig } from "../notices.types";
import { toTabsResponse } from "./notices-tabs.mapper";

const source = (id: string, extra: Partial<SourceConfig> = {}): SourceConfig => ({
  id,
  name: `name-${id}`,
  campus: "hssc",
  college: null,
  appCategory: null,
  crawlAvailable: true,
  excludeReason: null,
  hasCategory: true,
  hasAuthor: true,
  ...extra,
});

const sourceById = new Map([
  ["a", source("a")],
  ["b", source("b", { crawlAvailable: false, excludeReason: "loginRequired", college: "공대" })],
]);
const excludeReasons = { loginRequired: { ko: "로그인 필요", en: "Login required" }, koOnly: { ko: "한국어만" } };

const categories: CategoryConfig[] = [
  { id: "fixed", label: { ko: "학사", en: "Academic" }, tabMode: "fixed", sourceId: "a" },
  { id: "picker", label: { ko: "학과", en: "Department" }, tabMode: "picker", sourceIds: ["a", "b"], maxSelection: 5 },
];

describe("toTabsResponse", () => {
  it("builds a fixed and a picker tab in the requested language", () => {
    // Act
    const tabs = toTabsResponse({ categories, sourceById, excludeReasons }, "en");

    // Assert
    expect(tabs).toEqual({
      schemaVersion: 1,
      tabs: [
        { key: "fixed", label: "Academic", tabMode: "fixed", fixed: { sourceId: "a", name: "name-a", campus: "hssc" } },
        {
          key: "picker",
          label: "Department",
          tabMode: "picker",
          picker: {
            sources: [
              { id: "a", name: "name-a", campus: "hssc", college: null, noticeAvailable: true, excludeReason: null, excludeReasonText: null },
              { id: "b", name: "name-b", campus: "hssc", college: "공대", noticeAvailable: false, excludeReason: "loginRequired", excludeReasonText: "Login required" },
            ],
            maxSelection: 2,
            defaultIds: [],
            campusDefaultIds: {},
          },
        },
      ],
    });
  });

  it("falls back to Korean copy when a reason has no English", () => {
    // Arrange
    const ko = new Map([["b", source("b", { excludeReason: "koOnly" })]]);
    const picker: CategoryConfig[] = [{ id: "p", label: { ko: "학과", en: "Department" }, tabMode: "picker", sourceIds: ["b"], maxSelection: 1, defaultIds: ["b"], campusDefaultIds: { nsc: ["b"] } }];

    // Act
    const tabs = toTabsResponse({ categories: picker, sourceById: ko, excludeReasons }, "en");

    // Assert
    expect(tabs.tabs[0]).toMatchObject({ picker: { sources: [{ excludeReasonText: "한국어만" }], defaultIds: ["b"], campusDefaultIds: { nsc: ["b"] } } });
  });

  it("refuses a fixed tab whose source is unknown, rather than dropping the tab", () => {
    // Act & Assert
    expect(() => toTabsResponse({ categories: [categories[0]!], sourceById: new Map(), excludeReasons }, "ko")).toThrow('notices tab "fixed" names unknown source "a"');
  });
});
