/**
 * The platform gates production served on GET /app/config (fixtures/app-platform-gates.dataset.json of
 * app-config, without its provenance note), and an in-memory repository holding them, which a route test
 * that boots /app/config overrides AppConfigRepository with. A test that needs other gates changes a copy.
 */
import fs from "fs";
import path from "path";
import type { AppPlatformGates } from "../../../src/app-config/app-config.document";
import { FakeAppConfigRepository } from "../fakes/app-config/app-config.repository.fake";

const FIXTURE = path.join(__dirname, "../../nest/app-config/fixtures/app-platform-gates.dataset.json");

/** A fresh copy of the production platform gates, as `npm run data -- push app-platform-gates --create` imports them. */
export function appPlatformGatesFixture(): AppPlatformGates {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as AppPlatformGates & { _about?: string };
  delete data._about;
  return data;
}

/** A FakeAppConfigRepository holding `data` (the production gates by default) as revision 1. */
export function storedPlatformGatesRepository(data: unknown = appPlatformGatesFixture()): FakeAppConfigRepository {
  const repository = new FakeAppConfigRepository();
  repository.storePlatformGates(data);
  return repository;
}
