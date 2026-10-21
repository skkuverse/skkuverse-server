/**
 * Revision 1 of the `bus-stops` dataset as production stores it
 * (fixtures/bus-stops.dataset.json of bus, without its provenance note),
 * which a spec or route test of a reader of the stops (the bus config, the
 * shuttle estimates, the ui) builds on. A test that needs other stops changes
 * a copy.
 */
import fs from "fs";
import path from "path";

const FIXTURE = path.join(__dirname, "../../nest/bus/fixtures/bus-stops.dataset.json");

/** A fresh copy of revision 1 of `bus-stops`, as the push imports it. */
export function busStopsFixture(): Record<string, unknown> {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  delete data._about;
  return data;
}
