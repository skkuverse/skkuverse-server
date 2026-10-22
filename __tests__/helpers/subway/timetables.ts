/**
 * The trimmed `subway-timetables` fixture (fixtures/subway-timetables/ of
 * subway, one file per table):
 * each part of revision 1 with only the trains that reach a served platform
 * around the pinned instants the characterization runs at, and around
 * the instants the unit and route tests read the tables at. A fresh copy per
 * call, without the provenance note, as the part schema parses it.
 *
 * Also an in-memory repository holding tables as one stored revision, and a
 * SubwayTimetableService over it, which a spec of a reader of the timetables
 * (the tracker, the arrivals route, the Seoul pollers) builds on. The service
 * is required when called, so a test over a real `mongod` can import this file
 * before src/infra/config.ts may load.
 */
import fs from "fs";
import path from "path";
import type { Db as MongoDb } from "mongodb";
import type { HolidaysService } from "../../../src/holidays/holidays.service";
import type { Clock } from "../../../src/infra/clock";
import type { SubwayTimetableRepository } from "../../../src/subway/timetable/subway-timetable.repository";
import type { SubwayTimetableService } from "../../../src/subway/timetable/subway-timetable.service";
import type { Timetable } from "../../../src/subway/timetable/subway-timetable.types";
import { FakeHolidaysService } from "../fakes/holidays/holidays.service.fake";
import { asReal } from "../fakes/public-of";
import { FakeSubwayTimetableRepository } from "../fakes/subway/subway-timetable.repository.fake";

type ServiceModule = typeof import("../../../src/subway/timetable/subway-timetable.service");

const STORED_AT: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

export const SUBWAY_TIMETABLES_FIXTURE_DIR = path.join(__dirname, "../../nest/subway/fixtures/subway-timetables");

/** Each fixture file's name and its table, in file-name order. */
export function subwayTimetableFixtureFiles(): Array<{ file: string; table: Timetable }> {
  return fs
    .readdirSync(SUBWAY_TIMETABLES_FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(SUBWAY_TIMETABLES_FIXTURE_DIR, file), "utf8")) as Timetable & { _about?: string };
      delete raw._about;
      return { file, table: raw };
    });
}

/** Every table of the fixture, in file-name order. */
export function subwayTimetablesFixture(): Timetable[] {
  return subwayTimetableFixtureFiles().map(({ table }) => table);
}

/** A FakeSubwayTimetableRepository holding `tables` (the fixture's by default) as revision 1. */
export function storedSubwayTimetableRepository(tables: readonly Timetable[] = subwayTimetablesFixture()): FakeSubwayTimetableRepository {
  const repository = new FakeSubwayTimetableRepository();
  repository.storeTables(tables);
  return repository;
}

/** A SubwayTimetableService over a stored repository, a holiday calendar (none by default) and a clock. */
export function storedSubwayTimetableService({
  repository = storedSubwayTimetableRepository(),
  holidays = new FakeHolidaysService(),
  clock = STORED_AT,
}: { repository?: FakeSubwayTimetableRepository; holidays?: FakeHolidaysService; clock?: Clock } = {}): SubwayTimetableService {
  const { SubwayTimetableService: Service } = require("../../../src/subway/timetable/subway-timetable.service") as ServiceModule;
  return new Service(asReal<HolidaysService>(holidays), asReal<SubwayTimetableRepository>(repository), clock);
}

/**
 * Stores the fixture as revision 1 of `subway-timetables` in `content`, as `npm run data -- push --create --dir`
 * does: each table checked and keyed by the tool's catalog over src/, then written through scripts/lib/datasets/parts.js.
 */
export async function storeSubwayTimetablesFixture(content: MongoDb, meta: { by: string; now: Date }): Promise<void> {
  const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
  const { checkParts } = require("../../../scripts/lib/datasets/checks");
  const parts = require("../../../scripts/lib/datasets/parts");
  const catalog = loadCatalog((relativePath: string) => require(path.join(__dirname, "../../../src", relativePath)));
  const files = subwayTimetableFixtureFiles().map(({ file, table }) => ({ file, data: table }));
  const checked = checkParts(catalog, "subway-timetables", files, {});
  if (checked.issues.length > 0) throw new Error(`the subway-timetables fixture fails its push checks: ${JSON.stringify(checked.issues)}`);
  const result = await parts.create(content, "subway-timetables", checked.parts, meta);
  if (!result.ok) throw new Error(`the subway-timetables fixture was not stored: ${JSON.stringify(result)}`);
}
