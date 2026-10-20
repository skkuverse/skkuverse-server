/**
 * The trimmed `subway-timetables` fixture against the committed tables it was
 * cut from (move-reference-datasets task 9.1, design D14). The wave D
 * characterization seeds the fixture in place of the committed tables, so it
 * proves what it pins only while the two answer alike: at every pinned instant
 * (a weekday 08:00, 00:20 and 02:00 KST, a Saturday 14:00 and a public holiday
 * 11:00), every served platform's timetable-only arrivals, up and down, and
 * its line's travel order are identical from the trimmed and the committed
 * table of its day type. The fixture holds one file per table, named by its
 * key, each table's header as committed and only committed trains, in their
 * order, under 1 MB in all.
 *
 * Deleted with the committed tables (task 11.1).
 */
import fs from "fs";
import path from "path";
import { toStationArrivals } from "../../../src/subway/estimate/subway-estimate.rules";
import { SUBWAY_TIMETABLES } from "../../../src/subway/timetable/subway-timetable.config";
import { findTimetable, listSubwayPlatforms, toDayType, toLineRoutes, toScheduledTrains, toServiceDate } from "../../../src/subway/timetable/subway-timetable.rules";
import type { Timetable } from "../../../src/subway/timetable/subway-timetable.types";
import { MAX_TRAINS_PER_DIRECTION } from "../../../src/subway/tracking/subway-tracking.constants";
import type { NetworkPlatform } from "../../../src/subway/subway.types";
import { SUBWAY_TIMETABLES_FIXTURE_DIR, subwayTimetableFixtureFiles, subwayTimetablesFixture } from "../../helpers/subway/timetables";

const MAX_FIXTURE_BYTES = 1_000_000;

const INSTANTS: Array<[label: string, iso: string, isPublicHoliday: boolean]> = [
  ["a weekday 08:00", "2026-10-20T23:00:00.000Z", false],
  ["a weekday 00:20", "2026-10-20T15:20:00.000Z", false],
  ["a weekday 02:00", "2026-10-20T17:00:00.000Z", false],
  ["a Saturday 14:00", "2026-10-24T05:00:00.000Z", false],
  ["a public holiday 11:00", "2026-12-25T02:00:00.000Z", true],
];

const keyOf = (table: Timetable): string => `${table.operator}-${table.line}-${table.dayType}`;
const headerOf = ({ source, operator, line, dayType, stations }: Timetable) => ({ source, operator, line, dayType, stations });

/** What a platform answers from `tables` at `now` with no live state: its line's routes and each direction's next trains. */
function timetableOnlyAnswer(tables: readonly Timetable[], platform: NetworkPlatform, now: Date, isPublicHoliday: boolean) {
  const serviceDate = toServiceDate(now);
  const table = findTimetable(tables, platform, toDayType(platform.timetable.source, serviceDate, isPublicHoliday));
  if (!table) return null;
  const trains = toScheduledTrains(table, serviceDate);
  const arrivalsOf = (direction: "up" | "down") =>
    toStationArrivals({ platformId: platform.id, direction, trains, now, histories: new Map(), countdownRows: [], isTracked: false }).arrivals.slice(
      0,
      MAX_TRAINS_PER_DIRECTION,
    );
  return { key: keyOf(table), routes: toLineRoutes(table), up: arrivalsOf("up"), down: arrivalsOf("down") };
}

describe("the trimmed subway-timetables fixture", () => {
  it("holds one file per committed table, named by its key, under 1 MB in all", () => {
    // Act
    const files = subwayTimetableFixtureFiles();

    // Assert
    expect(files.map(({ file }) => file)).toEqual(SUBWAY_TIMETABLES.map((table) => `${keyOf(table)}.json`).sort());
    expect(files.every(({ file, table }) => file === `${keyOf(table)}.json`)).toBe(true);
    const bytes = files.reduce((sum, { file }) => sum + fs.statSync(path.join(SUBWAY_TIMETABLES_FIXTURE_DIR, file)).size, 0);
    expect(bytes).toBeLessThan(MAX_FIXTURE_BYTES);
  });

  it("keeps each table's header as committed and only committed trains, in their committed order", () => {
    // Act
    const tables = subwayTimetablesFixture();

    // Assert
    const mismatches = tables.flatMap((trimmed) => {
      const committed = SUBWAY_TIMETABLES.find((table) => keyOf(table) === keyOf(trimmed));
      const committedTrains = (committed?.trains ?? []).map((train) => JSON.stringify(train));
      const positions = trimmed.trains.map((train) => committedTrains.indexOf(JSON.stringify(train)));
      const isHeaderEqual = committed !== undefined && JSON.stringify(headerOf(trimmed)) === JSON.stringify(headerOf(committed));
      const isInOrder = positions.every((position, i) => position >= 0 && (i === 0 || position > (positions[i - 1] ?? -1)));
      return isHeaderEqual && isInOrder && trimmed.trains.length > 0 ? [] : [keyOf(trimmed)];
    });
    expect(mismatches).toEqual([]);
  });

  it.each(INSTANTS)("answers every platform at %s as the committed tables do", (_label, iso, isPublicHoliday) => {
    // Arrange
    const now = new Date(iso);
    const trimmed = subwayTimetablesFixture();

    // Act
    const fromFixture = listSubwayPlatforms().map((platform) => timetableOnlyAnswer(trimmed, platform, now, isPublicHoliday));

    // Assert
    const fromCommitted = listSubwayPlatforms().map((platform) => timetableOnlyAnswer(SUBWAY_TIMETABLES, platform, now, isPublicHoliday));
    expect(fromCommitted.every((answer) => answer !== null)).toBe(true);
    expect(fromFixture).toEqual(fromCommitted);
  });
});
