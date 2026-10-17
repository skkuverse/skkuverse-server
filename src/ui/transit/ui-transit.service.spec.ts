/**
 * UiTransitService over the committed transit-layout.json, the real bus
 * groups (through a fake BusConfigService that can move a group's visibility),
 * the real served stations and a fixed Clock. What it guards: the layout is
 * checked when the service is built, a bus item shows only while its group is
 * visible in KST (the commute shuttle's card opens at 11:55 KST on 2026-10-12
 * and closes after 2026-12-18), subway items always show, a section left with
 * no item is not served, and the text follows the request language.
 */
import { FakeBusConfigService } from "../../../__tests__/helpers/fakes/bus/bus-config.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { BusConfigService } from "../../bus/config/bus-config.service";
import type { BusGroupVisibility } from "../../bus/config/bus-config.types";
import { BusStopsService } from "../../bus/stops/bus-stops.service";
import type { Clock } from "../../infra/clock";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { UiTransitService } from "./ui-transit.service";

const realBusConfig = new BusConfigService(new BusStopsService());

let busConfig: FakeBusConfigService;

function withVisibility(visibilityByGroupId: Record<string, BusGroupVisibility>): void {
  for (const lang of ["ko", "en", "zh"] as const) {
    const groups = realBusConfig.getBusGroups(lang).map((group) => ({ ...group, visibility: visibilityByGroupId[group.id] ?? group.visibility }));
    busConfig.busGroupsByLang.set(lang, groups);
  }
}

function serviceAt(iso: string): UiTransitService {
  const clock: Clock = { now: () => new Date(iso) };
  return new UiTransitService(asReal<BusConfigService>(busConfig), new SubwayStationsService(), new MiniappsService(), clock);
}

const itemIdsOf = (service: UiTransitService, sectionId: string): string[] | undefined =>
  service
    .getTransitLayout("ko")
    .sections.find((section) => section.id === sectionId)
    ?.items.map((served) => served.id);

beforeEach(() => {
  busConfig = new FakeBusConfigService();
  withVisibility({});
});

describe("UiTransitService.getTransitLayout", () => {
  it("serves the launch layout on 2026-10-20 in Korean, version 1, campus, hssc and nsc in order", () => {
    // Arrange
    const service = serviceAt("2026-10-20T03:00:00Z");

    // Act
    const layout = service.getTransitLayout("ko");

    // Assert
    expect(layout.version).toBe(1);
    expect(layout.sections.map(({ type, id, title }) => ({ type, id, title }))).toEqual([
      { type: "item_list", id: "campus", title: null },
      { type: "item_list", id: "hssc", title: "인사캠" },
      { type: "item_list", id: "nsc", title: "자과캠" },
    ]);
    expect(layout.sections.map((section) => section.items.map((served) => served.id))).toEqual([
      ["bus:campus"],
      ["subway:S1-4-420", "bus:hssc", "bus:jongro02", "bus:jongro07", "bus:jongro08"],
      ["subway:KR-1-0153", "bus:commute"],
    ]);
  });

  it("serves English titles with the same section and item ids", () => {
    // Arrange
    const service = serviceAt("2026-10-20T03:00:00Z");

    // Act
    const ko = service.getTransitLayout("ko");
    const en = service.getTransitLayout("en");

    // Assert
    expect(en.sections.map((section) => section.title)).toEqual([null, "HSSC", "NSC"]);
    expect(en.sections[1]?.items.map((served) => served.title)).toEqual([
      "Hyehwa Station",
      "HSSC Shuttle Bus",
      "Jongro 02",
      "Jongro 07",
      "Jongro 08",
    ]);
    expect(en.sections.map((section) => section.items.map((served) => served.id))).toEqual(
      ko.sections.map((section) => section.items.map((served) => served.id)),
    );
  });

  it.each([
    ["2026-10-12T02:54:59.999Z", ["subway:KR-1-0153"]],
    ["2026-10-12T02:55:00.000Z", ["subway:KR-1-0153", "bus:commute"]],
  ])("at %s, around 11:55 KST when the commute card opens, serves nsc as %p", (iso, itemIds) => {
    // Act & Assert
    expect(itemIdsOf(serviceAt(iso), "nsc")).toEqual(itemIds);
  });

  it.each([
    ["2026-12-18T14:59:59.999Z", ["subway:KR-1-0153", "bus:commute"]],
    ["2026-12-18T15:00:00.000Z", ["subway:KR-1-0153"]],
  ])("at %s, around 00:00 KST on 2026-12-19 after the pilot, serves nsc as %p", (iso, itemIds) => {
    // Act & Assert
    expect(itemIdsOf(serviceAt(iso), "nsc")).toEqual(itemIds);
  });

  it("serves fasttrack in the campus section only inside its window", () => {
    // Arrange
    withVisibility({ fasttrack: { type: "dateRange", from: "2026-10-20", until: "2026-10-21" } });

    // Act
    const before = itemIdsOf(serviceAt("2026-10-19T14:59:59.999Z"), "campus");
    const during = itemIdsOf(serviceAt("2026-10-19T15:00:00.000Z"), "campus");

    // Assert
    expect(before).toEqual(["bus:campus"]);
    expect(during).toEqual(["bus:campus", "bus:fasttrack"]);
  });

  it("does not serve a section whose every item is hidden", () => {
    // Arrange
    const past: BusGroupVisibility = { type: "dateRange", from: "2026-03-01", until: "2026-03-07" };
    withVisibility({ campus: past, fasttrack: past });

    // Act
    const layout = serviceAt("2026-10-20T03:00:00Z").getTransitLayout("ko");

    // Assert
    expect(layout.sections.map((section) => section.id)).toEqual(["hssc", "nsc"]);
  });

  it("refuses to build over a bus group the layout does not place", () => {
    // Arrange
    const groups = realBusConfig.getBusGroups("ko");
    busConfig.busGroupsByLang.set("ko", [...groups, { ...groups[0]!, id: "night" }]);

    // Act & Assert
    expect(() => serviceAt("2026-10-20T03:00:00Z")).toThrow('transit layout: sections: bus group "night" is not placed');
  });
});
