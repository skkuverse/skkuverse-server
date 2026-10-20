/**
 * Revision 1 of the `subway-topology` dataset as production stores it
 * (fixtures/subway-topology.dataset.json of subway, without its provenance
 * note), an in-memory repository holding it, and a SubwayTopologyService over
 * that repository, which a spec or route test of a reader of the topology (the
 * arrivals route, the Seoul pollers) builds on, and the registry it serves. A test that needs another
 * topology changes a copy.
 *
 * The service is required when built, so a test over a real `mongod` can
 * import this file before src/infra/config.ts may load.
 */
import fs from "fs";
import path from "path";
import type { Clock } from "../../../src/infra/clock";
import { SUBWAY_NETWORK } from "../../../src/subway/subway.constants";
import type { SubwayRegistry } from "../../../src/subway/subway.types";
import { toSubwayRegistry } from "../../../src/subway/topology/subway-topology.mapper";
import type { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import type { SubwayTopologyService } from "../../../src/subway/topology/subway-topology.service";
import type { SubwayTopologyData } from "../../../src/subway/topology/subway-topology.types";
import { FakeSubwayTopologyRepository } from "../fakes/subway/subway-topology.repository.fake";
import { asReal } from "../fakes/public-of";

type ServiceModule = typeof import("../../../src/subway/topology/subway-topology.service");

const FIXTURE = path.join(__dirname, "../../nest/subway/fixtures/subway-topology.dataset.json");
const STORED_AT: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

/** A fresh copy of revision 1 of `subway-topology`, as the push imports it. */
export function subwayTopologyFixture(): SubwayTopologyData {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as SubwayTopologyData & { _about?: string };
  delete data._about;
  return data;
}

/** The registry a reader serves from revision 1: SUBWAY_NETWORK joined to the fixture, as SubwayTopologyService builds it. */
export function subwayRegistryFixture(): SubwayRegistry {
  return toSubwayRegistry(SUBWAY_NETWORK, subwayTopologyFixture());
}

/** A FakeSubwayTopologyRepository holding `data` (revision 1 of the fixture by default) as revision 1. */
export function storedSubwayTopologyRepository(data: SubwayTopologyData = subwayTopologyFixture()): FakeSubwayTopologyRepository {
  const repository = new FakeSubwayTopologyRepository();
  repository.storeTopology(data);
  return repository;
}

/** A SubwayTopologyService over storedSubwayTopologyRepository(). */
export function storedSubwayTopologyService(repository = storedSubwayTopologyRepository(), clock: Clock = STORED_AT): SubwayTopologyService {
  const { SubwayTopologyService: Service } = require("../../../src/subway/topology/subway-topology.service") as ServiceModule;
  return new Service(asReal<SubwayTopologyRepository>(repository), clock);
}
