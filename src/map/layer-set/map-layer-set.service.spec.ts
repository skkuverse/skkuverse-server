/**
 * MapLayerSetService.activeEventConfig: "Which layer set is live, and is its
 * config usable?" — the one answer both `/map/config` and the event routes read.
 *
 * The cases worth having are the two that are NOT "no festival today": an
 * activation naming a layer set this build has no file for, and one whose file
 * failed validation. Both must answer null without failing the request, and
 * both must say so in the log exactly once — a warn per request at the map's
 * rate limit would bury the one line that matters. Then the origin cache over
 * the activation read: single-flight, the TTL, the window closing on time, and
 * the stale window that covers a database blip.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

const actualConfigModule = jest.requireActual("./map-layer-set.config");
const getLayerSetConfig = jest.fn(actualConfigModule.getLayerSetConfig);
jest.mock("./map-layer-set.config", () => ({
  ...actualConfigModule,
  getLayerSetConfig: (...args: unknown[]) => getLayerSetConfig(...args),
}));

import { FakeMapRepository } from "../../../__tests__/helpers/fakes/map/map.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { Clock } from "../../infra/clock";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import type { ActivationDoc } from "../map.document";
import type { MapRepository } from "../map.repository";
import { MapLayerSetService } from "./map-layer-set.service";

const NOW = new Date("2026-09-16T09:00:00.000Z");
const mockFindActiveActivation = jest.fn<Promise<ActivationDoc | null>, [Date]>();
const activation = (id: string) => ({ _id: id }) as ActivationDoc;

// The activation read is cached per service; each test starts cold.
let service: MapLayerSetService;
const activeEventConfig = (now: Date) => service.activeEventConfig(now);

beforeEach(() => {
  jest.clearAllMocks();
  mockFindActiveActivation.mockReset();
  getLayerSetConfig.mockImplementation(actualConfigModule.getLayerSetConfig);
  const repository = new FakeMapRepository();
  repository.findActiveActivation = mockFindActiveActivation;
  service = new MapLayerSetService(asReal<MapRepository>(repository), new Clock());
});

describe("activeEventConfig", () => {
  it("is null when no activation is live, and says nothing", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(null);

    // Act & Assert
    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("returns the loaded config for a live layer set this build knows", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));

    // Act
    const config = await activeEventConfig(NOW);

    // Assert
    expect(config?.layerSetId).toBe("eskara-2026");
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("is null for a layer set with no config file, warning ONCE per process", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2099"));

    // Act & Assert
    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    await expect(activeEventConfig(NOW)).resolves.toBeNull();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({
      event: "map.eventmap.activation_unservable",
      activationId: "eskara-2099",
      reason: "no_config_in_build",
    });
  });

  it("is null for a layer set whose config was rejected, naming the rejection", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2077"));
    getLayerSetConfig.mockReturnValue({
      config: null,
      configHash: null,
      error: 'config.itemDefaults.fallback.layerId "nope" is not in config.layers',
    });

    // Act & Assert
    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    await expect(activeEventConfig(NOW)).resolves.toBeNull();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({
      activationId: "eskara-2077",
      reason: "config_rejected",
      configError: expect.stringMatching(/layerId "nope"/),
    });
  });
});

describe("activeEventConfig — origin cache", () => {
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
    await Promise.all([activeEventConfig(NOW), activeEventConfig(NOW), activeEventConfig(NOW)]);

    // Assert
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);
  });

  it("re-reads only once the TTL has passed", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));

    // Act & Assert
    await activeEventConfig(NOW);
    clock += EVENT_CACHE_TTL_MS - 1;
    await activeEventConfig(NOW);
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);
    clock += 1;
    await activeEventConfig(NOW);
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(2);
  });

  it("closes a cached activation's window on time, without another read", async () => {
    // Arrange
    const until = new Date(NOW.getTime() + 1_000);
    mockFindActiveActivation.mockResolvedValue({
      ...activation("eskara-2026"),
      activeUntil: until,
    } as ActivationDoc);

    // Act & Assert
    await expect(activeEventConfig(NOW)).resolves.not.toBeNull();
    await expect(activeEventConfig(until)).resolves.toBeNull();
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);
  });

  it("keeps the festival through a failed re-read, and says so", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValueOnce(activation("eskara-2026"));
    await activeEventConfig(NOW);
    mockFindActiveActivation.mockRejectedValue(new Error("pool wait timed out"));
    clock += EVENT_CACHE_TTL_MS;

    // Act
    const config = await activeEventConfig(NOW);
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
    await activeEventConfig(NOW);
    mockFindActiveActivation.mockRejectedValue(new Error("down"));
    clock += EVENT_CACHE_TTL_MS + EVENT_STALE_WINDOW_MS;

    // Act & Assert
    await expect(activeEventConfig(NOW)).rejects.toThrow("down");
  });

  it("never holds a request on a slow re-read inside the window", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValueOnce(activation("eskara-2026"));
    await activeEventConfig(NOW);
    // A database that never answers: the old activation still answers now.
    mockFindActiveActivation.mockReturnValue(new Promise(() => undefined));
    clock += EVENT_CACHE_TTL_MS;

    // Act
    const config = await activeEventConfig(NOW);

    // Assert
    expect(config?.layerSetId).toBe("eskara-2026");
  });
});
