/**
 * toTransitSection resolves one checked section for a request: a bus item
 * takes its group's label, card and screen, a subway item its physical
 * station's title, a null subtitle (its markers name its lines) and each
 * line's code, name, color and marker (in place of an icon), and a link item
 * its own text in the request language and its served action. Every kind carries a
 * title, a subtitle and an action, never a live arrival, and a bus item whose
 * group is not among the visible ones is left out. A group item serves its own
 * text, icon and initial state, and its children exactly as at the top of a
 * section, with no action and never its `visibleWith`; it is left out while
 * its `visibleWith` bus group is not visible, and when no child is left.
 */
import type { BusGroup } from "../../../bus/config/bus-config.wire";
import { WEBVIEW_ORIGIN } from "../../../infra/origins";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import type { ServedStation } from "../../../subway/stations/subway-stations.types";
import { toTransitSection } from "./ui-transit-tab.mapper";
import type { TransitLayoutRaw } from "../ui-transit.schema";
import { transitLayout } from "../ui-transit.wire";

type SectionRaw = TransitLayoutRaw["sections"][number];
type ItemRaw = SectionRaw["items"][number];

function group(overrides: Partial<BusGroup> = {}): BusGroup {
  return {
    id: "hssc",
    screenType: "realtime",
    label: "인사캠 셔틀버스",
    visibility: { type: "always" },
    card: { themeColor: "003626", iconType: "shuttle", busTypeText: "성대", subtitle: "정차소 ↔ 600주년 기념관" },
    screen: { dataEndpoint: "/bus/realtime/data/hssc", refreshInterval: 10, lastStationIndex: 10, stations: [], features: [] },
    ...overrides,
  };
}

const HYEHWA: ServedStation = {
  id: "hyehwa",
  title: { ko: "혜화역", en: "Hyehwa Station", zh: "惠化站" },
  lines: [{ code: "4", name: { ko: "4호선", en: "Line 4", zh: "4号线" }, color: "00A5DE", marker: { text: { ko: "4", en: "4", zh: "4" }, color: "007FAB" } }],
};

// WHY: hand-written as design D2a and D2b give Jeongja, which the registry serves only once its lines are registered.
const JEONGJA: ServedStation = {
  id: "jeongja",
  title: { ko: "정자역", en: "Jeongja Station", zh: "亭子站" },
  lines: [
    {
      code: "D1",
      name: { ko: "신분당선", en: "Shinbundang Line", zh: "新盆唐线" },
      color: "D4003B",
      marker: { text: { ko: "신", en: "신", zh: "新" }, color: "D4003B" },
    },
    {
      code: "K1",
      name: { ko: "수인분당선", en: "Suin–Bundang Line", zh: "水仁·盆唐线" },
      color: "F5A200",
      marker: { text: { ko: "수", en: "수", zh: "水" }, color: "A26B00" },
    },
  ],
};

const LINK: ItemRaw = {
  kind: "link",
  id: "taxi-share",
  title: { ko: "택시 합승", en: "Taxi share" },
  icon: { type: "taxi", color: "FFB300", text: { ko: "택시", en: "Taxi" } },
  actionType: "webview",
  actionValue: "/skku/taxi",
};

type GroupRaw = Extract<ItemRaw, { kind: "group" }>;

function stationGroup(overrides: Partial<GroupRaw> = {}): GroupRaw {
  return {
    kind: "group",
    id: "commute-stations",
    title: { ko: "통학버스 정류장 지하철", en: "Subway at shuttle stops" },
    subtitle: { ko: "혜화 · 정자", en: "Hyehwa · Jeongja" },
    icon: { type: "subway", color: "8B95A1", text: { ko: "환승", en: "Transfer" } },
    initialState: "collapsed",
    visibleWith: { kind: "bus", groupId: "hssc" },
    items: [{ kind: "subway", stationId: "hyehwa" }, { kind: "subway", stationId: "jeongja" }],
    ...overrides,
  };
}

function section(...items: ItemRaw[]): SectionRaw {
  return { type: "item_list", id: "hssc", title: { ko: "인사캠", en: "HSSC" }, items };
}

function resolve(raw: SectionRaw, lang: "ko" | "en" | "zh" = "ko", groups: BusGroup[] = [group()]) {
  const busGroupById = new Map(groups.map((busGroup) => [busGroup.id, busGroup]));
  return toTransitSection(raw, { lang, busGroupById, stationById: new Map([HYEHWA, JEONGJA].map((station) => [station.id, station])) });
}

const parsesAsWire = (resolved: ReturnType<typeof resolve>): boolean => transitLayout.safeParse({ version: 1, sections: [resolved] }).success;

describe("toTransitSection", () => {
  it("serves a realtime group as a bus item opening its realtime screen", () => {
    // Act
    const resolved = resolve(section({ kind: "bus", groupId: "hssc" }));

    // Assert
    expect(resolved).toEqual({
      type: "item_list",
      id: "hssc",
      title: "인사캠",
      items: [
        {
          kind: "bus",
          id: "bus:hssc",
          groupId: "hssc",
          title: "인사캠 셔틀버스",
          subtitle: "정차소 ↔ 600주년 기념관",
          icon: { type: "shuttle", color: "003626", text: "성대" },
          action: { actionType: "route", actionValue: "/bus/realtime?groupId=hssc" },
        },
      ],
    });
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("opens the schedule screen for a schedule group and sends a blank subtitle as null", () => {
    // Arrange
    const campus = group({ id: "campus", screenType: "schedule", label: "인자셔틀", card: { ...group().card, subtitle: "" } });

    // Act
    const resolved = resolve(section({ kind: "bus", groupId: "campus" }), "ko", [campus]);

    // Assert
    expect(resolved.items[0]).toMatchObject({
      id: "bus:campus",
      subtitle: null,
      action: { actionType: "route", actionValue: "/bus/schedule?groupId=campus" },
    });
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("Hyehwa in Korean: serves its suffixed title, a null subtitle and its line, with no icon", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "hyehwa" }));

    // Assert
    expect(resolved.items).toEqual([
      {
        kind: "subway",
        id: "subway:hyehwa",
        stationId: "hyehwa",
        title: "혜화역",
        subtitle: null,
        lines: [{ code: "4", name: "4호선", color: "00A5DE", marker: { text: "4", color: "007FAB" } }],
        action: { actionType: "route", actionValue: "/subway?station=hyehwa" },
      },
    ]);
    expect(resolved.items[0]).not.toHaveProperty("icon");
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("Transfer station: serves 정자 with both lines in order and a null subtitle", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "jeongja" }));

    // Assert
    expect(resolved.items[0]).toMatchObject({
      title: "정자역",
      subtitle: null,
      lines: [
        { code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } },
        { code: "K1", name: "수인분당선", color: "F5A200", marker: { text: "수", color: "A26B00" } },
      ],
    });
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("Line names in English: serves each name and marker text in English, codes and colors unchanged, and still no subtitle", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "jeongja" }), "en");

    // Assert
    expect(resolved.items[0]).toMatchObject({
      title: "Jeongja Station",
      subtitle: null,
      lines: [
        { code: "D1", name: "Shinbundang Line", color: "D4003B", marker: { text: "신", color: "D4003B" } },
        { code: "K1", name: "Suin–Bundang Line", color: "F5A200", marker: { text: "수", color: "A26B00" } },
      ],
    });
  });

  it.each(["ko", "en", "zh"] as const)("serves every registered station with a null subtitle in %s, beside a bus item that keeps its card's", (lang) => {
    // Arrange
    const stations = new SubwayStationsService().listStations();
    const stationById = new Map(stations.map((station) => [station.id, station]));
    const items: ItemRaw[] = [{ kind: "bus", groupId: "hssc" }, ...stations.map((station) => ({ kind: "subway" as const, stationId: station.id }))];

    // Act
    const resolved = toTransitSection(section(...items), { lang, busGroupById: new Map([["hssc", group()]]), stationById });

    // Assert
    expect(resolved.items.map((item) => [item.kind, item.subtitle])).toEqual([["bus", "정차소 ↔ 600주년 기념관"], ...stations.map(() => ["subway", null])]);
  });

  it("serves each registered station's lines as SubwayStationsService lists them, in the request language", () => {
    // Arrange
    const stations = new SubwayStationsService().listStations();
    const stationById = new Map(stations.map((station) => [station.id, station]));
    const items = stations.map((station) => ({ kind: "subway" as const, stationId: station.id }));

    // Act
    const resolved = toTransitSection(section(...items), { lang: "zh", busGroupById: new Map(), stationById });

    // Assert
    const served = resolved.items.map((item) => (item.kind === "subway" ? item.lines : []));
    expect(served).toEqual(stations.map((station) => station.lines.map((line) => ({ ...line, name: line.name.zh, marker: { ...line.marker, text: line.marker.text.zh } }))));
  });

  it("serves a link in the request language, with no subtitle as null and a web view path on the web view origin", () => {
    // Act
    const resolved = resolve(section(LINK), "en");

    // Assert
    expect(resolved).toEqual({
      type: "item_list",
      id: "hssc",
      title: "HSSC",
      items: [
        {
          kind: "link",
          id: "taxi-share",
          title: "Taxi share",
          subtitle: null,
          icon: { type: "taxi", color: "FFB300", text: "Taxi" },
          action: { actionType: "webview", actionValue: `${WEBVIEW_ORIGIN}/skku/taxi` },
        },
      ],
    });
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("serves a link's subtitle in the request language, falling back to ko", () => {
    // Arrange
    const withSubtitle: ItemRaw = { ...LINK, subtitle: { ko: "인사캠 ↔ 자과캠" } };

    // Act
    const resolved = resolve(section(withSubtitle), "zh");

    // Assert
    expect(resolved.items[0]).toMatchObject({ title: "Taxi share", subtitle: "인사캠 ↔ 자과캠" });
  });

  it("serves a section placed without a title with a null title", () => {
    // Arrange
    const untitled: SectionRaw = { type: "item_list", id: "campus", items: [LINK] };

    // Act
    const resolved = resolve(untitled);

    // Assert
    expect(resolved.title).toBeNull();
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("leaves out a bus item whose group is not visible, and keeps the others in order", () => {
    // Act
    const resolved = resolve(section({ kind: "bus", groupId: "commute" }, LINK, { kind: "subway", stationId: "hyehwa" }));

    // Assert
    expect(resolved.items.map((served) => served.id)).toEqual(["taxi-share", "subway:hyehwa"]);
  });

  it("serves a group in the request language with its children as at the top of a section, and no action or visibleWith", () => {
    // Arrange
    const children: ItemRaw[] = [{ kind: "subway", stationId: "hyehwa" }, { kind: "bus", groupId: "hssc" }, LINK];
    const topLevel = resolve(section(...children), "en").items;

    // Act
    const resolved = resolve(section(stationGroup({ items: children as GroupRaw["items"] })), "en");

    // Assert
    expect(resolved.items).toEqual([
      {
        kind: "group",
        id: "group:commute-stations",
        title: "Subway at shuttle stops",
        subtitle: "Hyehwa · Jeongja",
        icon: { type: "subway", color: "8B95A1", text: "Transfer" },
        initialState: "collapsed",
        items: topLevel,
      },
    ]);
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("Initial state served as written: serves expanded, and a group with no subtitle with a null subtitle", () => {
    // Act
    const resolved = resolve(section(stationGroup({ initialState: "expanded", subtitle: undefined })));

    // Assert
    expect(resolved.items[0]).toMatchObject({ initialState: "expanded", subtitle: null, title: "통학버스 정류장 지하철" });
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("serves a group with no visibleWith whatever bus groups are visible", () => {
    // Act
    const resolved = resolve(section(stationGroup({ visibleWith: undefined })), "ko", []);

    // Assert
    expect(resolved.items.map((served) => served.id)).toEqual(["group:commute-stations"]);
  });

  it("leaves out a group whose visibleWith bus group is not visible, though its children are", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "hyehwa" }, stationGroup({ visibleWith: { kind: "bus", groupId: "commute" }, items: [{ kind: "subway", stationId: "jeongja" }] })));

    // Assert
    expect(resolved.items.map((served) => served.id)).toEqual(["subway:hyehwa"]);
  });

  it("leaves out a hidden bus child and keeps the group's other children in order", () => {
    // Act
    const resolved = resolve(section(stationGroup({ items: [{ kind: "bus", groupId: "commute" }, { kind: "subway", stationId: "jeongja" }, { kind: "bus", groupId: "hssc" }] })));

    // Assert
    expect(resolved.items[0]?.kind === "group" && resolved.items[0].items.map((served) => served.id)).toEqual(["subway:jeongja", "bus:hssc"]);
  });

  it("Group emptied: leaves out a group whose bus children are all hidden", () => {
    // Act
    const resolved = resolve(section(LINK, stationGroup({ visibleWith: undefined, items: [{ kind: "bus", groupId: "commute" }, { kind: "bus", groupId: "fasttrack" }] })));

    // Assert
    expect(resolved.items.map((served) => served.id)).toEqual(["taxi-share"]);
  });

  it("throws on a station inside a group that is not served", () => {
    // Act & Assert
    expect(() => resolve(section(stationGroup({ items: [{ kind: "subway", stationId: "gangnam" }] })))).toThrow(
      'transit layout places subway station "gangnam", which is not served',
    );
  });
});
