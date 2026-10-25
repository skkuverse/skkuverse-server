/**
 * SubwayTimetableDeparturesService, the subway's door (ADR 0022, D6), over the trimmed `subway-timetables` fixture of
 * revision 1 read through the real SubwayTimetableService and a scripted holiday calendar: a line 4 ride from Hyehwa to
 * Geumjeong on a Tuesday lists the weekday table's trains with their times at both platforms; a public holiday reads the
 * holiday table; past midnight the line 1 ride from Geumjeong to Sungkyunkwan Univ. still boards the previous service day's last train;
 * after the day's last train the next service is the next service day's first train, read once per ride and day, so
 * polls after the last train do not read the tables again; and a platform off the ride's line, an unserved one, a
 * ride no train runs and a missing table each throw DepartureUnavailableError. A train the board platform's station
 * board lists live (a FakeSubwayArrivalsService) boards by that board's call, and only the board platform is read.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { FakeCalendarService } from "../../../../__tests__/helpers/fakes/calendar/calendar.service.fake";
import { storedSubwayTimetableRepository, storedSubwayTimetableService, subwayTimetablesFixture } from "../../../../__tests__/helpers/subway/timetables";
import { FakeSubwayArrivalsService } from "../../../../__tests__/helpers/fakes/subway/subway-arrivals.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { StopCall } from "../../../shared/call.types";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { SubwayArrivalsService } from "../../arrivals/subway-arrivals.service";
import type { DepartureQuery } from "../../../shared/departure.types";
import { SubwayTimetableDeparturesService } from "./subway-timetable-departures.service";

const kst = (date: string, clock: string) => new Date(`${date}T${clock}+09:00`);
const HOUR_MS = 3_600_000;

function query(lineId: string, [boardStopId, alightStopId]: [string, string | null], from: Date): DepartureQuery {
  return { lineId, boardStopId, alightStopId, from, until: new Date(from.getTime() + 3 * HOUR_MS), lang: "ko" };
}

const LINE4_DOWN: [string, string] = ["S1-4-420", "KR-4-443"];
const LINE1_DOWN: [string, string] = ["KR-1-P149", "KR-1-P153"];

function setup(tables = subwayTimetablesFixture()) {
  const holidays = new FakeCalendarService();
  const repository = storedSubwayTimetableRepository(tables);
  const arrivals = new FakeSubwayArrivalsService();
  const door = new SubwayTimetableDeparturesService(storedSubwayTimetableService({ repository, holidays }), asReal<SubwayArrivalsService>(arrivals));
  return { holidays, repository, arrivals, door };
}

const partKeys = (reads: readonly string[]): string[] => reads.map((partId) => partId.replace(/^subway-timetables\/|@.*$/g, ""));

describe("SubwayTimetableDeparturesService.listDepartures", () => {
  it("lists a Tuesday's 4호선 trains from 혜화 to 금정 with the weekday table's times at both platforms", async () => {
    // Arrange
    const { door } = setup();

    // Act
    const board = await door.listDepartures(query("4", LINE4_DOWN, kst("2026-10-20", "06:20:00")));

    // Assert
    const [first] = board.departures;
    expect(first?.board).toMatchObject({ runId: "4/2026-10-20/4517", scheduledDepartureAt: kst("2026-10-20", "06:21:30"), basis: "timetable", status: "scheduled" });
    expect(first?.alight).toMatchObject({ runId: "4/2026-10-20/4517", scheduledArrivalAt: kst("2026-10-20", "07:14:00"), basis: "timetable" });
    expect(board.departures.every((departure) => departure.lineId === "4" && departure.alight !== null)).toBe(true);
  });

  it("Live train: boards a train the board platform's station board lists live by that board's call, reading only that platform", async () => {
    // Arrange
    const { arrivals, door } = setup();
    const live: StopCall = {
      ...{ status: "enRoute", expectedArrivalAt: kst("2026-10-20", "06:22:00"), expectedDepartureAt: null, scheduledArrivalAt: kst("2026-10-20", "06:21:00") },
      ...{ scheduledDepartureAt: kst("2026-10-20", "06:21:30"), basis: "provider", stopsAway: 2, runId: "4/2026-10-20/4517", vehicleId: null, headsign: "오이도" },
      ...{ isFirstRun: false, isLastRun: null, isExpress: false, providerText: null },
    };
    arrivals.callsByPlatform.set("S1-4-420", [live]);

    // Act
    const board = await door.listDepartures(query("4", LINE4_DOWN, kst("2026-10-20", "06:20:00")));

    // Assert
    expect(board.departures[0]?.board).toEqual({ ...live, isFirstRun: expect.any(Boolean), isLastRun: false });
    expect(board.departures[0]?.alight).toMatchObject({ basis: "estimate", expectedArrivalAt: kst("2026-10-20", "07:15:00") });
    expect(arrivals.reads).toEqual(["S1-4-420"]);
  });

  it("Holiday table: boards a public holiday's first train after 10:00 from the holiday table, not the weekday one", async () => {
    // Arrange
    const { holidays, door } = setup();
    holidays.names.set("2026-10-21", "a holiday");

    // Act
    const board = await door.listDepartures(query("4", LINE4_DOWN, kst("2026-10-21", "10:00:00")));

    // Assert
    expect(board.departures[0]?.board).toMatchObject({ runId: "4/2026-10-21/4547", scheduledDepartureAt: kst("2026-10-21", "10:07:30") });
  });

  it("After midnight: boards the previous service day's last 1호선 train from 금정, past 24:00", async () => {
    // Arrange
    const { door } = setup();

    // Act
    const board = await door.listDepartures(query("1", LINE1_DOWN, kst("2026-10-21", "00:00:00")));

    // Assert
    expect(board.departures.map(({ board: call, alight }) => [call.runId, call.scheduledDepartureAt, alight?.scheduledArrivalAt, call.isLastRun])).toEqual([
      ["1/2026-10-20/0515", kst("2026-10-21", "00:02:00"), kst("2026-10-21", "00:13:00"), true],
    ]);
  });

  it("Day ended: names the next service day's first train as the next service, reading Saturday's table once for three polls", async () => {
    // Arrange
    const { repository, door } = setup();
    const lateFriday = query("4", LINE4_DOWN, kst("2026-10-24", "01:30:00"));

    // Act
    const boards = [await door.listDepartures(lateFriday), await door.listDepartures(lateFriday), await door.listDepartures(lateFriday)];

    // Assert
    expect(boards.map((board) => [board.departures.length, board.nextServiceAt])).toEqual([
      [0, kst("2026-10-24", "10:07:30")],
      [0, kst("2026-10-24", "10:07:30")],
      [0, kst("2026-10-24", "10:07:30")],
    ]);
    expect(partKeys(repository.tableReads)).toEqual(["S1-4-weekday", "S1-4-saturday", "S1-4-weekday"]);
  });

  it.each([
    ["a platform of another line", "4", ["S1-4-420", "KR-1-P149"]],
    ["a platform the code does not serve", "4", ["S1-4-420", "KR-4-999"]],
    ["no alight platform", "4", ["S1-4-420", null]],
    ["a ride no train runs", "4", ["S1-4-433", "S1-4-433"]],
  ] as const)("throws DepartureUnavailableError for %s", async (_case, lineId, stops) => {
    // Arrange
    const { door } = setup();

    // Act
    const listed = door.listDepartures(query(lineId, [...stops], kst("2026-10-20", "08:00:00")));

    // Assert
    await expect(listed).rejects.toBeInstanceOf(DepartureUnavailableError);
  });

  it("throws DepartureUnavailableError naming the table when the day's table is not stored", async () => {
    // Arrange
    const { door } = setup(subwayTimetablesFixture().filter((table) => !(table.operator === "S1" && table.line === "4" && table.dayType === "weekday")));

    // Act
    const listed = door.listDepartures(query("4", LINE4_DOWN, kst("2026-10-20", "08:00:00")));

    // Assert
    await expect(listed).rejects.toThrow(new DepartureUnavailableError("The subway timetables are unavailable: S1-4-weekday"));
  });
});
