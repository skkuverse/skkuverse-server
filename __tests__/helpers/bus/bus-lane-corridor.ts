/**
 * Revision 1 of the `bus-lane-corridor` dataset as production stores it
 * (fixtures/bus-lane-corridor.dataset.json of bus, without its provenance
 * note), and its snapshot as the live tick reads it. A test that needs another
 * corridor changes a copy.
 */
import fs from "fs";
import path from "path";
import { toCorridorSnapshot } from "../../../src/bus/eta/lane/bus-eta-lane.mapper";
import type { LaneCorridorData, LaneCorridorSnapshot } from "../../../src/bus/eta/lane/bus-eta-lane.types";

const FIXTURE = path.join(__dirname, "../../nest/bus/fixtures/bus-lane-corridor.dataset.json");

/** A fresh copy of revision 1 of `bus-lane-corridor`, as the push imports it. */
export function corridorFixture(): LaneCorridorData {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as LaneCorridorData & { _about?: string };
  delete data._about;
  return data;
}

/** The snapshot BusEtaLaneService.corridor() answers for `data` stored as `revision`, revision 1 of the fixture by default. */
export function corridorSnapshot(data: LaneCorridorData = corridorFixture(), revision = 1): LaneCorridorSnapshot {
  return toCorridorSnapshot({ revision, data });
}
