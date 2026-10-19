/**
 * The structure of the transit-layout dataset: version 1, sections of type
 * `item_list` with a slug id, an optional localized title and at least one item, and
 * items that place a bus group, a subway station, a written link or a group.
 * A group has a slug id, a localized title, an optional subtitle, an icon, a
 * required initial state, an optional `visibleWith` bus group and at least one
 * child, which is a bus, subway or link item and never a group. Section ids
 * and item ids, group children and `group:<id>` included, each repeat nowhere
 * in the layout, so a bus group or a station is placed at most once. Unknown
 * keys and kinds are refused.
 *
 * storedTransitLayout parses the `transit-layout` document as
 * scripts/lib/datasets/store.js writes it: a positive whole revision and the
 * layout as its data.
 */
import fs from "fs";
import path from "path";
import { storedTransitLayout, transitLayoutFile } from "./ui-transit.schema";

const LINK = {
  kind: "link",
  id: "taxi-share",
  title: { ko: "택시 합승", en: "Taxi share" },
  icon: { type: "taxi", color: "FFB300", text: { ko: "택시", en: "Taxi" } },
  actionType: "miniapp",
  actionValue: "inja",
};

const GROUP = {
  kind: "group",
  id: "commute-stations",
  title: { ko: "통학버스 정류장 지하철", en: "Subway at shuttle stops" },
  subtitle: { ko: "정자 · 잠실" },
  icon: { type: "subway", color: "8B95A1", text: { ko: "환승" } },
  initialState: "collapsed",
  visibleWith: { kind: "bus", groupId: "commute" },
  items: [{ kind: "subway", stationId: "jeongja" }, { kind: "bus", groupId: "fasttrack" }, { ...LINK, id: "commute-map" }],
};

function section(id: string, items: unknown[]): Record<string, unknown> {
  return { type: "item_list", id, title: { ko: "캠퍼스", en: "Campus" }, items };
}

function layout(...sections: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, sections };
}

const WELL_FORMED = layout(
  section("campus", [{ kind: "bus", groupId: "campus" }, LINK]),
  section("hssc", [{ kind: "bus", groupId: "hssc" }, { kind: "subway", stationId: "hyehwa" }]),
  section("nsc", [{ kind: "bus", groupId: "commute" }, GROUP]),
);

function groupWithout(field: keyof typeof GROUP): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...GROUP };
  delete rest[field];
  return rest;
}

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

  it("parses a group with no subtitle and no visibleWith, its initial state expanded", () => {
    // Arrange
    const bare = { ...groupWithout("subtitle"), visibleWith: undefined, initialState: "expanded" };

    // Act & Assert
    expect(transitLayoutFile.safeParse(layout(section("nsc", [bare]))).success).toBe(true);
  });

  it("Nested group: refuses a group inside a group, naming the inner group's path", () => {
    // Arrange
    const nested = { ...GROUP, items: [{ ...GROUP, id: "inner" }] };

    // Act
    const parsed = transitLayoutFile.safeParse(layout(section("nsc", [{ kind: "bus", groupId: "commute" }, nested])));

    // Assert
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ["sections", 0, "items", 1, "items", 0, "kind"], message: "a group holds only bus, subway or link items" }),
    ]);
  });

  it("Missing initial state: refuses a group with no initialState, naming the group's path", () => {
    // Act
    const parsed = transitLayoutFile.safeParse(layout(section("nsc", [groupWithout("initialState")])));

    // Assert
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ["sections", 0, "items", 0, "initialState"] })]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown key", { ...GROUP, action: { actionType: "route", actionValue: "/subway" } }],
    ["no icon", groupWithout("icon")],
    ["no title", groupWithout("title")],
    ["no child", { ...GROUP, items: [] }],
    ["an initial state other than collapsed or expanded", { ...GROUP, initialState: "peek" }],
    ["an id that is not a slug", { ...GROUP, id: "group:commute" }],
    ["a visibleWith that names no bus group", { ...GROUP, visibleWith: { kind: "subway", stationId: "jeongja" } }],
    ["an unknown key in visibleWith", { ...GROUP, visibleWith: { kind: "bus", groupId: "commute", until: "2026-12-18" } }],
  ])("refuses a group with %s", (_label, group) => {
    // Act & Assert
    expect(transitLayoutFile.safeParse(layout(section("nsc", [group]))).success).toBe(false);
  });

  it("Station placed twice: refuses a station at the top of a section and inside a group, naming its item id", () => {
    // Arrange
    const twice = layout(section("nsc", [{ kind: "subway", stationId: "gangnam" }, { ...GROUP, items: [{ kind: "subway", stationId: "gangnam" }] }]));

    // Act
    const parsed = transitLayoutFile.safeParse(twice);

    // Assert
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ["sections", 0, "items", 1, "items", 0], message: 'item "subway:gangnam" is placed more than once' }),
    ]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["a bus group in two groups", layout(section("nsc", [GROUP, { ...GROUP, id: "other", items: [{ kind: "bus", groupId: "fasttrack" }] }])), "bus:fasttrack"],
    ["a group id used twice", layout(section("nsc", [GROUP]), section("hssc", [{ ...GROUP, items: [{ kind: "bus", groupId: "hssc" }] }])), "group:commute-stations"],
  ])("refuses %s, naming its item id", (_label, raw, itemId) => {
    // Act
    const parsed = transitLayoutFile.safeParse(raw);

    // Assert
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([`item "${itemId}" is placed more than once`]);
  });

  it("keeps a group's id apart from a link written with the same slug", () => {
    // Arrange
    const sameSlug = layout(section("nsc", [{ ...LINK, id: "commute-stations" }, { ...GROUP, items: [{ kind: "bus", groupId: "commute" }] }]));

    // Act & Assert
    expect(transitLayoutFile.safeParse(sameSlug).success).toBe(true);
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
    ["a station placed twice", layout(section("campus", [{ kind: "subway", stationId: "hyehwa" }, { kind: "subway", stationId: "hyehwa" }]))],
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

describe("storedTransitLayout", () => {
  const FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/transit-layout.dataset.json");

  /** A `datasets` document as scripts/lib/datasets/store.js writes it, with revision 1 of the layout as its data. */
  function storedDocument(): Record<string, unknown> {
    const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
    delete data._about;
    return { _id: "transit-layout", revision: 2, data, updatedAt: new Date("2026-10-19T03:00:00.000Z"), updatedBy: "alice@example.com" };
  }

  it("parses a stored transit-layout document", () => {
    // Act
    const parsed = storedTransitLayout.safeParse(storedDocument());

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data?.revision).toBe(2);
  });

  it.each(["revision", "data"])("refuses a stored document without its %s", (field) => {
    // Arrange
    const rest = storedDocument();
    delete rest[field];

    // Act & Assert
    expect(storedTransitLayout.safeParse(rest).success).toBe(false);
  });

  it.each([0, -1, 1.5, "3"])("refuses a revision of %p", (revision) => {
    // Act & Assert
    expect(storedTransitLayout.safeParse({ ...storedDocument(), revision }).success).toBe(false);
  });

  it("refuses stored data the layout schema refuses", () => {
    // Arrange
    const stored = storedDocument();
    const data = { ...(stored.data as Record<string, unknown>), extra: 1 };

    // Act & Assert
    expect(storedTransitLayout.safeParse({ ...stored, data }).success).toBe(false);
  });
});
