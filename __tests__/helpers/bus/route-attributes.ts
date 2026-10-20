/**
 * Revision 1 of the `jongro-route-attributes` dataset as production stores it
 * (fixtures/jongro-route-attributes.dataset.json of bus, without its
 * provenance note), an in-memory repository holding it, and a
 * BusRouteAttributesService over that repository, which a spec or route test
 * of a reader of the attributes (the bus config, the realtime groups, the ui)
 * builds on. A test that needs other attributes changes a copy.
 *
 * The service is required when built, so a test over a real `mongod` can
 * import this file before src/infra/config.ts may load.
 */
import fs from "fs";
import path from "path";
import type { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import type { BusRouteAttributesService } from "../../../src/bus/route-attributes/bus-route-attributes.service";
import type { JongroRouteAttributesData } from "../../../src/bus/route-attributes/bus-route-attributes.types";
import type { Clock } from "../../../src/infra/clock";
import { FakeBusRouteAttributesRepository } from "../fakes/bus/bus-route-attributes.repository.fake";
import { asReal } from "../fakes/public-of";

type ServiceModule = typeof import("../../../src/bus/route-attributes/bus-route-attributes.service");

const FIXTURE = path.join(__dirname, "../../nest/bus/fixtures/jongro-route-attributes.dataset.json");
const STORED_AT: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

/** A fresh copy of revision 1 of `jongro-route-attributes`, as the push imports it. */
export function routeAttributesFixture(): JongroRouteAttributesData {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as JongroRouteAttributesData & { _about?: string };
  delete data._about;
  return data;
}

/** A FakeBusRouteAttributesRepository holding `data` (revision 1 of the fixture by default) as revision 1. */
export function storedRouteAttributesRepository(data: JongroRouteAttributesData = routeAttributesFixture()): FakeBusRouteAttributesRepository {
  const repository = new FakeBusRouteAttributesRepository();
  repository.storeAttributes(data);
  return repository;
}

/** A BusRouteAttributesService over storedRouteAttributesRepository(). */
export function storedRouteAttributesService(repository = storedRouteAttributesRepository(), clock: Clock = STORED_AT): BusRouteAttributesService {
  const { BusRouteAttributesService: Service } = require("../../../src/bus/route-attributes/bus-route-attributes.service") as ServiceModule;
  return new Service(asReal<BusRouteAttributesRepository>(repository), clock);
}
