/**
 * Revision 1 of the bus schedule content datasets as production stores them
 * (fixtures/bus-service-notices.dataset.json and skku-rest-days.dataset.json
 * of bus, without their provenance notes), and an in-memory content
 * repository holding both, which a spec of a
 * reader of the timetable builds on, and a BusScheduleContentService over that
 * repository. A test that needs other content changes a copy and stores it as
 * the next revision.
 */
import fs from "fs";
import path from "path";
import type { BusScheduleContentRepository } from "../../../src/bus/schedule-content/bus-schedule-content.repository";
import { BusScheduleContentService } from "../../../src/bus/schedule-content/bus-schedule-content.service";
import type { Clock } from "../../../src/infra/clock";
import { FakeBusScheduleContentRepository } from "../fakes/bus/bus-schedule-content.repository.fake";
import { asReal } from "../fakes/public-of";

const FIXTURES = path.join(__dirname, "../../nest/bus/fixtures");

export interface ServiceNoticesData {
  services: Record<string, { notices: Array<{ style: string; text: string }>; suspend: { from: string; until: string } | null }>;
}

/** A fresh copy of revision 1 of `bus-service-notices`. */
export function serviceNoticesFixture(): ServiceNoticesData {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "bus-service-notices.dataset.json"), "utf8")) as ServiceNoticesData & { _about?: string };
  delete data._about;
  return data;
}

/** Revision 1 of `bus-service-notices` with `serviceId` suspended from `from` to `until`. */
export function serviceNoticesWithSuspension(serviceId: string, suspend: { from: string; until: string }): ServiceNoticesData {
  const data = serviceNoticesFixture();
  data.services[serviceId] = { ...data.services[serviceId]!, suspend };
  return data;
}

/** Revision 1 of `bus-service-notices` with `serviceId`'s notices replaced. */
export function serviceNoticesWithNotices(serviceId: string, notices: Array<{ style: string; text: string }>): ServiceNoticesData {
  const data = serviceNoticesFixture();
  data.services[serviceId] = { ...data.services[serviceId]!, notices };
  return data;
}

/** A fresh copy of revision 1 of `skku-rest-days`: each MM-DD or YYYY-MM-DD key with its label. */
export function restDaysFixture(): Record<string, string> {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "skku-rest-days.dataset.json"), "utf8")) as Record<string, string>;
  delete data._about;
  return data;
}

/** An in-memory content repository holding revision 1 of every bus schedule content dataset. */
export function storedScheduleContentRepository(): FakeBusScheduleContentRepository {
  const repository = new FakeBusScheduleContentRepository();
  repository.storeServiceNotices(serviceNoticesFixture());
  repository.storeRestDays(restDaysFixture());
  return repository;
}

/** A BusScheduleContentService over `repository`, revision 1 of every dataset unless the test stores another. */
export function storedScheduleContentService(clock: Clock, repository = storedScheduleContentRepository()): BusScheduleContentService {
  return new BusScheduleContentService(asReal<BusScheduleContentRepository>(repository), clock);
}
