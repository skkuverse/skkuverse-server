/**
 * Revision 1 of the `subway-station-coords` dataset as the push imports it
 * (fixtures/subway-station-coords.dataset.json of subway, without its
 * provenance note), an in-memory repository holding it, and a
 * SubwayStationCoordsService over that repository, which a spec or route test
 * of a reader of the coords (the arrivals route) builds on. A test that needs
 * other coords changes a copy.
 *
 * The service is required when built, so a test over a real `mongod` can
 * import this file before src/infra/config.ts may load.
 */
import fs from "fs";
import path from "path";
import type { Clock } from "../../../src/infra/clock";
import type { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import type { SubwayStationCoordsService } from "../../../src/subway/station-coords/subway-station-coords.service";
import type { SubwayStationCoordsData } from "../../../src/subway/station-coords/subway-station-coords.types";
import { FakeSubwayStationCoordsRepository } from "../fakes/subway/subway-station-coords.repository.fake";
import { asReal } from "../fakes/public-of";

type ServiceModule = typeof import("../../../src/subway/station-coords/subway-station-coords.service");

const FIXTURE = path.join(__dirname, "../../nest/subway/fixtures/subway-station-coords.dataset.json");
const STORED_AT: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

/** A fresh copy of revision 1 of `subway-station-coords`, as the push imports it. */
export function stationCoordsFixture(): SubwayStationCoordsData {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as SubwayStationCoordsData & { _about?: string };
  delete data._about;
  return data;
}

/** A FakeSubwayStationCoordsRepository holding `data` (revision 1 of the fixture by default) as revision 1. */
export function storedStationCoordsRepository(data: SubwayStationCoordsData = stationCoordsFixture()): FakeSubwayStationCoordsRepository {
  const repository = new FakeSubwayStationCoordsRepository();
  repository.storeCoords(data);
  return repository;
}

/** A SubwayStationCoordsService over storedStationCoordsRepository(). */
export function storedStationCoordsService(repository = storedStationCoordsRepository(), clock: Clock = STORED_AT): SubwayStationCoordsService {
  const { SubwayStationCoordsService: Service } = require("../../../src/subway/station-coords/subway-station-coords.service") as ServiceModule;
  return new Service(asReal<SubwayStationCoordsRepository>(repository), clock);
}
