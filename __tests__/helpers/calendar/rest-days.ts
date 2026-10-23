/**
 * Revision 1 of the `skku-rest-days` dataset as production stores it
 * (fixtures/skku-rest-days.dataset.json of calendar, without its provenance
 * note), an in-memory calendar repository holding it and no stored public
 * holiday year (so date-holidays answers), and a CalendarService over that
 * repository, which a spec or a route test of a reader of the calendar builds
 * on; a test that needs other rest days stores a changed copy as the next
 * revision. And a scripted calendar with the same rest days and no public
 * holiday in any year, for a spec whose subject is not the calendar.
 */
import fs from "fs";
import path from "path";
import type { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { CalendarService } from "../../../src/calendar/calendar.service";
import type { Clock } from "../../../src/infra/clock";
import { FakeCalendarRepository } from "../fakes/calendar/calendar.repository.fake";
import { FakeCalendarService } from "../fakes/calendar/calendar.service.fake";
import { asReal } from "../fakes/public-of";

const FIXTURES = path.join(__dirname, "../../nest/calendar/fixtures");

/** A fresh copy of revision 1 of `skku-rest-days`: each MM-DD or YYYY-MM-DD key with its label. */
export function restDaysFixture(): Record<string, string> {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "skku-rest-days.dataset.json"), "utf8")) as Record<string, string>;
  delete data._about;
  return data;
}

/** An in-memory calendar repository holding revision 1 of `skku-rest-days` and no public holiday. */
export function storedCalendarRepository(): FakeCalendarRepository {
  const repository = new FakeCalendarRepository();
  repository.storeRestDays(restDaysFixture());
  return repository;
}

/** A CalendarService over `repository`, revision 1 of the rest days unless the test stores another. */
export function storedCalendarService(clock: Clock, repository = storedCalendarRepository()): CalendarService {
  return new CalendarService(asReal<CalendarRepository>(repository), clock);
}

/** A scripted calendar: revision 1 of the rest days and no public holiday in any year. */
export function scriptedCalendarService(): FakeCalendarService {
  const calendar = new FakeCalendarService();
  calendar.restDayLabels = restDaysFixture();
  return calendar;
}
