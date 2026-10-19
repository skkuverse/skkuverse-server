/**
 * Revision 1 of the `miniapps` dataset, __tests__/nest/miniapps/fixtures/miniapps.dataset.json
 * without its provenance note, as the push stores it: the registry the specs and route tests of every
 * reader of the mini app registry seed a FakeMiniappsRepository with, and a MiniappsService over it.
 */
import fs from "fs";
import path from "path";
import type { Clock } from "../../../src/infra/clock";
import type { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { MiniappsService } from "../../../src/miniapps/miniapps.service";
import { FakeMiniappsRepository } from "../fakes/miniapps/miniapps.repository.fake";
import { asReal } from "../fakes/public-of";

const FIXTURE = path.join(__dirname, "../../nest/miniapps/fixtures/miniapps.dataset.json");

export function fixtureRegistry(): { index: { version: number; miniApps: Array<Record<string, unknown>> }; details: Record<string, Record<string, unknown>> } {
  const dataset = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as ReturnType<typeof fixtureRegistry> & { _about?: string };
  delete dataset._about;
  return dataset;
}

const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

/** A FakeMiniappsRepository holding the fixture as revision 1, typed as the real repository a constructor takes. */
export function fixtureRegistryRepository(): MiniappsRepository {
  return asReal<MiniappsRepository>(FakeMiniappsRepository.seededWith(fixtureRegistry()));
}

/** A MiniappsService over fixtureRegistryRepository(). */
export function fixtureMiniappsService(clock: Clock = FIXED_CLOCK): MiniappsService {
  return new MiniappsService(fixtureRegistryRepository(), clock);
}
