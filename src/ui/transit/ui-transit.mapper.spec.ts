/**
 * toTransitSection resolves one checked section for a request: a bus item
 * takes its group's label, card and screen, a subway item its station's
 * title, line label and line color, and a link item its own text in the
 * request language and its served action. Every kind carries the same
 * display fields and an action, never a live arrival, and a bus item whose
 * group is not among the visible ones is left out.
 */
import type { BusGroup } from "../../bus/config/bus-config.wire";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
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
  id: "S1-4-420",
  title: { ko: "혜화역", en: "Hyehwa Station", zh: "惠化站" },
  lineCode: "4",
  lineLabel: { ko: "4호선", en: "Line 4", zh: "4号线" },
  lineColor: "00A5DE",
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
  return toTransitSection(raw, { lang, busGroupById, stationById: new Map([[HYEHWA.id, HYEHWA]]) });
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

  it("serves Hyehwa in Korean with its suffixed title, line label and line color", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "S1-4-420" }));

    // Assert
    expect(resolved.items).toEqual([
      {
        kind: "subway",
        id: "subway:S1-4-420",
        stationId: "S1-4-420",
        title: "혜화역",
        subtitle: "4호선",
        icon: { type: "subway", color: "00A5DE", text: "4" },
        action: { actionType: "route", actionValue: "/subway?station=S1-4-420" },
      },
    ]);
    expect(parsesAsWire(resolved)).toBe(true);
  });

  it("serves Hyehwa in English", () => {
    // Act
    const resolved = resolve(section({ kind: "subway", stationId: "S1-4-420" }), "en");

    // Assert
    expect(resolved.items[0]).toMatchObject({ title: "Hyehwa Station", subtitle: "Line 4" });
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

  it("leaves out a bus item whose group is not visible, and keeps the others in order", () => {
    // Act
    const resolved = resolve(section({ kind: "bus", groupId: "commute" }, LINK, { kind: "subway", stationId: "S1-4-420" }));

    // Assert
    expect(resolved.items.map((served) => served.id)).toEqual(["taxi-share", "subway:S1-4-420"]);
  });
});
