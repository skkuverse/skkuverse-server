/**
 * A transit item's id, unique across the layout and sent as the analytics
 * item id of a tap: a bus item is `bus:<groupId>`, a subway item
 * `subway:<stationId>`, a group `group:<id>`, and a link item keeps the slug
 * written in the layout, which holds no colon and so never collides with the
 * other three.
 *
 * The checks a layout needs beyond its schema (move-editorial-datasets D5),
 * pure, so `npm run data` refuses a push on any issue and the reader leaves
 * out the items an issue points into:
 * - toTransitLayoutIssues finds a bus group or station the code does not
 *   serve, a broken link action, a `visibleWith` group unknown or not placed
 *   in its section, and each served group or station the layout leaves
 *   unplaced (at `sections`), a group's children counting as placed;
 * - transitLayoutReferences lists every bus group, station and mini app the
 *   layout names, at its path;
 * - withoutUnresolvedItems drops each item an issue points into (a group whole
 *   when the issue is its own, a child alone otherwise) and ignores the
 *   unplaced issues, which name no item.
 *
 * Revision 1 of the dataset (fixtures/transit-layout.dataset.json) has no
 * issue against the real bus groups, stations and registry.
 */
import fs from "fs";
import path from "path";
import { BusConfigService } from "../../bus/config/bus-config.service";
import { fixtureRegistrySnapshot } from "../../../__tests__/helpers/miniapps/registry-fixture";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { toTransitItemId, toTransitLayoutIssues, transitLayoutReferences, withoutUnresolvedItems } from "./ui-transit.rules";
import { transitLayoutFile, type TransitLayoutRaw } from "./ui-transit.schema";
import type { TransitLayoutReferences } from "./ui-transit.types";

describe("toTransitItemId", () => {
  it.each([
    [{ kind: "bus", groupId: "hssc" }, "bus:hssc"],
    [{ kind: "subway", stationId: "hyehwa" }, "subway:hyehwa"],
    [{ kind: "group", id: "commute-stations" }, "group:commute-stations"],
    [{ kind: "link", id: "taxi-share" }, "taxi-share"],
  ] as const)("names %j %s", (reference, id) => {
    // Act & Assert
    expect(toTransitItemId(reference)).toBe(id);
  });
});

const registry = fixtureRegistrySnapshot();
const references: TransitLayoutReferences = { busGroupIds: ["campus", "hssc"], stationIds: ["hyehwa"], registry };
const withCommute: TransitLayoutReferences = { ...references, busGroupIds: ["campus", "hssc", "commute"], stationIds: ["hyehwa", "jamsil", "gangnam"] };

const LINK = {
  kind: "link",
  id: "taxi-share",
  title: { ko: "택시 합승", en: "Taxi share" },
  icon: { type: "taxi", color: "FFB300", text: { ko: "택시" } },
  actionType: "miniapp",
  actionValue: "inja",
};
const PLACED = [{ kind: "bus", groupId: "campus" }, { kind: "bus", groupId: "hssc" }, { kind: "subway", stationId: "hyehwa" }];
const COMMUTE = { kind: "bus", groupId: "commute" };

const parsed = (raw: unknown): TransitLayoutRaw => transitLayoutFile.parse(raw);

function layout(...items: unknown[]): TransitLayoutRaw {
  return parsed({ version: 1, sections: [{ type: "item_list", id: "campus", title: { ko: "캠퍼스" }, items }] });
}

function group(items: unknown[], visibleWith: unknown = COMMUTE): Record<string, unknown> {
  const icon = { type: "subway", color: "8B95A1", text: { ko: "환승" } };
  return { kind: "group", id: "commute-stations", title: { ko: "통학버스 정류장 지하철" }, icon, initialState: "collapsed", visibleWith, items };
}

function twoSections(campusItems: unknown[], nscItems: unknown[]): TransitLayoutRaw {
  const campus = { type: "item_list", id: "campus", items: campusItems };
  return parsed({ version: 1, sections: [campus, { type: "item_list", id: "nsc", title: { ko: "자과캠" }, items: nscItems }] });
}

const issueLines = (issues: Array<{ path: Array<string | number>; message: string }>): string[] => issues.map(({ path: at, message }) => `${at.join(".")}: ${message}`);

function fixtureLayout(): TransitLayoutRaw {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/ui/fixtures/transit-layout.dataset.json"), "utf8")) as Record<string, unknown>;
  delete fixture._about;
  return parsed(fixture);
}

describe("toTransitLayoutIssues", () => {
  it("finds no issue in a layout that places every bus group and station once, with a link", () => {
    // Act & Assert
    expect(toTransitLayoutIssues(layout(...PLACED, LINK), references)).toEqual([]);
  });

  it("finds an unknown group at the item's groupId, naming the group", () => {
    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(layout(...PLACED, { kind: "bus", groupId: "nope" }), references))).toEqual([
      'sections.0.items.3.groupId: "nope" is not a bus group',
    ]);
  });

  it("finds an unknown station at the item's stationId, naming the station", () => {
    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(layout(...PLACED, { kind: "subway", stationId: "gangnam" }), references))).toEqual([
      'sections.0.items.3.stationId: "gangnam" is not a served subway station',
    ]);
  });

  it("finds a served bus group the layout does not place, at sections", () => {
    // Arrange
    const added = { ...references, busGroupIds: [...references.busGroupIds, "commute"] };

    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(layout(...PLACED), added))).toEqual(['sections: bus group "commute" is not placed']);
  });

  it("finds a served station the layout does not place, at sections", () => {
    // Arrange
    const added = { ...references, stationIds: ["sungkyunkwan", ...references.stationIds] };

    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(layout(...PLACED), added))).toEqual(['sections: subway station "sungkyunkwan" is not placed']);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unregistered mini app", { actionType: "miniapp", actionValue: "no-such-app" }],
    ["a relative route", { actionType: "route", actionValue: "taxi" }],
    ["an http external URL", { actionType: "external", actionValue: "http://example.com" }],
    ["a webview off its origin", { actionType: "webview", actionValue: "https://example.com/page" }],
  ])("finds a link action to %s at its actionValue", (_label, action) => {
    // Act
    const lines = issueLines(toTransitLayoutIssues(layout(...PLACED, { ...LINK, ...action }), references));

    // Assert
    expect(lines).toEqual([`sections.0.items.3.actionValue: "taxi-share" actionValue "${action.actionValue}" is not valid for "${action.actionType}"`]);
  });

  it("finds every issue, not only the first", () => {
    // Act
    const lines = issueLines(toTransitLayoutIssues(layout({ kind: "bus", groupId: "nope" }), references));

    // Assert
    expect(lines).toEqual([
      'sections.0.items.0.groupId: "nope" is not a bus group',
      'sections: bus group "campus" is not placed',
      'sections: bus group "hssc" is not placed',
      'sections: subway station "hyehwa" is not placed',
    ]);
  });

  it("counts a station placed only inside a group as placed", () => {
    // Arrange
    const raw = twoSections(PLACED, [COMMUTE, { kind: "subway", stationId: "gangnam" }, group([{ kind: "subway", stationId: "jamsil" }])]);

    // Act & Assert
    expect(toTransitLayoutIssues(raw, withCommute)).toEqual([]);
  });

  it("counts a bus group placed only inside a group as placed", () => {
    // Arrange
    const raw = twoSections(PLACED, [group([COMMUTE, { kind: "subway", stationId: "jamsil" }, { kind: "subway", stationId: "gangnam" }], undefined)]);

    // Act & Assert
    expect(toTransitLayoutIssues(raw, withCommute)).toEqual([]);
  });

  it("finds an unknown station inside a group at the child's path", () => {
    // Arrange
    const raw = twoSections(PLACED, [COMMUTE, group([{ kind: "subway", stationId: "jamsil" }, { kind: "subway", stationId: "gangnam" }, { kind: "subway", stationId: "seoul" }])]);

    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(raw, withCommute))).toEqual(['sections.1.items.1.items.2.stationId: "seoul" is not a served subway station']);
  });

  it("finds a broken link action inside a group at the child's path", () => {
    // Arrange
    const raw = twoSections(PLACED, [COMMUTE, group([{ kind: "subway", stationId: "jamsil" }, { kind: "subway", stationId: "gangnam" }, { ...LINK, actionValue: "no-such-app" }])]);

    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(raw, withCommute))).toEqual([
      'sections.1.items.1.items.2.actionValue: "taxi-share" actionValue "no-such-app" is not valid for "miniapp"',
    ]);
  });

  it("finds a visibleWith that names no bus group, at its groupId", () => {
    // Arrange
    const raw = twoSections(PLACED, [COMMUTE, group([{ kind: "subway", stationId: "jamsil" }, { kind: "subway", stationId: "gangnam" }], { kind: "bus", groupId: "nope" })]);

    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(raw, withCommute))).toEqual(['sections.1.items.1.visibleWith.groupId: "nope" is not a bus group']);
  });

  it("finds a visibleWith bus group placed in another section, naming the group and the section", () => {
    // Arrange
    const raw = twoSections([...PLACED, COMMUTE], [group([{ kind: "subway", stationId: "jamsil" }, { kind: "subway", stationId: "gangnam" }])]);

    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(raw, withCommute))).toEqual([
      'sections.1.items.0.visibleWith.groupId: bus group "commute" is not placed in section "nsc"',
    ]);
  });

  it("finds no issue in a visibleWith bus group placed inside a group of the same section", () => {
    // Arrange
    const other = { ...group([COMMUTE]), id: "night" };
    const raw = twoSections(PLACED, [other, group([{ kind: "subway", stationId: "jamsil" }, { kind: "subway", stationId: "gangnam" }])]);

    // Act & Assert
    expect(toTransitLayoutIssues(raw, withCommute)).toEqual([]);
  });

  it("finds a station left unplaced when the others sit in a group", () => {
    // Arrange
    const raw = twoSections(PLACED, [COMMUTE, group([{ kind: "subway", stationId: "jamsil" }])]);

    // Act & Assert
    expect(issueLines(toTransitLayoutIssues(raw, withCommute))).toEqual(['sections: subway station "gangnam" is not placed']);
  });

  it("finds no issue in revision 1 of the dataset against the real bus groups, stations and registry", () => {
    // Arrange
    const real: TransitLayoutReferences = {
      // BusConfigService.listGroupIds reads neither of its providers.
      busGroupIds: new BusConfigService(null as never, null as never, null as never).listGroupIds(),
      stationIds: new SubwayStationsService().listStations().map((station) => station.id),
      registry,
    };

    // Act & Assert
    expect(toTransitLayoutIssues(fixtureLayout(), real)).toEqual([]);
  });
});

describe("transitLayoutReferences", () => {
  it("lists every bus group, station and mini app the layout names, group children and visibleWith included, at their paths", () => {
    // Arrange
    const raw = twoSections([{ kind: "bus", groupId: "campus" }, { ...LINK, actionValue: "inja/entry" }], [COMMUTE, group([{ kind: "subway", stationId: "jamsil" }, { ...LINK, id: "map", actionType: "route", actionValue: "/map" }])]);

    // Act
    const listed = transitLayoutReferences(raw, registry);

    // Assert
    expect(listed).toEqual([
      { dataset: "busGroups", id: "campus", path: ["sections", 0, "items", 0, "groupId"] },
      { dataset: "miniapps", id: "inja", path: ["sections", 0, "items", 1, "actionValue"] },
      { dataset: "busGroups", id: "commute", path: ["sections", 1, "items", 0, "groupId"] },
      { dataset: "busGroups", id: "commute", path: ["sections", 1, "items", 1, "visibleWith", "groupId"] },
      { dataset: "subwayStations", id: "jamsil", path: ["sections", 1, "items", 1, "items", 0, "stationId"] },
    ]);
  });

  it("lists the bus groups and stations of revision 1 and no mini app", () => {
    // Act
    const listed = transitLayoutReferences(fixtureLayout(), registry);

    // Assert
    expect(new Set(listed.map((reference) => reference.dataset))).toEqual(new Set(["busGroups", "subwayStations"]));
    expect(listed.filter((reference) => reference.dataset === "busGroups").map((reference) => reference.id)).toEqual(
      expect.arrayContaining(["campus", "fasttrack", "hssc", "jongro02", "jongro07", "jongro08", "commute"]),
    );
  });
});

describe("withoutUnresolvedItems", () => {
  const STATIONS = [{ kind: "subway", stationId: "jamsil" }, { kind: "subway", stationId: "gangnam" }];
  const raw = (): TransitLayoutRaw => twoSections(PLACED, [COMMUTE, group(STATIONS)]);
  const idsOf = (kept: TransitLayoutRaw) =>
    kept.sections.map((section) => [section.id, section.items.map((item) => (item.kind === "group" ? [toTransitItemId(item), item.items.map(toTransitItemId)] : toTransitItemId(item)))]);

  it("drops a top-level item an issue points into, keeping the rest in order", () => {
    // Act
    const kept = withoutUnresolvedItems(raw(), [{ path: ["sections", 0, "items", 1, "groupId"], message: "x" }]);

    // Assert
    expect(idsOf(kept)[0]).toEqual(["campus", ["bus:campus", "subway:hyehwa"]]);
  });

  it("drops a group's child alone when the issue points into it", () => {
    // Act
    const kept = withoutUnresolvedItems(raw(), [{ path: ["sections", 1, "items", 1, "items", 0, "stationId"], message: "x" }]);

    // Assert
    expect(idsOf(kept)[1]).toEqual(["nsc", ["bus:commute", ["group:commute-stations", ["subway:gangnam"]]]]);
  });

  it("drops a group whole when its visibleWith group is unknown", () => {
    // Act
    const kept = withoutUnresolvedItems(raw(), [{ path: ["sections", 1, "items", 1, "visibleWith", "groupId"], message: "x" }]);

    // Assert
    expect(idsOf(kept)[1]).toEqual(["nsc", ["bus:commute"]]);
  });

  it("drops a group whose every child is dropped, and a section whose every item is", () => {
    // Arrange
    const issues = [
      { path: ["sections", 1, "items", 0, "groupId"], message: "x" },
      { path: ["sections", 1, "items", 1, "items", 0, "stationId"], message: "x" },
      { path: ["sections", 1, "items", 1, "items", 1, "stationId"], message: "x" },
    ];

    // Act
    const kept = withoutUnresolvedItems(raw(), issues);

    // Assert
    expect(kept.sections.map((section) => section.id)).toEqual(["campus"]);
  });

  it("ignores an unplaced issue, which names no item", () => {
    // Act
    const kept = withoutUnresolvedItems(raw(), [{ path: ["sections"], message: 'bus group "night" is not placed' }]);

    // Assert
    expect(kept).toEqual(raw());
  });

  it("throws on an issue whose path names neither the layout's sections nor an item, a fault in its caller", () => {
    // Act & Assert
    expect(() => withoutUnresolvedItems(raw(), [{ path: ["version"], message: "x" }])).toThrow("names no item");
  });
});
