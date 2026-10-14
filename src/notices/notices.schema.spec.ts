/**
 * The committed tab files' shapes: the real files pass, a source missing any field fails, a non-array or
 * non-object file fails with the message the boot log shows, and a picker needs at least one source and a
 * maxSelection of one or more. Cross-references are notices.rules.ts.
 */
import fs from "fs";
import path from "path";
import { categoriesFile, excludeReasonsFile, sourcesFile } from "./notices.schema";

const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
const SOURCE = { id: "a", name: "A", campus: "hssc", college: null, appCategory: null, crawlAvailable: true, excludeReason: null, hasCategory: true, hasAuthor: false };

describe("sourcesFile", () => {
  it("passes the committed sources.json", () => {
    // Act & Assert
    expect(sourcesFile.safeParse(read("sources.json")).success).toBe(true);
  });

  it.each(Object.keys(SOURCE))("fails a source missing %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...SOURCE };
    delete rest[field];

    // Act & Assert
    expect(sourcesFile.safeParse([rest]).success).toBe(false);
  });

  it("names a non-array file", () => {
    // Act & Assert
    expect(sourcesFile.safeParse({ a: 1 }).error?.issues[0]?.message).toBe("sources.json must be a JSON array");
  });
});

describe("categoriesFile", () => {
  it("passes the committed categories.json", () => {
    // Act & Assert
    expect(categoriesFile.safeParse(read("categories.json")).success).toBe(true);
  });

  it.each([
    ["an empty picker", { id: "p", label: { ko: "가", en: "A" }, tabMode: "picker", sourceIds: [], maxSelection: 1 }],
    ["a picker capped at zero", { id: "p", label: { ko: "가", en: "A" }, tabMode: "picker", sourceIds: ["a"], maxSelection: 0 }],
    ["a label without en", { id: "f", label: { ko: "가" }, tabMode: "fixed", sourceId: "a" }],
    ["an unknown tab mode", { id: "f", label: { ko: "가", en: "A" }, tabMode: "grid", sourceId: "a" }],
    ["a campus default for an unknown campus", { id: "p", label: { ko: "가", en: "A" }, tabMode: "picker", sourceIds: ["a"], maxSelection: 1, campusDefaultIds: { mars: ["a"] } }],
  ])("fails %s", (_label, category) => {
    // Act & Assert
    expect(categoriesFile.safeParse([category]).success).toBe(false);
  });
});

describe("excludeReasonsFile", () => {
  it("passes the committed exclude-reasons.json and names an array", () => {
    // Act & Assert
    expect(excludeReasonsFile.safeParse(read("exclude-reasons.json")).success).toBe(true);
    expect(excludeReasonsFile.safeParse([]).error?.issues[0]?.message).toBe("exclude-reasons.json must be a JSON object (key → label map)");
  });
});
