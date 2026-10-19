/**
 * Revision 1 of the `map-layer-sets` dataset, __tests__/nest/map/fixtures/map-layer-sets.dataset.json
 * without its provenance note, as the push stores it: the data a FakeMapLayerSetRepository is seeded with
 * by the specs and route tests of the flows that read the layer sets (config, event, event-details).
 */
import fs from "fs";
import path from "path";
import { FakeMapLayerSetRepository } from "../fakes/map/map-layer-set.repository.fake";

const FIXTURE = path.join(__dirname, "../../nest/map/fixtures/map-layer-sets.dataset.json");

export function fixtureLayerSets(): { layerSets: Array<Record<string, unknown>> } {
  const dataset = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { _about?: string; layerSets: Array<Record<string, unknown>> };
  delete dataset._about;
  return dataset;
}

/** A FakeMapLayerSetRepository holding the fixture as revision 1. */
export function fixtureLayerSetRepository(): FakeMapLayerSetRepository {
  const repository = new FakeMapLayerSetRepository();
  repository.storeLayerSets(fixtureLayerSets());
  return repository;
}
