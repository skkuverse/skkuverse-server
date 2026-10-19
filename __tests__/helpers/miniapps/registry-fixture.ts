/**
 * Revision 1 of the `miniapps` dataset, __tests__/nest/miniapps/fixtures/miniapps.dataset.json
 * without its provenance note, as the push stores it: the registry the specs and route tests of every
 * reader of the mini app registry seed a FakeMiniappsRepository with.
 */
import fs from "fs";
import path from "path";

const FIXTURE = path.join(__dirname, "../../nest/miniapps/fixtures/miniapps.dataset.json");

export function fixtureRegistry(): { index: { version: number; miniApps: Array<Record<string, unknown>> }; details: Record<string, Record<string, unknown>> } {
  const dataset = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as ReturnType<typeof fixtureRegistry> & { _about?: string };
  delete dataset._about;
  return dataset;
}
