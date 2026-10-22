/**
 * MapLayerSetRepository: the read of the stored `map-layer-sets` dataset,
 * which `npm run data` writes and the server only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeMapLayerSetRepository copies it:
 * one document by `_id`, projecting only the revision and the data, bounded by
 * `maxTimeMS`, on the content database's `datasets`. Each stored set is parsed
 * on its own: a bad or repeated one is left out of `layerSets`, named in
 * `rejected`, and logged at error once per revision, so one broken festival
 * never takes the others with it (ADR 0010 D5). A missing document and one
 * whose envelope fails the schema read as `null`, each logged at error at most
 * once a minute (an invalid one once a minute per revision): the service then
 * serves its last good sets, or the base map. A failed read rejects as
 * MapLayerSetsReadError.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and
 * src/infra/logger.ts are mocked.
 */
import fs from "fs";
import path from "path";

const findOne = jest.fn();
const openedCollections: Array<{ dbName: string; name: string }> = [];

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({
    db: (dbName: string) => ({
      collection: (name: string) => {
        openedCollections.push({ dbName, name });
        return { findOne };
      },
    }),
  })),
}));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { logText } from "../../../__tests__/helpers/log-text";
import { MapLayerSetRepository } from "./map-layer-set.repository";
import { checkedLayerSet } from "./map-layer-set.schema";

// Revision 1 of the map-layer-sets dataset, as stored in skku_content and skku_content_dev.
const DATASET_FIXTURE = path.join(__dirname, "../../../__tests__/nest/map/fixtures/map-layer-sets.dataset.json");

function fixtureSet(): Record<string, any> {
  return (JSON.parse(fs.readFileSync(DATASET_FIXTURE, "utf8")) as { layerSets: Array<Record<string, any>> }).layerSets[0]!;
}

/** The fixture's set with another id and a chip naming a layer it does not define. */
function badSet(layerSetId: string): Record<string, any> {
  const set = fixtureSet();
  set.layerSetId = layerSetId;
  set.chips[0].layerIds = ["nope"];
  return set;
}

const NOW = new Date("2026-10-19T03:00:00.000Z");
const LOG_INTERVAL_MS = 60_000;
const errorsOf = (event: string) => mockLogger.error.mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

let repository: MapLayerSetRepository;

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  findOne.mockReset();
  openedCollections.length = 0;
  jest.clearAllMocks();
  repository = new MapLayerSetRepository();
});

describe("MapLayerSetRepository.findLayerSets", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "map-layer-sets", revision: 1, data: { layerSets: [fixtureSet()] } });

    // Act
    await repository.findLayerSets();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "map-layer-sets" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and every set, parsed, with none rejected", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "map-layer-sets", revision: 4, data: { layerSets: [fixtureSet()] } });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored).toEqual({ revision: 4, layerSets: [checkedLayerSet.parse(fixtureSet())], rejected: [] });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("leaves out a bad set and a repeated one, keeps the rest, and logs each with its id and issues", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "map-layer-sets", revision: 5, data: { layerSets: [badSet("spring-2027"), fixtureSet(), fixtureSet()] } });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored?.layerSets.map((set) => set.layerSetId)).toEqual(["eskara-2026"]);
    expect(stored?.rejected.map(({ index, layerSetId }) => ({ index, layerSetId }))).toEqual([
      { index: 0, layerSetId: "spring-2027" },
      { index: 2, layerSetId: "eskara-2026" },
    ]);
    expect(errorsOf("map.layer_sets.invalid_set")).toEqual([
      expect.objectContaining({ dataset: "map-layer-sets", revision: 5, index: 0, layerSetId: "spring-2027", issues: ['chips: chip "eskara26_view_bar": "nope" is not a layer'] }),
      expect.objectContaining({ dataset: "map-layer-sets", revision: 5, index: 2, layerSetId: "eskara-2026", issues: ['layerSetId: repeats the layer set "eskara-2026" of layerSets[1]'] }),
    ]);
  });

  it("logs a left-out set once per revision, and again for the next revision", async () => {
    // Arrange
    const doc = (revision: number) => ({ _id: "map-layer-sets", revision, data: { layerSets: [badSet("spring-2027"), fixtureSet()] } });
    findOne.mockResolvedValue(doc(5));

    // Act
    for (let read = 0; read < 3; read++) await repository.findLayerSets();
    findOne.mockResolvedValue(doc(6));
    await repository.findLayerSets();

    // Assert
    expect(errorsOf("map.layer_sets.invalid_set").map((fields) => fields.revision)).toEqual([5, 6]);
  });

  it("returns null for a missing document, logged at error", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "map.layer_sets.missing", dataset: "map-layer-sets" });
  });

  it("returns null for an envelope without a layerSets array, logged at error with its revision and issues", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "map-layer-sets", revision: 6, data: { layerSets: { "eskara-2026": fixtureSet() } } });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "map.layer_sets.invalid", revision: 6 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.layerSets: /);
  });

  it("returns null for a document with no revision, logged as invalid", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "map-layer-sets", data: { layerSets: [fixtureSet()] } });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "map.layer_sets.invalid" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/revision: /);
  });

  it("rejects a failing read as MapLayerSetsReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(repository.findLayerSets()).rejects.toMatchObject({ name: "MapLayerSetsReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new MapLayerSetRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findLayerSets();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findLayerSets();

    // Assert
    expect(errorsOf("map.layer_sets.missing")).toEqual([
      expect.objectContaining({ suppressed: 0 }),
      expect.objectContaining({ suppressed: 4 }),
    ]);
  });

  it("logs an invalid envelope once a minute per revision", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new MapLayerSetRepository();
    findOne.mockResolvedValue({ _id: "map-layer-sets", revision: 7, data: {} });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findLayerSets();
    findOne.mockResolvedValue({ _id: "map-layer-sets", revision: 8, data: {} });
    await fresh.findLayerSets();

    // Assert
    expect(errorsOf("map.layer_sets.invalid").map((fields) => fields.revision)).toEqual([7, 8]);
  });
});
