/**
 * UiTransitTabService, over UiTransitService on an in-memory dataset store seeded with revision 1 of
 * the `transit-layout` dataset (fixtures/transit-layout.dataset.json), the
 * real bus groups (through a fake BusConfigService that can move a group's
 * visibility), the real served stations and a fixed Clock. What it guards: a
 * bus item shows only while its group is visible in KST (the commute
 * shuttle's card opens at 11:55 KST on 2026-10-12 and closes after
 * 2026-12-18), subway items always show, a section left with no item is not
 * served, and the text follows the request language. Layouts with a group are
 * stored as other revisions: a group shows only while its `visibleWith` bus
 * group does, never serves `visibleWith`, loses its hidden bus children, is
 * not served when none is left, and keeps its initial state.
 *
 * The layout is read through createDatasetLoader (ADR 0013, D6;
 * move-editorial-datasets D5): a push serves after DATASET_CACHE_TTL_MS, a
 * never-read layout answers 503, and each load is checked against the bus
 * groups and stations the server serves. An item naming one it does not
 * serve is left out, and a served one the layout does not place is not
 * served; each is logged once per revision, and neither throws.
 *
 * Revision 1 holds no `miniapp` link, so the tab reads no mini app registry: a
 * replica that has never read it, while it cannot be read, serves the tab
 * (move-miniapp-registry D4, spec "Transit tab with no mini app link").
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake
 * system time; the mapper's clock stays the injected one.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import fs from "fs";
import path from "path";
import { FakeBusConfigService } from "../../../../__tests__/helpers/fakes/bus/bus-config.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { FakeUiTransitRepository } from "../../../../__tests__/helpers/fakes/ui/ui-transit.repository.fake";
import { storedBusRegistryService } from "../../../../__tests__/helpers/bus/bus-registry";
import { storedRouteAttributesService } from "../../../../__tests__/helpers/bus/route-attributes";
import { BusConfigService } from "../../../bus/config/bus-config.service";
import type { BusGroupVisibility } from "../../../bus/config/bus-config.types";
import type { BusGroup } from "../../../bus/config/bus-config.wire";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import type { Clock } from "../../../infra/clock";
import logger from "../../../infra/logger";
import { FakeMiniappsRepository } from "../../../../__tests__/helpers/fakes/miniapps/miniapps.repository.fake";
import { fixtureMiniappsService, miniappsServiceOver } from "../../../../__tests__/helpers/miniapps/registry-fixture";
import { DATASET_CACHE_TTL_MS } from "../../../shared/dataset.constants";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import type { UiTransitRepository } from "../ui-transit.repository";
import { UiTransitService } from "../ui-transit.service";
import { UiTransitTabService } from "./ui-transit-tab.service";

const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) =>
  mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

// Revision 1 of the transit-layout dataset, as stored on 2026-10-19.
function fixtureLayout(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../__tests__/nest/ui/fixtures/transit-layout.dataset.json"), "utf8")) as Record<string, unknown>;
  delete fixture._about;
  return fixture;
}

const LANGS = ["ko", "en", "zh"] as const;
const realGroupsByLang = new Map<string, BusGroup[]>();

let busConfig: FakeBusConfigService;
let repository: FakeUiTransitRepository;

beforeAll(async () => {
  const realBusConfig = new BusConfigService(storedBusStopsService(), storedBusRegistryService(), storedRouteAttributesService());
  for (const lang of LANGS) realGroupsByLang.set(lang, await realBusConfig.getBusGroups(lang));
});

function withVisibility(visibilityByGroupId: Record<string, BusGroupVisibility>): void {
  for (const lang of LANGS) {
    const groups = realGroupsByLang.get(lang)!.map((group) => ({ ...group, visibility: visibilityByGroupId[group.id] ?? group.visibility }));
    busConfig.busGroupsByLang.set(lang, groups);
  }
}

function serviceAt(iso: string): UiTransitTabService {
  const clock: Clock = { now: () => new Date(iso) };
  const layouts = new UiTransitService(asReal<UiTransitRepository>(repository), fixtureMiniappsService(), clock);
  return new UiTransitTabService(layouts, asReal<BusConfigService>(busConfig), new SubwayStationsService(), clock);
}

const itemIdsOf = async (service: UiTransitTabService, sectionId: string): Promise<string[] | undefined> =>
  (await service.getTransitLayout("ko"))
    .sections.find((section) => section.id === sectionId)
    ?.items.map((served) => served.id);

beforeEach(() => {
  jest.clearAllMocks();
  busConfig = new FakeBusConfigService();
  withVisibility({});
  repository = new FakeUiTransitRepository();
  repository.storeTransitLayout(fixtureLayout());
});

afterEach(() => {
  jest.useRealTimers();
});

describe("UiTransitTabService.getTransitLayout", () => {
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

  it("Deploy adds a group before the layout places it: serves no bus:night, and logs it unplaced once per revision", async () => {
    // Arrange
    jest.useFakeTimers({ now: new Date("2026-10-20T03:00:00Z") });
    for (const lang of LANGS) {
      const groups = realGroupsByLang.get(lang)!;
      busConfig.busGroupsByLang.set(lang, [...groups, { ...groups[0]!, id: "night" }]);
    }
    const service = serviceAt("2026-10-20T03:00:00Z");

    // Act
    const layout = await service.getTransitLayout("ko");
    jest.setSystemTime(new Date("2026-10-20T03:00:00Z").getTime() + DATASET_CACHE_TTL_MS);
    await service.getTransitLayout("ko");

    // Assert
    expect(JSON.stringify(layout)).not.toContain("bus:night");
    expect(layout.sections.map((section) => section.items.map((served) => served.id))).toEqual([
      ["bus:campus"],
      ["subway:hyehwa", "bus:hssc", "bus:jongro02", "bus:jongro07", "bus:jongro08"],
      ["subway:sungkyunkwan", "bus:commute", "group:commute-stations"],
    ]);
    expect(repository.readCount).toBe(2);
    expect(callsOf("error", "ui.transit_layout.unplaced")).toEqual([expect.objectContaining({ revision: 1, reason: 'bus group "night" is not placed' })]);
  });
});

describe("UiTransitTabService.getTransitLayout with a group", () => {
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
    repository.storeTransitLayout(grouped(commuteStations()));

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
    repository.storeTransitLayout(grouped(commuteStations()));

    // Act
    const nsc = await servedNsc(iso);

    // Assert
    expect(nsc?.map((served) => served.id)).toEqual(itemIds);
    expect(JSON.stringify(nsc)).not.toContain("visibleWith");
  });

  it("Initial state served as written: serves an expanded group as expanded", async () => {
    // Arrange
    repository.storeTransitLayout(grouped(commuteStations({ initialState: "expanded" })));

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
    repository.storeTransitLayout(grouped(commuteStations(), [campusLink, shuttles]));

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
    repository.storeTransitLayout(grouped(commuteStations(), [shuttles]));

    // Act
    const layout = await serviceAt("2026-10-20T00:00:00Z").getTransitLayout("ko");

    // Assert
    expect(layout.sections.map((section) => section.id)).toEqual(["hssc", "nsc"]);
  });

  it("leaves out a group whose visibleWith names a bus group placed in another section, logging it", async () => {
    // Arrange
    repository.storeTransitLayout(grouped(commuteStations({ visibleWith: { kind: "bus", groupId: "campus" } })));

    // Act
    const nsc = await servedNsc("2026-10-20T00:00:00Z");

    // Assert
    expect(nsc?.map((served) => served.id)).toEqual(["subway:sungkyunkwan", "bus:commute"]);
    expect(callsOf("error", "ui.transit_layout.item_left_out")).toEqual([
      expect.objectContaining({ revision: 2, path: "sections.2.items.2.visibleWith.groupId", reason: 'bus group "campus" is not placed in section "nsc"' }),
    ]);
  });
});

describe("UiTransitTabService.getTransitLayout over the stored dataset", () => {
  const NOW = new Date("2026-10-20T03:00:00Z");

  type Section = { id: string; items: Array<Record<string, unknown>> };
  const storedLayout = () => fixtureLayout() as { version: number; sections: Section[] };
  const idsOf = async (service: UiTransitTabService) => (await service.getTransitLayout("ko")).sections.map((section) => [section.id, section.items.map((served) => served.id)]);

  it("serves a pushed revision once the TTL has passed, and not before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const service = serviceAt(NOW.toISOString());
    await service.getTransitLayout("ko");
    const reordered = storedLayout();
    reordered.sections = [reordered.sections[1]!, reordered.sections[0]!, reordered.sections[2]!];
    repository.storeTransitLayout(reordered);

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await idsOf(service);
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await idsOf(service);

    // Assert
    expect(beforeTtl.map(([id]) => id)).toEqual(["campus", "hssc", "nsc"]);
    expect(atTtl.map(([id]) => id)).toEqual(["hssc", "campus", "nsc"]);
  });

  it("Layout pushed ahead of a deploy: leaves out an item naming a group the server does not serve, logging it once per revision", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const ahead = storedLayout();
    ahead.sections[1]!.items.push({ kind: "bus", groupId: "night" });
    repository.storeTransitLayout(ahead);
    const service = serviceAt(NOW.toISOString());

    // Act
    const served = await idsOf(service);
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    await service.getTransitLayout("ko");

    // Assert
    expect(served[1]).toEqual(["hssc", ["subway:hyehwa", "bus:hssc", "bus:jongro02", "bus:jongro07", "bus:jongro08"]]);
    expect(repository.readCount).toBe(2);
    expect(callsOf("error", "ui.transit_layout.item_left_out")).toEqual([
      expect.objectContaining({ revision: 2, path: "sections.1.items.5.groupId", reason: '"night" is not a bus group' }),
    ]);
  });

  it("Station removed by a deploy: leaves out a station the server does not serve, inside a group too, never throwing", async () => {
    // Arrange
    const removed = storedLayout();
    removed.sections[1]!.items.unshift({ kind: "subway", stationId: "seoul" });
    const group = removed.sections[2]!.items[2] as { items: Array<Record<string, unknown>> };
    group.items.unshift({ kind: "subway", stationId: "suwon" });
    repository.storeTransitLayout(removed);

    // Act
    const layout = await serviceAt(NOW.toISOString()).getTransitLayout("ko");

    // Assert
    expect(JSON.stringify(layout)).not.toMatch(/subway:seoul|subway:suwon/);
    expect(layout.sections[1]?.items[0]).toMatchObject({ id: "subway:hyehwa" });
    expect(callsOf("error", "ui.transit_layout.item_left_out").map((fields) => fields.path)).toEqual([
      "sections.1.items.0.stationId",
      "sections.2.items.2.items.0.stationId",
    ]);
  });

  it("leaves out a section emptied by left-out items", async () => {
    // Arrange
    const emptied = storedLayout();
    emptied.sections.push({ type: "item_list", id: "night", items: [{ kind: "bus", groupId: "night" }] } as unknown as Section);
    repository.storeTransitLayout(emptied);

    // Act
    const served = await idsOf(serviceAt(NOW.toISOString()));

    // Assert
    expect(served.map(([id]) => id)).toEqual(["campus", "hssc", "nsc"]);
  });

  it("answers TRANSIT_LAYOUT_UNAVAILABLE (503) on a first read that finds nothing", async () => {
    // Arrange
    repository = new FakeUiTransitRepository();

    // Act & Assert
    await expect(serviceAt(NOW.toISOString()).getTransitLayout("ko")).rejects.toMatchObject({ code: "TRANSIT_LAYOUT_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers TRANSIT_LAYOUT_UNAVAILABLE (503) on a first read that fails, logging the failure", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    repository.failWith = failure;

    // Act & Assert
    await expect(serviceAt(NOW.toISOString()).getTransitLayout("ko")).rejects.toMatchObject({ code: "TRANSIT_LAYOUT_UNAVAILABLE", httpStatus: 503 });
    expect(callsOf("error", "ui.transit_layout.read_failed")).toEqual([expect.objectContaining({ err: failure })]);
  });

  it("keeps serving the good revision when the next one fails its schema", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const service = serviceAt(NOW.toISOString());
    const good = await service.getTransitLayout("ko");
    repository.storeTransitLayout({ ...storedLayout(), extra: 1 });

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const served = await service.getTransitLayout("ko");

    // Assert
    expect(served).toEqual(good);
  });
});

describe("UiTransitTabService.getTransitLayout with the registry unavailable", () => {
  it("serves revision 1, which has no miniapp link, from a replica that has never read the registry", async () => {
    // Arrange
    const clock: Clock = { now: () => new Date("2026-10-20T03:00:00Z") };
    const unreachable = new FakeMiniappsRepository();
    unreachable.failWith = new Error("server selection timed out");
    const layouts = new UiTransitService(asReal<UiTransitRepository>(repository), miniappsServiceOver(unreachable, clock), clock);
    const service = new UiTransitTabService(layouts, asReal<BusConfigService>(busConfig), new SubwayStationsService(), clock);

    // Act
    const tab = await service.getTransitLayout("ko");

    // Assert
    expect(tab).toEqual(await serviceAt("2026-10-20T03:00:00Z").getTransitLayout("ko"));
    expect(tab.sections.length).toBeGreaterThan(0);
    expect(unreachable.readCount).toBe(0);
  });
});
