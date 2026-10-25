/**
 * What the subway timetable door decides (ADR 0022, D2 and D6; docs/plans/transit-route-planner.md "Producers"):
 * which trains of the service day's tables serve a ride from a board platform to an alight platform, joined within one
 * table by the train's own row and across two tables by train number, so a train that ends before the alight platform,
 * runs the other way or passes the alight platform (an express) is never listed, and a train whose number the alight
 * table does not hold is listed with no alight call; each listed train's board and alight calls carry the timetable's
 * times at those platforms as the subway board serves a timetable train (status scheduled, basis timetable, both
 * scheduled instants, the destination as headsign, run id `<line>/<serviceDate>/<trainNo>`), its first and last flags
 * taken across the trains that serve the ride, a time past midnight on the service day it belongs to; the window from
 * the query's instant to its end, at each edge; the next service; and the push check that a ride's platforms are on
 * its line and that every day type's tables run a train from one to the other.
 */
import { SUBWAY_STATIONS } from "../../subway.constants";
import type { NetworkPlatform } from "../../subway.types";
import { toLineRoutes, toScheduledTrains } from "../subway-timetable.rules";
import type { DayType, PlatformSchedule, Timetable, TimetableTrain } from "../subway-timetable.types";
import { subwayTimetablesFixture } from "../../../../__tests__/helpers/subway/timetables";
import { toLegTrains, toNextServiceDayStart, toRideTimetableIssue, toTimetableDepartureBoard } from "./subway-timetable-departures.rules";

const HYEHWA = "S1-4-420";
const SADANG = "S1-4-433";
const GEUMJEONG_4 = "KR-4-443";
const GEUMJEONG_1 = "KR-1-P149";
const SKKU = "KR-1-P153";
const SERVICE_DATE = "2026-10-20";

const sec = (clock: string): number => {
  const [h = 0, m = 0, s = 0] = clock.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};
const kst = (date: string, clock: string) => new Date(`${date}T${clock}+09:00`);
const at = (station: string, arr: string | null, dep: string | null) => ({ station, arr: arr === null ? null : sec(arr), dep: dep === null ? null : sec(dep) });

function train(trainNo: string, direction: "up" | "down", destination: string, stops: TimetableTrain["stops"], express = false): TimetableTrain {
  return { trainNo, direction, destination, express, stops };
}

function table(operator: string, line: string, stations: string[], trains: TimetableTrain[], dayType: DayType = "weekday"): Timetable {
  return { source: { kind: "synthetic", ref: "spec", revision: "1" }, operator, line, dayType, stations, trains };
}

const platformOf = (id: string): NetworkPlatform => {
  const found = SUBWAY_STATIONS.flatMap((station) => station.platforms).find((platform) => platform.id === id);
  if (!found) throw new Error(`no served platform ${id}`);
  return found;
};

function scheduleOf(timetable: Timetable, platformId: string, serviceDate = SERVICE_DATE): PlatformSchedule {
  return { platform: platformOf(platformId), serviceDate, dayType: timetable.dayType, lineRoutes: toLineRoutes(timetable), trains: toScheduledTrains(timetable, serviceDate) };
}

const LINE4 = table("S1", "4", [HYEHWA, SADANG, GEUMJEONG_4], [
  train("4501", "down", "오이도", [at(HYEHWA, "08:03:00", "08:03:30"), at(SADANG, "08:25:00", "08:25:30"), at(GEUMJEONG_4, "08:56:00", "08:56:30")]),
  train("4503", "down", "사당", [at(HYEHWA, "08:10:00", "08:10:30"), at(SADANG, "08:32:00", null)]),
  train("4502", "up", "당고개", [at(GEUMJEONG_4, null, "08:00:00"), at(SADANG, "08:30:00", "08:30:30"), at(HYEHWA, "08:52:30", "08:53:00")]),
  train("4505", "down", "오이도", [at(HYEHWA, "08:16:00", "08:16:30"), at(SADANG, "08:38:00", "08:38:30"), at(GEUMJEONG_4, "09:09:00", "09:09:30")]),
  train("4597", "down", "오이도", [at(HYEHWA, "23:44:30", "23:45:00"), at(SADANG, "24:07:00", "24:07:30"), at(GEUMJEONG_4, "24:38:00", null)]),
  train("4599", "down", "오이도", [at(HYEHWA, "24:00:30", "24:01:00"), at(SADANG, "24:23:00", "24:23:30"), at(GEUMJEONG_4, "24:54:00", null)]),
  train("4601", "down", "사당", [at(HYEHWA, "24:05:00", "24:05:30"), at(SADANG, "24:27:00", null)]),
]);

const query = (from: Date, until = new Date(from.getTime() + 3 * 3_600_000)) => ({ lineId: "4", boardStopId: HYEHWA, alightStopId: GEUMJEONG_4, from, until, lang: "ko" as const });
const LINE4_RIDE = [scheduleOf(LINE4, HYEHWA), scheduleOf(LINE4, GEUMJEONG_4)] as const;

describe("toLegTrains", () => {
  it("lists the trains that call at the board platform and then at the alight one, by board time", () => {
    // Act
    const legTrains = toLegTrains(scheduleOf(LINE4, HYEHWA), scheduleOf(LINE4, GEUMJEONG_4));

    // Assert
    expect(legTrains.map(({ train: { trainNo }, alightStop }) => [trainNo, alightStop?.arrivalAt ?? null])).toEqual([
      ["4501", kst(SERVICE_DATE, "08:56:00")],
      ["4505", kst(SERVICE_DATE, "09:09:00")],
      ["4597", kst("2026-10-21", "00:38:00")],
      ["4599", kst("2026-10-21", "00:54:00")],
    ]);
  });

  it("Express passing the alight platform: never lists a train whose row leaves that platform out", () => {
    // Arrange
    const line1 = table("KR", "1", [GEUMJEONG_1, "KR-1-P150", SKKU], [
      train("1902", "up", "서울", [at(SKKU, "07:59:00", "08:00:00"), at("KR-1-P150", "08:04:00", "08:04:30")], true),
      train("0410", "up", "청량리", [at(SKKU, "08:01:00", "08:02:00"), at("KR-1-P150", "08:06:00", "08:06:30"), at(GEUMJEONG_1, "08:13:00", "08:13:30")]),
    ]);

    // Act
    const legTrains = toLegTrains(scheduleOf(line1, SKKU), scheduleOf(line1, GEUMJEONG_1));

    // Assert
    expect(legTrains.map((each) => each.train.trainNo)).toEqual(["0410"]);
  });

  it("Unjoined train number: across two tables, lists a train the alight table does not number alike with no alight stop", () => {
    // Arrange
    const boardTable = table("S1", "4", [HYEHWA, SADANG], [
      train("4501", "down", "오이도", [at(HYEHWA, "08:03:00", "08:03:30"), at(SADANG, "08:25:00", "08:25:30")]),
      train("4505", "down", "오이도", [at(HYEHWA, "08:16:00", "08:16:30"), at(SADANG, "08:38:00", "08:38:30")]),
      train("4502", "up", "당고개", [at(SADANG, "08:30:00", "08:30:30"), at(HYEHWA, "08:52:30", "08:53:00")]),
    ]);
    const alightTable = table("KR", "4", [SADANG, GEUMJEONG_4], [
      train("4501", "down", "오이도", [at(SADANG, "08:25:00", "08:25:30"), at(GEUMJEONG_4, "08:56:00", "08:56:30")]),
      train("K4505", "down", "오이도", [at(SADANG, "08:38:00", "08:38:30"), at(GEUMJEONG_4, "09:09:00", "09:09:30")]),
    ]);

    // WHY: as if Geumjeong's line 4 platform were timed from Korail's own table, the source the plan held in reserve, not Seoul's.
    const korailTimed = { ...scheduleOf(alightTable, GEUMJEONG_4), platform: { ...platformOf(GEUMJEONG_4), timetable: { source: "korail" as const } } };

    // Act
    const legTrains = toLegTrains(scheduleOf(boardTable, HYEHWA), korailTimed);

    // Assert
    expect(legTrains.map(({ train: { trainNo }, alightStop }) => [trainNo, alightStop?.arrivalAt ?? null])).toEqual([
      ["4501", kst(SERVICE_DATE, "08:56:00")],
      ["4505", null],
    ]);
  });
});

describe("toTimetableDepartureBoard", () => {
  it("serves each train's board and alight calls as the subway board serves a timetable train", () => {
    // Act
    const board = toTimetableDepartureBoard(...LINE4_RIDE, query(kst(SERVICE_DATE, "08:00:00")));

    // Assert
    const [first] = board.departures;
    expect(first).toEqual({
      lineId: "4",
      board: {
        ...{ status: "scheduled", expectedArrivalAt: null, expectedDepartureAt: null },
        ...{ scheduledArrivalAt: kst(SERVICE_DATE, "08:03:00"), scheduledDepartureAt: kst(SERVICE_DATE, "08:03:30"), basis: "timetable" },
        ...{ stopsAway: null, runId: "4/2026-10-20/4501", vehicleId: null, headsign: "오이도" },
        ...{ isFirstRun: true, isLastRun: false, isExpress: false, providerText: null },
      },
      alight: expect.objectContaining({ scheduledArrivalAt: kst(SERVICE_DATE, "08:56:00"), scheduledDepartureAt: kst(SERVICE_DATE, "08:56:30"), runId: "4/2026-10-20/4501", basis: "timetable" }),
      observedAt: null,
    });
    expect(board.vehicles).toEqual({});
    expect(board.continuation).toEqual({ kind: "listed" });
  });

  it.each([
    ["one second before its board time", "08:03:29", ["4501", "4505"]],
    ["at its board time", "08:03:30", ["4501", "4505"]],
    ["one second after it", "08:03:31", ["4505"]],
  ])("lists a train from the query's instant %s", (_case, clock, trainNos) => {
    // Act
    const board = toTimetableDepartureBoard(...LINE4_RIDE, query(kst(SERVICE_DATE, clock), kst(SERVICE_DATE, "09:00:00")));

    // Assert
    expect(board.departures.map((departure) => departure.board.runId?.split("/")[2])).toEqual(trainNos);
  });

  it.each([
    ["one second before the window's end", "08:16:29", ["4501"], kst(SERVICE_DATE, "08:16:30")],
    ["at the window's end", "08:16:30", ["4501", "4505"], kst(SERVICE_DATE, "23:45:00")],
    ["one second after it", "08:16:31", ["4501", "4505"], kst(SERVICE_DATE, "23:45:00")],
  ])("lists a train %s, and names the next one after the window", (_case, clock, trainNos, nextServiceAt) => {
    // Act
    const board = toTimetableDepartureBoard(...LINE4_RIDE, query(kst(SERVICE_DATE, "08:00:00"), kst(SERVICE_DATE, clock)));

    // Assert
    expect(board.departures.map((departure) => departure.board.runId?.split("/")[2])).toEqual(trainNos);
    expect(board.nextServiceAt).toEqual(nextServiceAt);
  });

  it("Last train: flags the last train that reaches the alight platform, though a later one leaves the board platform for 사당", () => {
    // Act
    const board = toTimetableDepartureBoard(...LINE4_RIDE, query(kst(SERVICE_DATE, "23:40:00")));

    // Assert
    expect(board.departures.map(({ board: call }) => [call.runId, call.isLastRun])).toEqual([
      ["4/2026-10-20/4597", false],
      ["4/2026-10-20/4599", true],
    ]);
    expect(board.nextServiceAt).toBeNull();
  });

  it("After midnight: serves a train past 24:00 on its service day, at the next date's instant", () => {
    // Act
    const board = toTimetableDepartureBoard(...LINE4_RIDE, query(kst("2026-10-21", "00:00:00")));

    // Assert
    expect(board.departures.map(({ board: call, alight }) => [call.runId, call.scheduledDepartureAt, alight?.scheduledArrivalAt])).toEqual([
      ["4/2026-10-20/4599", kst("2026-10-21", "00:01:00"), kst("2026-10-21", "00:54:00")],
    ]);
  });
});

describe("toNextServiceDayStart", () => {
  it("is 03:00 KST of the following date, where the UTC date is still the service date", () => {
    // Act
    const start = toNextServiceDayStart("2026-10-20");

    // Assert
    expect(start.toISOString()).toBe("2026-10-20T18:00:00.000Z");
    expect(start.toISOString()).not.toBe("2026-10-21T03:00:00.000Z");
  });
});

describe("toRideTimetableIssue", () => {
  const TABLES = subwayTimetablesFixture();

  it("accepts the 4호선 ride from 혜화 to 금정 and the 1호선 ride from 금정 to 성균관대, both ways", () => {
    // Act & Assert
    expect([
      toRideTimetableIssue(TABLES, { lineId: "4", boardPlatformId: HYEHWA, alightPlatformId: GEUMJEONG_4 }),
      toRideTimetableIssue(TABLES, { lineId: "4", boardPlatformId: GEUMJEONG_4, alightPlatformId: HYEHWA }),
      toRideTimetableIssue(TABLES, { lineId: "1", boardPlatformId: GEUMJEONG_1, alightPlatformId: SKKU }),
      toRideTimetableIssue(TABLES, { lineId: "1", boardPlatformId: SKKU, alightPlatformId: GEUMJEONG_1 }),
    ]).toEqual([null, null, null, null]);
  });

  it("refuses a platform on another line than the ride's", () => {
    // Act & Assert
    expect(toRideTimetableIssue(TABLES, { lineId: "4", boardPlatformId: HYEHWA, alightPlatformId: GEUMJEONG_1 })).toBe("KR-1-P149 is a platform of line 1, not of line 4");
  });

  it("refuses a platform the checkout does not serve", () => {
    // Act & Assert
    expect(toRideTimetableIssue(TABLES, { lineId: "4", boardPlatformId: HYEHWA, alightPlatformId: "KR-4-999" })).toBe("KR-4-999 is no platform the checkout serves");
  });

  it("refuses a day type with no table, and one whose table runs no train from the board platform to the alight one", () => {
    // Arrange
    const withoutSaturday = TABLES.filter((each) => !(each.operator === "S1" && each.line === "4" && each.dayType === "saturday"));
    const reversedHoliday = TABLES.map((each) =>
      each.operator === "S1" && each.line === "4" && each.dayType === "holiday" ? { ...each, trains: each.trains.filter((row) => row.direction === "up") } : each,
    );

    // Act & Assert
    expect(toRideTimetableIssue(withoutSaturday, { lineId: "4", boardPlatformId: HYEHWA, alightPlatformId: GEUMJEONG_4 })).toBe("no saturday table for S1-4-420");
    expect(toRideTimetableIssue(reversedHoliday, { lineId: "4", boardPlatformId: HYEHWA, alightPlatformId: GEUMJEONG_4 })).toBe("no holiday train runs from S1-4-420 to KR-4-443");
  });
});
