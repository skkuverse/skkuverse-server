/**
 * MapLayerSetService.liveLayerSet: "Which layer set is live, and can it be
 * served?" — the one answer both `/map/config` and the event routes read.
 * The activation comes from the eventmap database (FakeMapRepository), the
 * layer set from the stored `map-layer-sets` dataset (FakeMapLayerSetRepository,
 * seeded with its fixture), and the time from a fake Clock, so the activation
 * read and the window check see the same instant (move-editorial-datasets D6).
 *
 * No live activation reads no layer set. A live one serves its set from the
 * dataset, and a push serves within the dataset TTL. The cases worth having
 * are the ones that are NOT "no festival today": an activation naming a set
 * the dataset lacks, one whose set was left out as invalid, and a dataset
 * that was never read. Each answers null without failing the request, so the
 * base map serves, and says so in the log: the unservable activation once per
 * activation and revision (a warn per request at the map's rate limit would
 * bury the one line that matters), the unavailable dataset at error, at most
 * once a minute. Then the origin cache over the activation read:
 * single-flight, the TTL, the window closing on time, and the stale window
 * that covers a database blip.
 *
 * The dataset loader's cache reads `Date.now()`, so its TTL is crossed with
 * Jest's fake system time.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { FakeMapLayerSetRepository } from "../../../__tests__/helpers/fakes/map/map-layer-set.repository.fake";
import { FakeMapRepository } from "../../../__tests__/helpers/fakes/map/map.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { fixtureLayerSets } from "../../../__tests__/helpers/map/layer-sets-fixture";
import type { Clock } from "../../infra/clock";
import { DATASET_CACHE_TTL_MS } from "../../shared/dataset.constants";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import type { LiveActivation } from "../map.document";
import type { MapRepository } from "../map.repository";
import type { MapLayerSetRepository } from "./map-layer-set.repository";
import { MapLayerSetService } from "./map-layer-set.service";
import { fixtureMiniappsService } from "../../../__tests__/helpers/miniapps/registry-fixture";

const NOW = new Date("2026-09-16T09:00:00.000Z");
const mockFindActiveActivation = jest.fn<Promise<LiveActivation | null>, [Date]>();
const activation = (id: string): LiveActivation => ({ _id: id, activeUntil: null });
const warnsOf = (event: string) => mockLogger.warn.mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);
const errorsOf = (event: string) => mockLogger.error.mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

let now = NOW;
const fakeClock: Clock = { now: () => now };

/** The fixture's eskara-2026 set, renamed, with a chip naming a layer it does not define. */
function badSet(layerSetId: string): Record<string, any> {
  const set = fixtureLayerSets().layerSets[0] as Record<string, any>;
  set.layerSetId = layerSetId;
  set.chips[0].layerIds = ["nope"];
  return set;
}

// The activation read and the layer sets are cached per service; each test starts cold.
let service: MapLayerSetService;
let layerSets: FakeMapLayerSetRepository;
/** The live layer set as the service answers at `at`. */
const activeEventAt = (at: Date) => {
  now = at;
  return service.liveLayerSet();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindActiveActivation.mockReset();
  now = NOW;
  const repository = new FakeMapRepository();
  repository.findActiveActivation = mockFindActiveActivation;
  layerSets = new FakeMapLayerSetRepository();
  layerSets.storeLayerSets(fixtureLayerSets());
  service = new MapLayerSetService(asReal<MapRepository>(repository), asReal<MapLayerSetRepository>(layerSets), fakeClock, fixtureMiniappsService());
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MapLayerSetService.liveLayerSet", () => {
  it("is null when no activation is live, reads no layer set, and says nothing", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(null);

    // Act & Assert
    await expect(activeEventAt(NOW)).resolves.toBeNull();
    expect(layerSets.readCount).toBe(0);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns the stored set a live activation names", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));

    // Act
    const config = await activeEventAt(NOW);

    // Assert
    expect(config?.layerSetId).toBe("eskara-2026");
    expect(config?.chips.map((chip) => chip.id)).toEqual((fixtureLayerSets().layerSets[0] as { chips: Array<{ id: string }> }).chips.map((chip) => chip.id));
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("serves a pushed revision once the dataset TTL has passed, and the old one until then", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));
    await activeEventAt(NOW);
    const pushed = fixtureLayerSets();
    (pushed.layerSets[0] as { emoji: string }).emoji = "🎆";
    layerSets.storeLayerSets(pushed);

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const before = await activeEventAt(NOW);
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const after = await activeEventAt(NOW);

    // Assert
    expect(before?.emoji).toBe("🌊");
    expect(after?.emoji).toBe("🎆");
  });

  it("is null for a set the dataset lacks, warning once per activation and revision", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2099"));

    // Act
    for (let read = 0; read < 3; read++) await expect(activeEventAt(NOW)).resolves.toBeNull();
    layerSets.storeLayerSets(fixtureLayerSets());
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    await expect(activeEventAt(NOW)).resolves.toBeNull();

    // Assert
    expect(warnsOf("map.eventmap.activation_unservable")).toEqual([
      expect.objectContaining({ activationId: "eskara-2099", reason: "no_layer_set", revision: 1 }),
      expect.objectContaining({ activationId: "eskara-2099", reason: "no_layer_set", revision: 2 }),
    ]);
  });

  it("is null for a set left out as invalid, naming its issues", async () => {
    // Arrange
    layerSets.storeLayerSets({ layerSets: [...fixtureLayerSets().layerSets, badSet("eskara-2077")] });
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2077"));

    // Act & Assert
    await expect(activeEventAt(NOW)).resolves.toBeNull();
    await expect(activeEventAt(NOW)).resolves.toBeNull();

    expect(warnsOf("map.eventmap.activation_unservable")).toEqual([
      expect.objectContaining({ activationId: "eskara-2077", reason: "layer_set_rejected", revision: 2, issues: ['chips: chip "eskara26_view_bar": "nope" is not a layer'] }),
    ]);
  });

  it("keeps serving the other sets when one is left out", async () => {
    // Arrange
    layerSets.storeLayerSets({ layerSets: [badSet("eskara-2077"), ...fixtureLayerSets().layerSets] });
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));

    // Act
    const config = await activeEventAt(NOW);

    // Assert
    expect(config?.layerSetId).toBe("eskara-2026");
  });

  it.each([
    ["missing", (store: FakeMapLayerSetRepository) => store.datasets.clear()],
    ["unreadable", (store: FakeMapLayerSetRepository) => { store.failWith = new Error("server selection timed out"); }],
    ["invalid", (store: FakeMapLayerSetRepository) => { store.datasets.set("map-layer-sets", { revision: 1, data: { layerSets: {} } }); }],
  ])("is null for a live activation when the dataset was never read (%s), logged at error at most once a minute", async (_case, breakStore) => {
    // Arrange
    breakStore(layerSets);
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));

    // Act
    for (let read = 0; read < 3; read++) await expect(activeEventAt(NOW)).resolves.toBeNull();
    await expect(activeEventAt(new Date(NOW.getTime() + 60_000))).resolves.toBeNull();

    // Assert
    expect(errorsOf("map.layer_sets.unavailable")).toEqual([
      expect.objectContaining({ activationId: "eskara-2026", suppressed: 0 }),
      expect.objectContaining({ activationId: "eskara-2026", suppressed: 2 }),
    ]);
    expect(warnsOf("map.eventmap.activation_unservable")).toEqual([]);
  });
});

describe("MapLayerSetService.liveLayerSet — origin cache", () => {
  let clock = NOW.getTime();
  beforeEach(() => {
    clock = NOW.getTime();
    jest.spyOn(Date, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the activation once for concurrent callers", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));

    // Act
    await Promise.all([activeEventAt(NOW), activeEventAt(NOW), activeEventAt(NOW)]);

    // Assert
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);
  });

  it("re-reads only once the TTL has passed", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));

    // Act & Assert
    await activeEventAt(NOW);
    clock += EVENT_CACHE_TTL_MS - 1;
    await activeEventAt(NOW);
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);
    clock += 1;
    await activeEventAt(NOW);
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(2);
  });

  it("closes a cached activation's window on time, without another read", async () => {
    // Arrange
    const until = new Date(NOW.getTime() + 1_000);
    mockFindActiveActivation.mockResolvedValue({
      ...activation("eskara-2026"),
      activeUntil: until,
    });

    // Act & Assert
    await expect(activeEventAt(NOW)).resolves.not.toBeNull();
    await expect(activeEventAt(until)).resolves.toBeNull();
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);
  });

  it("keeps the festival through a failed re-read, and says so", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValueOnce(activation("eskara-2026"));
    await activeEventAt(NOW);
    mockFindActiveActivation.mockRejectedValue(new Error("pool wait timed out"));
    clock += EVENT_CACHE_TTL_MS;

    // Act
    const config = await activeEventAt(NOW);
    // The expired activation answers at once; the failed reload logs behind it.
    await new Promise((resolve) => setImmediate(resolve));

    // Assert
    expect(config?.layerSetId).toBe("eskara-2026");
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({
      event: "cache.reload_failed",
      cache: "event activation",
    });
  });

  it("stops covering for the database past the stale window", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValueOnce(activation("eskara-2026"));
    await activeEventAt(NOW);
    mockFindActiveActivation.mockRejectedValue(new Error("down"));
    clock += EVENT_CACHE_TTL_MS + EVENT_STALE_WINDOW_MS;

    // Act & Assert
    await expect(activeEventAt(NOW)).rejects.toThrow("down");
  });

  it("never holds a request on a slow re-read inside the window", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValueOnce(activation("eskara-2026"));
    await activeEventAt(NOW);
    // A database that never answers: the old activation still answers now.
    mockFindActiveActivation.mockReturnValue(new Promise(() => undefined));
    clock += EVENT_CACHE_TTL_MS;

    // Act
    const config = await activeEventAt(NOW);

    // Assert
    expect(config?.layerSetId).toBe("eskara-2026");
  });
});
