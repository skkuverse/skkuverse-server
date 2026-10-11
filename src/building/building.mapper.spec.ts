/**
 * The building mappers that list, detail and search share. What they guard:
 *  - campusLabel and withCampusLabel: each campus's label in each lang, added
 *    to an item without changing its other fields or the item itself;
 *  - toBuildingCard: the stored building plus campusLabel, with updatedAt as
 *    the ISO string JSON makes of the Date (absent when the document has
 *    none), and a card that parses as the buildingCard wire schema;
 *  - withEnFallback: an empty or missing English text shows the Korean one,
 *    and anything else, the given text included, is left as it is.
 */
import type { SupportedLang } from "../infra/types";
import type { BuildingDoc } from "./building.document";
import { campusLabel, toBuildingCard, withCampusLabel, withEnFallback } from "./building.mapper";
import type { BilingualText, BuildNo, Campus, DisplayNo, SkkuId } from "./building.types";
import { buildingCard } from "./building.wire";

const UPDATED_AT = new Date("2026-10-10T03:04:05.678Z");

function buildingDoc(over: Partial<BuildingDoc> = {}): BuildingDoc {
  return {
    _id: 2 as SkkuId,
    buildNo: "101" as BuildNo,
    displayNo: "1" as DisplayNo,
    type: "building",
    campus: "hssc",
    name: { ko: "600주년기념관", en: "600th Anniversary Hall" },
    description: { ko: "건학 600주년을 기념하는 건물", en: "Built for the 600th anniversary" },
    location: { type: "Point", coordinates: [126.994479, 37.587361] },
    image: { url: "https://www.skku.edu/_attach/image/2018/07/a.jpg", filename: "a.jpg" },
    attachments: [{ id: 12, url: "https://www.skku.edu/_attach/image/2018/07/a.jpg", filename: "P2.jpg", alt: "" }],
    accessibility: { elevator: true, toilet: true, detail: null },
    skkuCreatedAt: "2018-04-23T00:34:12.000+00:00",
    skkuUpdatedAt: "2021-03-25T02:38:41.000+00:00",
    updatedAt: UPDATED_AT,
    ...over,
  };
}

describe("campusLabel", () => {
  it.each<[Campus, SupportedLang, string]>([
    ["hssc", "ko", "인사캠"],
    ["hssc", "en", "HSSC"],
    ["hssc", "zh", "人文校区"],
    ["nsc", "ko", "자과캠"],
    ["nsc", "en", "NSC"],
    ["nsc", "zh", "自然校区"],
  ])("labels %s in %s as %s", (campus, lang, label) => {
    // Act & Assert
    expect(campusLabel(campus, lang)).toBe(label);
  });
});

describe("withCampusLabel", () => {
  it("adds the label for the item's campus and keeps every other field", () => {
    // Arrange
    const space = { campus: "nsc" as Campus, spaceCd: "21101", name: { ko: "강의실", en: "Lecture room" } };

    // Act
    const labelled = withCampusLabel(space, "en");

    // Assert
    expect(labelled).toStrictEqual({ ...space, campusLabel: "NSC" });
    expect(space).not.toHaveProperty("campusLabel");
  });
});

describe("toBuildingCard", () => {
  it("serves the stored building with its campus label and updatedAt as an ISO string", () => {
    // Arrange
    const building = buildingDoc();

    // Act
    const card = toBuildingCard(building, "ko");

    // Assert
    expect(card).toStrictEqual({ ...building, campusLabel: "인사캠", updatedAt: "2026-10-10T03:04:05.678Z" });
    expect(building.updatedAt).toBe(UPDATED_AT);
  });

  it("leaves updatedAt out of the JSON when the document has none", () => {
    // Arrange
    const building = buildingDoc();
    delete building.updatedAt;

    // Act
    const card = toBuildingCard(building, "en");

    // Assert
    expect(card.updatedAt).toBeUndefined();
    expect(JSON.parse(JSON.stringify(card))).not.toHaveProperty("updatedAt");
    expect(card.campusLabel).toBe("HSSC");
  });

  it.each([
    ["with updatedAt", buildingDoc()],
    ["without updatedAt", buildingDoc({ updatedAt: undefined })],
  ])("builds a card that parses as the wire schema, %s", (_case, building) => {
    // Act
    const result = buildingCard.safeParse(JSON.parse(JSON.stringify(toBuildingCard(building, "ko"))));

    // Assert
    expect(result.error?.issues).toBeUndefined();
  });
});

describe("withEnFallback", () => {
  it.each<[string, Partial<BilingualText> | undefined, Partial<BilingualText> | undefined]>([
    ["an empty English text", { ko: "강의실", en: "" }, { ko: "강의실", en: "강의실" }],
    ["a missing English text", { ko: "강의실" }, { ko: "강의실", en: "강의실" }],
    ["both texts", { ko: "강의실", en: "Lecture room" }, { ko: "강의실", en: "Lecture room" }],
    ["two empty texts", { ko: "", en: "" }, { ko: "", en: "" }],
    ["English only", { en: "Lecture room" }, { en: "Lecture room" }],
    ["neither text", {}, {}],
    ["no text", undefined, undefined],
  ])("reads %s", (_case, text, expected) => {
    // Act & Assert
    expect(withEnFallback(text)).toStrictEqual(expected);
  });

  it("returns a copy when it fills English, leaving the given text unchanged", () => {
    // Arrange
    const text = { ko: "강의실", en: "" };

    // Act
    const filled = withEnFallback(text);

    // Assert
    expect(filled).toStrictEqual({ ko: "강의실", en: "강의실" });
    expect(text).toStrictEqual({ ko: "강의실", en: "" });
  });
});
