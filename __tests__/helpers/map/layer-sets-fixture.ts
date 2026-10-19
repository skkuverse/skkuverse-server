/**
 * Revision 1 of the `map-layer-sets` dataset, __tests__/nest/map/fixtures/map-layer-sets.dataset.json
 * without its provenance note, as the push stores it: the data a FakeMapLayerSetRepository is seeded with
 * by the specs and route tests of the flows that read the layer sets (config, event, event-details), and
 * one of its sets parsed as the read parses it, so a spec in a sibling flow does not import layer-set/
 * internals to get one.
 */
import fs from "fs";
import path from "path";
import { checkedLayerSet, type LayerSet } from "../../../src/map/layer-set/map-layer-set.schema";
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

/** The fixture's set `layerSetId`, parsed by `checkedLayerSet` as MapLayerSetRepository parses each stored set. */
export function fixtureLayerSet(layerSetId = "eskara-2026"): LayerSet {
  const set = fixtureLayerSets().layerSets.find((candidate) => candidate.layerSetId === layerSetId);
  if (set === undefined) throw new Error(`the map-layer-sets fixture holds no layer set ${layerSetId}`);
  return Object.freeze(checkedLayerSet.parse(set));
}
