/**
 * Revision 1 of the `miniapps` dataset, __tests__/nest/miniapps/fixtures/miniapps.dataset.json
 * without its provenance note, as the push stores it: the registry the specs and route tests of every
 * reader of the mini app registry seed a FakeMiniappsRepository with, and a MiniappsService over it.
 */
import fs from "fs";
import path from "path";
import type { Clock } from "../../../src/infra/clock";
import { WEB_ORIGIN } from "../../../src/infra/origins";
import { toMiniAppRegistry } from "../../../src/miniapps/miniapps.mapper";
import type { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { checkedRegistry } from "../../../src/miniapps/miniapps.schema";
import { MiniappsService } from "../../../src/miniapps/miniapps.service";
import type { MiniAppRegistry } from "../../../src/miniapps/miniapps.types";
import { FakeMiniappsRepository } from "../fakes/miniapps/miniapps.repository.fake";
import { asReal } from "../fakes/public-of";

const FIXTURE = path.join(__dirname, "../../nest/miniapps/fixtures/miniapps.dataset.json");

export function fixtureRegistry(): { index: { version: number; miniApps: Array<Record<string, unknown>> }; details: Record<string, Record<string, unknown>> } {
  const dataset = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as ReturnType<typeof fixtureRegistry> & { _about?: string };
  delete dataset._about;
  return dataset;
}

/** The fixture's mini app ids, in index order: what the places importer reads from the stored registry. */
export function fixtureMiniAppIds(): string[] {
  return fixtureRegistry().index.miniApps.map((entry) => String(entry.id));
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

/** A MiniappsService over `repository`, for a spec that pushes, empties or fails the registry it reads. */
export function miniappsServiceOver(repository: FakeMiniappsRepository, clock: Clock = FIXED_CLOCK): MiniappsService {
  return new MiniappsService(asReal<MiniappsRepository>(repository), clock);
}

/** The fixture with one more third-party mini app, `wave-run`, registered: the push a reader must pick up. */
export function fixtureRegistryWithWaveRun(): ReturnType<typeof fixtureRegistry> {
  const registry = fixtureRegistry();
  registry.index.miniApps.push({ id: "wave-run", name: "Wave Run", order: 50, homeLogo: { kind: "emoji", emoji: "🌊" } });
  registry.details["wave-run"] = { version: 1, id: "wave-run", startUrl: "https://wave-run.example.com/", verified: false, relatedLinks: [] };
  return registry;
}

/** The snapshot `fixtureMiniappsService().current()` resolves to, built synchronously for a pure rules spec. */
export function fixtureRegistrySnapshot(): MiniAppRegistry {
  return toMiniAppRegistry(checkedRegistry.parse(fixtureRegistry()), 1, WEB_ORIGIN);
}
