/**
 * Revision 1 of the `app-features` dataset as the push imports it
 * (fixtures/app-features.dataset.json of app-config, without its provenance
 * note), and an in-memory repository holding it, which a route test that boots
 * /app/config overrides AppConfigRepository with. A test that needs the other
 * position changes a copy.
 */
import fs from "fs";
import path from "path";
import type { AppFeatures } from "../../../src/app-config/app-config.types";
import { FakeAppConfigRepository } from "../fakes/app-config/app-config.repository.fake";

const FIXTURE = path.join(__dirname, "../../nest/app-config/fixtures/app-features.dataset.json");

/** A fresh copy of revision 1 of `app-features`, as the push imports it. */
export function appFeaturesFixture(): AppFeatures {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as AppFeatures & { _about?: string };
  delete data._about;
  return data;
}

/** A FakeAppConfigRepository holding `data` (revision 1 of the fixture by default) as revision 1. */
export function storedAppFeaturesRepository(data: AppFeatures = appFeaturesFixture()): FakeAppConfigRepository {
  const repository = new FakeAppConfigRepository();
  repository.storeFeatures(data);
  return repository;
}
