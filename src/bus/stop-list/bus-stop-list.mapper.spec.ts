/**
 * A located stop of the index as the stop list serves it: a TOPIS pole named by its stored Korean name in every
 * language with its ARS number, a catalog stop by the names its config record serves, missing coordinates, aliases
 * and campus as null, a realtime line's station as a live route with its label in every language and where it heads,
 * and a shuttle sequence stop as a timetable route with its action and no towards. A live route heads and boards as
 * the stop page's entry does in each language: a Jongno station towards its next station's Korean name, an HSSC
 * station towards the next stop as its catalog stop is named, and alight at a drop-off-only HSSC station.
 */
import type { HsscLineStation } from "../stops/bus-stops.document";
import type { ScheduleStop } from "../stops/bus-stops.types";
import type { LocatedStop } from "../stop-index/bus-stop-index.types";
import { toListedStop } from "./bus-stop-list.mapper";

const hsscStation = (name: string, stopId: string | null, isAlightOnly?: boolean): HsscLineStation => ({
  stopId,
  name,
  isFirstStation: false,
  isLastStation: false,
  isRotationStation: false,
  ...(isAlightOnly !== undefined && { isAlightOnly }),
  transferLines: [],
});
const HSSC_LINE = [hsscStation("농구장", "hssc-basketball-court"), hsscStation("혜화동로터리 [미정차]", null), hsscStation("혜화동우체국 [하차전용]", "hssc-hyehwa-post-office", true)];
const CATALOG_STOPS: ScheduleStop[] = [
  { id: "hssc-basketball-court", name: { ko: "농구장", en: "Basketball Court" } },
  { id: "hssc-hyehwa-post-office", name: { ko: "혜화동우체국", en: "Hyehwa Postoffice", zh: "惠化洞邮局" } },
];
const LINE = { hsscLine: HSSC_LINE, catalogStops: CATALOG_STOPS };
const sameInEvery = (text: string) => ({ ko: text, en: text, zh: text });

describe("toListedStop", () => {
  it("serves a TOPIS pole by its stored Korean name in every language, its ARS number, 인사캠 and a live route per Jongno route", () => {
    // Arrange
    const stop: LocatedStop = {
      id: "seoul-01592",
      localStop: null,
      poles: [{ arsId: "01592", topisId: "100900075", stationName: "혜화역1번출구" }],
      routes: [
        { kind: "jongro", groupId: "jongro07", stationIndex: 16, towards: "혜화동로터리", stationsVersion: "v7" },
        { kind: "jongro", groupId: "jongro08", stationIndex: 22, towards: null, stationsVersion: "v8" },
      ],
      coords: { lat: 37.58, lng: 127.0 },
    };

    // Act
    const listed = toListedStop(stop, null, LINE);

    // Assert
    expect(listed).toEqual({
      id: "seoul-01592",
      name: { ko: "혜화역1번출구", en: "혜화역1번출구", zh: "혜화역1번출구" },
      coords: { lat: 37.58, lng: 127.0 },
      arsIds: ["01592"],
      campus: "hssc",
      routes: [
        { kind: "live", groupId: "jongro07", label: { ko: "종로 07", en: "Jongro 07", zh: "钟路 07" }, stationIndex: 16, towards: sameInEvery("혜화동로터리"), action: "board" },
        { kind: "live", groupId: "jongro08", label: { ko: "종로 08", en: "Jongro 08", zh: "钟路 08" }, stationIndex: 22, towards: null, action: "board" },
      ],
    });
  });

  it("serves a catalog stop without coordinates, aliases or campus with those as null, heading its HSSC station past the rotary to the next stop's catalog names", () => {
    // Arrange
    const stop: LocatedStop = {
      id: "hssc-basketball-court",
      localStop: { id: "hssc-basketball-court", name: { ko: "농구장", en: "Basketball Court" } },
      poles: [],
      routes: [{ kind: "hssc", groupId: "hssc", stationIndex: 0 }],
      coords: null,
    };
    const names = { ko: "농구장", en: "Basketball Court", zh: "Basketball Court" };

    // Act
    const listed = toListedStop(stop, names, LINE);

    // Assert
    expect(listed).toEqual({
      id: "hssc-basketball-court",
      name: names,
      coords: null,
      arsIds: null,
      campus: null,
      routes: [
        {
          kind: "live",
          groupId: "hssc",
          label: { ko: "인사캠 셔틀버스", en: "HSSC Shuttle Bus", zh: "人文校区班车" },
          stationIndex: 0,
          towards: { ko: "혜화동우체국", en: "Hyehwa Postoffice", zh: "惠化洞邮局" },
          action: "board",
        },
      ],
    });
  });

  it("serves a shuttle sequence stop as a timetable route with its action and service label, and a catalog stop's aliases and campus", () => {
    // Arrange
    const stop: LocatedStop = {
      id: "hssc-bus-lot",
      localStop: { id: "hssc-bus-lot", name: { ko: "학생회관 버스 주차장" }, arsIds: ["01618"], campus: "hssc", coords: { lat: 37.587367, lng: 126.993643 } },
      poles: [],
      routes: [{ kind: "shuttle", groupId: "campus", serviceId: "campus-inja", routeType: "regular", sequenceIndex: 0, action: "board" }],
      coords: { lat: 37.587367, lng: 126.993643 },
    };

    // Act
    const listed = toListedStop(stop, sameInEvery("학생회관 버스 주차장"), LINE);

    // Assert
    expect(listed).toMatchObject({ arsIds: ["01618"], campus: "hssc", coords: { lat: 37.587367, lng: 126.993643 } });
    expect(listed.routes).toEqual([
      { kind: "timetable", groupId: "campus", label: { ko: "인사캠 → 자과캠", en: "HSSC → NSC", zh: "人文校区 → 自然校区" }, serviceId: "campus-inja", routeType: "regular", action: "board" },
    ]);
  });

  it("copies a catalog stop's aliases, so the served list is not the frozen index's", () => {
    // Arrange
    const arsIds = Object.freeze(["01618"]) as string[];
    const stop: LocatedStop = { id: "hssc-bus-lot", localStop: { id: "hssc-bus-lot", name: { ko: "학생회관" }, arsIds }, poles: [], routes: [], coords: null };

    // Act
    const listed = toListedStop(stop, sameInEvery("학생회관"), LINE);

    // Assert
    expect(listed.arsIds).toEqual(["01618"]);
    expect(listed.arsIds).not.toBe(arsIds);
  });

  it("serves a drop-off-only HSSC station as alight, heading round the loop with the line's last stop names falling back to English", () => {
    // Arrange
    const stop: LocatedStop = {
      id: "hssc-hyehwa-post-office",
      localStop: { id: "hssc-hyehwa-post-office", name: { ko: "혜화동우체국" } },
      poles: [],
      routes: [{ kind: "hssc", groupId: "hssc", stationIndex: 2 }],
      coords: null,
    };

    // Act
    const listed = toListedStop(stop, sameInEvery("혜화동우체국"), LINE);

    // Assert
    expect(listed.routes).toEqual([expect.objectContaining({ kind: "live", stationIndex: 2, towards: { ko: "농구장", en: "Basketball Court", zh: "Basketball Court" }, action: "alight" })]);
  });
});
