/**
 * toTransitSection resolves one checked section for a request: a bus item
 * takes its group's label, card and screen, a subway item its physical
 * station's title, its lines' names joined as its subtitle and each line's
 * code, name, badge and color (in place of an icon), and a link item its own
 * text in the request language and its served action. Every kind carries a
 * title, a subtitle and an action, never a live arrival, and a bus item whose
 * group is not among the visible ones is left out.
 */
import type { BusGroup } from "../../bus/config/bus-config.wire";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import type { ServedStation } from "../../subway/stations/subway-stations.types";
import { toTransitSection } from "./ui-transit.mapper";
import type { TransitLayoutRaw } from "./ui-transit.schema";
import { transitLayout } from "./ui-transit.wire";

type SectionRaw = TransitLayoutRaw["sections"][number];
type ItemRaw = SectionRaw["items"][number];

function group(overrides: Partial<BusGroup> = {}): BusGroup {
  return {
    id: "hssc",
    screenType: "realtime",
    label: "인사캠 셔틀버스",
    visibility: { type: "always" },
    card: { themeColor: "003626", iconType: "shuttle", busTypeText: "성대", subtitle: "정차소 ↔ 600주년 기념관" },
    screen: { dataEndpoint: "/bus/realtime/data/hssc", refreshInterval: 10, lastStationIndex: 10, stations: [], routeOverlay: null, features: [] },
    ...overrides,
  };
}

const HYEHWA: ServedStation = {
  id: "hyehwa",
  title: { ko: "혜화역", en: "Hyehwa Station", zh: "惠化站" },
  lines: [{ code: "4", name: { ko: "4호선", en: "Line 4", zh: "4号线" }, badge: { ko: "4", en: "4", zh: "4" }, color: "00A5DE" }],
};

// WHY: hand-written as design D2a and D2b give Jeongja, which the registry serves only once its lines are registered.
const JEONGJA: ServedStation = {
  id: "jeongja",
  title: { ko: "정자역", en: "Jeongja Station", zh: "亭子站" },
  lines: [
    { code: "D1", name: { ko: "신분당선", en: "Shinbundang Line", zh: "新盆唐线" }, badge: { ko: "신분당", en: "Shinbundang", zh: "新盆唐" }, color: "D4003B" },
    { code: "K1", name: { ko: "수인분당선", en: "Suin–Bundang Line", zh: "水仁·盆唐线" }, badge: { ko: "수인분당", en: "Suin–Bundang", zh: "水仁盆唐" }, color: "F5A200" },
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

  it("Hyehwa in Korean: serves its suffixed title, its line name as subtitle and its line, with no icon", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "hyehwa" }));

    // Assert
    expect(resolved.items).toEqual([
      {
        kind: "subway",
        id: "subway:hyehwa",
        stationId: "hyehwa",
        title: "혜화역",
        subtitle: "4호선",
        lines: [{ code: "4", name: "4호선", badge: "4", color: "00A5DE" }],
        action: { actionType: "route", actionValue: "/subway?station=hyehwa" },
      },
    ]);
    expect(resolved.items[0]).not.toHaveProperty("icon");
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("Transfer station: serves 정자 with both lines in order, their names joined as its subtitle", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "jeongja" }));

    // Assert
    expect(resolved.items[0]).toMatchObject({
      title: "정자역",
      subtitle: "신분당선 · 수인분당선",
      lines: [
        { code: "D1", name: "신분당선", badge: "신분당", color: "D4003B" },
        { code: "K1", name: "수인분당선", badge: "수인분당", color: "F5A200" },
      ],
    });
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("Line names in English: serves the subtitle, each name and badge in English, codes and colors unchanged", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "jeongja" }), "en");

    // Assert
    expect(resolved.items[0]).toMatchObject({
      title: "Jeongja Station",
      subtitle: "Shinbundang Line · Suin–Bundang Line",
      lines: [
        { code: "D1", name: "Shinbundang Line", badge: "Shinbundang", color: "D4003B" },
        { code: "K1", name: "Suin–Bundang Line", badge: "Suin–Bundang", color: "F5A200" },
      ],
    });
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
    expect(served).toEqual(stations.map((station) => station.lines.map((line) => ({ ...line, name: line.name.zh, badge: line.badge.zh }))));
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
});
