/**
 * UiTransitService over the committed transit-layout.json, the real bus
 * groups (through a fake BusConfigService that can move a group's visibility),
 * the real served stations and a fixed Clock. What it guards: the layout is
 * checked when the service is built, a bus item shows only while its group is
 * visible in KST (the commute shuttle's card opens at 11:55 KST on 2026-10-12
 * and closes after 2026-12-18), subway items always show, a section left with
 * no item is not served, and the text follows the request language. Layouts
 * with a group are fed through loadTransitLayout: a group shows only while its
 * `visibleWith` bus group does, never serves `visibleWith`, loses its hidden
 * bus children, is not served when none is left, and keeps its initial state.
 */
const actualConfig = jest.requireActual("./ui-transit.config");
let layoutFile: unknown;
jest.mock("./ui-transit.config", () => ({
  ...actualConfig,
  readTransitLayout: (references: unknown) =>
    layoutFile === undefined ? actualConfig.readTransitLayout(references) : actualConfig.loadTransitLayout(layoutFile, references),
}));

import { FakeBusConfigService } from "../../../__tests__/helpers/fakes/bus/bus-config.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { BusConfigService } from "../../bus/config/bus-config.service";
import type { BusGroupVisibility } from "../../bus/config/bus-config.types";
import type { BusGroup } from "../../bus/config/bus-config.wire";
import { BusStopsService } from "../../bus/stops/bus-stops.service";
import type { Clock } from "../../infra/clock";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { UiTransitService } from "./ui-transit.service";

const LANGS = ["ko", "en", "zh"] as const;
const realGroupsByLang = new Map<string, BusGroup[]>();

let busConfig: FakeBusConfigService;

beforeAll(async () => {
  const realBusConfig = new BusConfigService(new BusStopsService(new SubwayStationsService()), storedBusRegistryService());
  for (const lang of LANGS) realGroupsByLang.set(lang, await realBusConfig.getBusGroups(lang));
});

function withVisibility(visibilityByGroupId: Record<string, BusGroupVisibility>): void {
  for (const lang of LANGS) {
    const groups = realGroupsByLang.get(lang)!.map((group) => ({ ...group, visibility: visibilityByGroupId[group.id] ?? group.visibility }));
    busConfig.busGroupsByLang.set(lang, groups);
  }
}

function serviceAt(iso: string): UiTransitService {
  const clock: Clock = { now: () => new Date(iso) };
  return new UiTransitService(asReal<BusConfigService>(busConfig), new SubwayStationsService(), new MiniappsService(), clock);
}

const itemIdsOf = async (service: UiTransitService, sectionId: string): Promise<string[] | undefined> =>
  (await service.getTransitLayout("ko"))
    .sections.find((section) => section.id === sectionId)
    ?.items.map((served) => served.id);

beforeEach(() => {
  busConfig = new FakeBusConfigService();
  withVisibility({});
  layoutFile = undefined;
});

describe("UiTransitService.getTransitLayout", () => {
  it("serves the launch layout on 2026-10-20 in Korean, version 1, campus, hssc and nsc in order", async () => {
    // Arrange
    const service = serviceAt("2026-10-20T03:00:00Z");

    // Act
    const layout = await service.getTransitLayout("ko");

    // Assert
    expect(layout.version).toBe(1);
    expect(layout.sections.map(({ type, id, title }) => ({ type, id, title }))).toEqual([
      { type: "item_list", id: "campus", title: null },
      { type: "item_list", id: "hssc", title: "인사캠" },
      { type: "item_list", id: "nsc", title: "자과캠" },
    ]);
    expect(layout.sections.map((section) => section.items.map((served) => served.id))).toEqual([
      ["bus:campus"],
      ["subway:hyehwa", "bus:hssc", "bus:jongro02", "bus:jongro07", "bus:jongro08"],
      ["subway:sungkyunkwan", "bus:commute", "group:commute-stations"],
    ]);
  });

  it("serves English titles with the same section and item ids", async () => {
    // Arrange
    const service = serviceAt("2026-10-20T03:00:00Z");

    // Act
    const ko = await service.getTransitLayout("ko");
    const en = await service.getTransitLayout("en");

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
    ["2026-10-12T02:54:59.999Z", ["subway:sungkyunkwan"]],
    ["2026-10-12T02:55:00.000Z", ["subway:sungkyunkwan", "bus:commute", "group:commute-stations"]],
  ])("at %s, around 11:55 KST when the commute card opens, serves nsc as %p", async (iso, itemIds) => {
    // Act & Assert
    expect(await itemIdsOf(serviceAt(iso), "nsc")).toEqual(itemIds);
  });

  it.each([
    ["2026-12-18T14:59:59.999Z", ["subway:sungkyunkwan", "bus:commute", "group:commute-stations"]],
    ["2026-12-18T15:00:00.000Z", ["subway:sungkyunkwan"]],
  ])("at %s, around 00:00 KST on 2026-12-19 after the pilot, serves nsc as %p", async (iso, itemIds) => {
    // Act & Assert
    expect(await itemIdsOf(serviceAt(iso), "nsc")).toEqual(itemIds);
  });

  it("serves fasttrack in the campus section only inside its window", async () => {
    // Arrange
    withVisibility({ fasttrack: { type: "dateRange", from: "2026-10-20", until: "2026-10-21" } });

    // Act
    const before = await itemIdsOf(serviceAt("2026-10-19T14:59:59.999Z"), "campus");
    const during = await itemIdsOf(serviceAt("2026-10-19T15:00:00.000Z"), "campus");

    // Assert
    expect(before).toEqual(["bus:campus"]);
    expect(during).toEqual(["bus:campus", "bus:fasttrack"]);
  });

  it("does not serve a section whose every item is hidden", async () => {
    // Arrange
    const past: BusGroupVisibility = { type: "dateRange", from: "2026-03-01", until: "2026-03-07" };
    withVisibility({ campus: past, fasttrack: past });

    // Act
    const layout = await serviceAt("2026-10-20T03:00:00Z").getTransitLayout("ko");

    // Assert
    expect(layout.sections.map((section) => section.id)).toEqual(["hssc", "nsc"]);
  });

  it("refuses to build over a bus group the layout does not place", async () => {
    // Arrange
    const groups = realGroupsByLang.get("ko")!;
    busConfig.busGroupsByLang.set("ko", [...groups, { ...groups[0]!, id: "night" }]);

    // Act & Assert
    expect(() => serviceAt("2026-10-20T03:00:00Z")).toThrow('transit layout: sections: bus group "night" is not placed');
  });
});

describe("UiTransitService.getTransitLayout with a group", () => {
  const ICON = { type: "subway", color: "8B95A1", text: { ko: "환승", en: "Transfer" } };

  function commuteStations(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    // WHY: hyehwa stands in for the commute stations, so these layouts hold one group child whatever the registry serves.
    const items = [{ kind: "subway", stationId: "hyehwa" }];
    const visibleWith = { kind: "bus", groupId: "commute" };
    return { kind: "group", id: "commute-stations", title: { ko: "통학버스 정류장 지하철" }, icon: ICON, initialState: "collapsed", visibleWith, items, ...overrides };
  }

  function grouped(nscGroup: Record<string, unknown>, campusItems: unknown[] = [{ kind: "bus", groupId: "campus" }, { kind: "bus", groupId: "fasttrack" }]): unknown {
    const buses = ["hssc", "jongro02", "jongro07", "jongro08"].map((groupId) => ({ kind: "bus", groupId }));
    const otherStations = new SubwayStationsService()
      .listStations()
      .flatMap(({ id }) => (id === "sungkyunkwan" || id === "hyehwa" ? [] : [{ kind: "subway", stationId: id }]));
    const hssc = [...buses, ...otherStations];
    const nsc = [{ kind: "subway", stationId: "sungkyunkwan" }, { kind: "bus", groupId: "commute" }, nscGroup];
    return {
      version: 1,
      sections: [
        { type: "item_list", id: "campus", items: campusItems },
        { type: "item_list", id: "hssc", items: hssc },
        { type: "item_list", id: "nsc", items: nsc },
      ],
    };
  }

  const servedNsc = async (iso: string): Promise<Array<Record<string, unknown>> | undefined> =>
    (await serviceAt(iso).getTransitLayout("ko")).sections.find((section) => section.id === "nsc")?.items;

  it("serves the group after the commute row during the pilot, collapsed, with its children and no visibleWith", async () => {
    // Arrange
    layoutFile = grouped(commuteStations());

    // Act
    const nsc = await servedNsc("2026-10-20T00:00:00Z");

    // Assert
    expect(nsc?.map((served) => served.id)).toEqual(["subway:sungkyunkwan", "bus:commute", "group:commute-stations"]);
    expect(nsc?.[2]).toEqual({
      kind: "group",
      id: "group:commute-stations",
      title: "통학버스 정류장 지하철",
      subtitle: null,
      icon: { type: "subway", color: "8B95A1", text: "환승" },
      initialState: "collapsed",
      items: [expect.objectContaining({ id: "subway:hyehwa", title: "혜화역" })],
    });
  });

  it.each([
    ["Before the commute card opens", "2026-10-12T02:54:59.999Z", ["subway:sungkyunkwan"]],
    ["When the commute card opens", "2026-10-12T02:55:00.000Z", ["subway:sungkyunkwan", "bus:commute", "group:commute-stations"]],
    ["On the pilot's last day", "2026-12-18T14:59:59.999Z", ["subway:sungkyunkwan", "bus:commute", "group:commute-stations"]],
    ["Commute pilot over", "2026-12-18T15:00:00.000Z", ["subway:sungkyunkwan"]],
  ])("%s (%s): serves nsc as %p, and no item carries visibleWith", async (_label, iso, itemIds) => {
    // Arrange
    layoutFile = grouped(commuteStations());

    // Act
    const nsc = await servedNsc(iso);

    // Assert
    expect(nsc?.map((served) => served.id)).toEqual(itemIds);
    expect(JSON.stringify(nsc)).not.toContain("visibleWith");
  });

  it("Initial state served as written: serves an expanded group as expanded", async () => {
    // Arrange
    layoutFile = grouped(commuteStations({ initialState: "expanded" }));

    // Act
    const nsc = await servedNsc("2026-10-20T00:00:00Z");

    // Assert
    expect(nsc?.[2]).toMatchObject({ id: "group:commute-stations", initialState: "expanded" });
  });

  it("Group emptied: leaves out a group whose bus children are all hidden, and keeps its section for the rest", async () => {
    // Arrange
    const past = { type: "dateRange", from: "2026-03-01", until: "2026-03-07" } as const;
    withVisibility({ campus: past, fasttrack: past });
    const shuttles = { ...commuteStations({ id: "shuttles", visibleWith: undefined }), items: [{ kind: "bus", groupId: "campus" }, { kind: "bus", groupId: "fasttrack" }] };
    const campusLink = { kind: "link", id: "taxi-share", title: { ko: "택시 합승" }, icon: ICON, actionType: "miniapp", actionValue: "inja" };
    layoutFile = grouped(commuteStations(), [campusLink, shuttles]);

    // Act
    const layout = await serviceAt("2026-10-20T00:00:00Z").getTransitLayout("ko");

    // Assert
    expect(layout.sections.find((section) => section.id === "campus")?.items.map((served) => served.id)).toEqual(["taxi-share"]);
  });

  it("drops a section whose only item is an emptied group", async () => {
    // Arrange
    const past = { type: "dateRange", from: "2026-03-01", until: "2026-03-07" } as const;
    withVisibility({ campus: past, fasttrack: past });
    const shuttles = { ...commuteStations({ id: "shuttles", visibleWith: undefined }), items: [{ kind: "bus", groupId: "campus" }, { kind: "bus", groupId: "fasttrack" }] };
    layoutFile = grouped(commuteStations(), [shuttles]);

    // Act
    const layout = await serviceAt("2026-10-20T00:00:00Z").getTransitLayout("ko");

    // Assert
    expect(layout.sections.map((section) => section.id)).toEqual(["hssc", "nsc"]);
  });

  it("refuses to build over a group whose visibleWith names a bus group placed in another section", () => {
    // Arrange
    layoutFile = grouped(commuteStations({ visibleWith: { kind: "bus", groupId: "campus" } }));

    // Act & Assert
    expect(() => serviceAt("2026-10-20T00:00:00Z")).toThrow('bus group "campus" is not placed in section "nsc"');
  });
});
