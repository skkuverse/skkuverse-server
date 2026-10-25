/**
 * The platform gates GET /app/config served in the 2026-10-19 capture (fixtures/app-platform-gates.dataset.json
 * of app-config, without its provenance note), and an in-memory repository holding them, which a route test
 * that boots /app/config overrides AppConfigRepository with. A test that needs other gates changes a copy.
 *
 * These are test data, not production's current gates: production has since raised the floors, so pushing
 * this file to a database would lower the force-update floor. Never push it; create the dataset from the
 * live response instead (docs/how-to/edit-runtime-data.md, "Raise an app platform gate").
 */
import fs from "fs";
import path from "path";
import type { AppPlatformGates } from "../../../src/app-config/app-config.document";
import { FakeAppConfigRepository } from "../fakes/app-config/app-config.repository.fake";

const FIXTURE = path.join(__dirname, "../../nest/app-config/fixtures/app-platform-gates.dataset.json");

/** A fresh copy of the platform gates of the 2026-10-19 capture, which the /app/config characterization bytes depend on. */
export function appPlatformGatesFixture(): AppPlatformGates {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as AppPlatformGates & { _about?: string };
  delete data._about;
  return data;
}

/** A FakeAppConfigRepository holding `data` (the captured gates by default) as revision 1. */
export function storedPlatformGatesRepository(data: unknown = appPlatformGatesFixture()): FakeAppConfigRepository {
  const repository = new FakeAppConfigRepository();
  repository.storePlatformGates(data);
  return repository;
}
