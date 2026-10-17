/**
 * The transit layout as loaded at boot (loadTransitLayout: the structure in
 * ui-transit.schema.ts plus its references): every bus item names a bus group
 * and every subway item a served station, every link action passes its
 * type's check against the mini-app registry, and every bus group and every
 * served station is placed. Each rejection here is a deploy that must not
 * start, and the error names the path and the id at fault. The committed
 * transit-layout.json loads against the real bus groups and stations.
 */
import { BusConfigService } from "../../bus/config/bus-config.service";
import { BusStopsService } from "../../bus/stops/bus-stops.service";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { loadTransitLayout, readTransitLayout } from "./ui-transit.config";
import { toTransitItemId } from "./ui-transit.rules";
import type { TransitLayoutReferences } from "./ui-transit.types";

const references: TransitLayoutReferences = {
  busGroupIds: ["campus", "hssc"],
  stationIds: ["S1-4-420"],
  registry: new MiniappsService(),
};

const LINK = {
  kind: "link",
  id: "taxi-share",
  title: { ko: "택시 합승", en: "Taxi share" },
  icon: { type: "taxi", color: "FFB300", text: { ko: "택시" } },
  actionType: "miniapp",
  actionValue: "inja",
};

const PLACED = [{ kind: "bus", groupId: "campus" }, { kind: "bus", groupId: "hssc" }, { kind: "subway", stationId: "S1-4-420" }];

function layout(...items: unknown[]): Record<string, unknown> {
  return { version: 1, sections: [{ type: "item_list", id: "campus", title: { ko: "캠퍼스" }, items }] };
}

describe("loadTransitLayout", () => {
  it("accepts a layout that places every bus group and station once, with a link", () => {
    // Act & Assert
    expect(() => loadTransitLayout(layout(...PLACED, LINK), references)).not.toThrow();
  });

  it("refuses an unknown group, naming the item's path and the group", () => {
    // Act & Assert
    expect(() => loadTransitLayout(layout(...PLACED, { kind: "bus", groupId: "nope" }), references)).toThrow(
      'transit layout: sections.0.items.3.groupId: "nope" is not a bus group',
    );
  });

  it("refuses an unknown station, naming the item's path and the station", () => {
    // Act & Assert
    expect(() => loadTransitLayout(layout(...PLACED, { kind: "subway", stationId: "S1-2-222" }), references)).toThrow(
      'transit layout: sections.0.items.3.stationId: "S1-2-222" is not a served subway station',
    );
  });

  it("refuses a bus group added to the bus config and not placed, naming the group", () => {
    // Arrange
    const withCommute = { ...references, busGroupIds: [...references.busGroupIds, "commute"] };

    // Act & Assert
    expect(() => loadTransitLayout(layout(...PLACED), withCommute)).toThrow('transit layout: sections: bus group "commute" is not placed');
  });

  it("refuses a served station that is not placed, naming the station", () => {
    // Arrange
    const withSungkyunkwan = { ...references, stationIds: ["KR-1-0153", ...references.stationIds] };

    // Act & Assert
    expect(() => loadTransitLayout(layout(...PLACED), withSungkyunkwan)).toThrow(
      'transit layout: sections: subway station "KR-1-0153" is not placed',
    );
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unregistered mini app", { actionType: "miniapp", actionValue: "no-such-app" }],
    ["a relative route", { actionType: "route", actionValue: "taxi" }],
    ["an http external URL", { actionType: "external", actionValue: "http://example.com" }],
  ])("refuses a link action to %s, naming its path", (_label, action) => {
    // Act & Assert
    expect(() => loadTransitLayout(layout(...PLACED, { ...LINK, ...action }), references)).toThrow(
      /^transit layout: sections\.0\.items\.3\.actionValue: "taxi-share" actionValue /,
    );
  });

  it("reports every issue in one error", () => {
    // Act
    const load = () => loadTransitLayout(layout({ kind: "bus", groupId: "nope" }), references);

    // Assert
    expect(load).toThrow(/"nope" is not a bus group; .*bus group "campus" is not placed; .*subway station "S1-4-420" is not placed/);
  });

  it("refuses a structural fault before checking references", () => {
    // Act & Assert
    expect(() => loadTransitLayout(layout(), references)).toThrow(/^transit layout: sections\.0\.items: /);
  });
});

describe("committed transit-layout.json", () => {
  it("loads against the real bus groups, stations and registry, in the launch layout", () => {
    // Arrange
    const real: TransitLayoutReferences = {
      busGroupIds: new BusConfigService(new BusStopsService()).getBusGroups("ko").map((group) => group.id),
      stationIds: new SubwayStationsService().listStations().map((station) => station.id),
      registry: new MiniappsService(),
    };

    // Act
    const committed = readTransitLayout(real);

    // Assert
    expect(committed.sections.map((section) => [section.id, section.items.map(toTransitItemId)])).toEqual([
      ["campus", ["bus:campus", "bus:fasttrack"]],
      ["hssc", ["bus:hssc", "bus:jongro02", "bus:jongro07", "bus:jongro08", "subway:S1-4-420"]],
      ["nsc", ["bus:commute", "subway:KR-1-0153"]],
    ]);
    expect(committed.sections.map((section) => section.title)).toEqual([
      undefined,
      { ko: "인사캠", en: "HSSC", zh: "人文校区" },
      { ko: "자과캠", en: "NSC", zh: "自然校区" },
    ]);
  });
});
