/**
 * Revision 1 of the `hssc-route-line` dataset (fixtures/hssc-route-line.dataset.json of bus, without its
 * provenance note): the HSSC loop measured from GPS on 2026-10-23. A test that needs another line changes a copy.
 */
import fs from "fs";
import path from "path";
import type { HsscRouteLineData } from "../../../src/bus/hssc-route-line/bus-hssc-route-line.types";

const FIXTURE = path.join(__dirname, "../../nest/bus/fixtures/hssc-route-line.dataset.json");

/** A fresh copy of revision 1 of `hssc-route-line`, as the push imports it. */
export function hsscRouteLineFixture(): HsscRouteLineData {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as HsscRouteLineData & { _about?: string };
  delete data._about;
  return data;
}
