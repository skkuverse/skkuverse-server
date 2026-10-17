/**
 * The structure of transit-layout.json: version 1, sections of type
 * `item_list` with a slug id, an optional localized title and at least one item, and
 * items that place a bus group, a subway station or a written link. Section
 * ids and item ids each repeat nowhere in the layout, so a group or a station
 * is placed at most once. Unknown keys and kinds are refused.
 */
import { transitLayoutFile } from "./ui-transit.schema";

const LINK = {
  kind: "link",
  id: "taxi-share",
  title: { ko: "택시 합승", en: "Taxi share" },
  icon: { type: "taxi", color: "FFB300", text: { ko: "택시", en: "Taxi" } },
  actionType: "miniapp",
  actionValue: "inja",
};

function section(id: string, items: unknown[]): Record<string, unknown> {
  return { type: "item_list", id, title: { ko: "캠퍼스", en: "Campus" }, items };
}

function layout(...sections: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, sections };
}

const WELL_FORMED = layout(
  section("campus", [{ kind: "bus", groupId: "campus" }, LINK]),
  section("hssc", [{ kind: "bus", groupId: "hssc" }, { kind: "subway", stationId: "S1-4-420" }]),
);

describe("transitLayoutFile", () => {
  it("parses a layout of every item kind", () => {
    // Act & Assert
    expect(transitLayoutFile.safeParse(WELL_FORMED).success).toBe(true);
  });

  it("parses a link with a subtitle", () => {
    // Arrange
    const withSubtitle = layout(section("campus", [{ ...LINK, subtitle: { ko: "인사캠 ↔ 자과캠" } }]));

    // Act & Assert
    expect(transitLayoutFile.safeParse(withSubtitle).success).toBe(true);
  });

  it("parses a section with no title", () => {
    // Arrange
    const untitled = section("campus", [LINK]);
    delete untitled.title;

    // Act & Assert
    expect(transitLayoutFile.safeParse(layout(untitled)).success).toBe(true);
  });

  it.each(Object.keys(transitLayoutFile.shape))("refuses a layout without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...WELL_FORMED };
    delete rest[field];

    // Act & Assert
    expect(transitLayoutFile.safeParse(rest).success).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an empty section", layout(section("campus", []))],
    ["a section id used twice", layout(section("campus", [LINK]), section("campus", [{ kind: "bus", groupId: "hssc" }]))],
    ["a bus group placed twice", layout(section("campus", [{ kind: "bus", groupId: "hssc" }]), section("hssc", [{ kind: "bus", groupId: "hssc" }]))],
    ["a station placed twice", layout(section("campus", [{ kind: "subway", stationId: "S1-4-420" }, { kind: "subway", stationId: "S1-4-420" }]))],
    ["a link id used twice", layout(section("campus", [LINK, LINK]))],
    ["an unknown item kind", layout(section("campus", [{ kind: "taxi", id: "taxi" }]))],
    ["an unknown section type", layout({ ...section("campus", [LINK]), type: "route_card" })],
    ["a version other than 1", { ...WELL_FORMED, version: 2 }],
    ["an unknown root key", { ...WELL_FORMED, extra: 1 }],
    ["an extra key on a bus item", layout(section("campus", [{ kind: "bus", groupId: "hssc", title: { ko: "셔틀" } }]))],
    ["a section id that is not a slug", layout(section("Campus Tab", [LINK]))],
    ["a link id that is not a slug", layout(section("campus", [{ ...LINK, id: "bus:hssc" }]))],
    ["a link with no title", layout(section("campus", [{ ...LINK, title: undefined }]))],
    ["a link icon color with a #", layout(section("campus", [{ ...LINK, icon: { ...LINK.icon, color: "#FFB300" } }]))],
  ])("refuses %s", (_label, raw) => {
    // Act & Assert
    expect(transitLayoutFile.safeParse(raw).success).toBe(false);
  });

  it("names where an item id repeats", () => {
    // Arrange
    const twice = layout(section("campus", [{ kind: "bus", groupId: "hssc" }]), section("hssc", [{ kind: "bus", groupId: "hssc" }]));

    // Act
    const parsed = transitLayoutFile.safeParse(twice);

    // Assert
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ["sections", 1, "items", 0], message: 'item "bus:hssc" is placed more than once' }),
    ]);
  });
});
