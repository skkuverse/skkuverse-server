/**
 * UiHomeService over an in-memory dataset store, the real mini app registry
 * and a fixed clock (ADR 0013, D6; move-runtime-data-to-db D7): the home
 * layout is read from the stored `home-layout` dataset, cached for
 * DATASET_CACHE_TTL_MS so a push serves within a minute, kept through a failed
 * or invalid reload inside DATASET_STALE_WINDOW_MS, and unavailable (503) when
 * no good layout was ever read, remembered for one TTL so a missing layout is
 * read once a minute, and a fault in this code is not turned into one. An item that names a mini app the registry no
 * longer holds is left out and logged once per revision.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake
 * system time; the mapper's clock stays the injected one.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import fs from "fs";
import path from "path";
import { FakeUiHomeRepository } from "../../../__tests__/helpers/fakes/ui/ui-home.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { fixtureMiniappsService, fixtureRegistryRepository } from "../../../__tests__/helpers/miniapps/registry-fixture";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import type { UiHomeRepository } from "./ui-home.repository";
import { UiHomeService } from "./ui-home.service";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) =>
  mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

// A copy of revision 1 of the stored home-layout dataset as of 2026-10-19.
const DATASET_FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/home-layout.dataset.json");

function storedLayout(): Record<string, unknown> {
  const layout = JSON.parse(fs.readFileSync(DATASET_FIXTURE, "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

const grid = (...tiles: Array<Record<string, unknown>>) => ({ type: "tile_grid", id: "home_tiles", tiles });
const layoutOf = (...sections: Array<Record<string, unknown>>) => ({ version: 1, sections });
const tileIdsOf = (layout: { sections: Array<{ type: string; tiles?: Array<{ id: string }> }> }) =>
  layout.sections.flatMap((section) => section.tiles?.map((tile) => tile.id) ?? []);

let repository: FakeUiHomeRepository;
let service: UiHomeService;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new FakeUiHomeRepository();
  service = new UiHomeService(asReal<UiHomeRepository>(repository), fixtureMiniappsService(), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("UiHomeService.getHomeLayout", () => {
  it("serves the stored layout in the request's language", async () => {
    // Arrange
    repository.storeHomeLayout(storedLayout());

    // Act
    const layout = await service.getHomeLayout("en");

    // Assert
    expect(layout.version).toBe(1);
    expect(layout.sections.map((section) => section.id)).toEqual(["home_top", "home_tiles"]);
    expect(tileIdsOf(layout)).toEqual(["building_map", "building_code", "lost_found", "inquiry", "subway-typing", "wave-run"]);
    expect(layout.sections[1]).toMatchObject({ tiles: [{ title: "Building Map" }, {}, {}, {}, {}, {}] });
  });

  it("serves a pushed revision once the TTL has passed, and not before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeHomeLayout(layoutOf(grid({ kind: "game", id: "wave-run" })));
    await service.getHomeLayout("ko");
    repository.storeHomeLayout(layoutOf(grid({ kind: "game", id: "wave-run" }, { kind: "game", id: "subway-typing" })));

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.getHomeLayout("ko");
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.getHomeLayout("ko");

    // Assert
    expect(tileIdsOf(beforeTtl)).toEqual(["wave-run"]);
    expect(tileIdsOf(atTtl)).toEqual(["wave-run", "subway-typing"]);
  });

  it("bounds a push to one minute and an outage to a day", () => {
    // Act & Assert
    expect(DATASET_CACHE_TTL_MS).toBe(60_000);
    expect(DATASET_STALE_WINDOW_MS).toBe(24 * 60 * 60_000);
  });

  it("serves the last layout through failed reloads inside the stale window, logging each", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeHomeLayout(storedLayout());
    const earlier = await service.getHomeLayout("ko");
    repository.failWith = new Error("server selection timed out");

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.getHomeLayout("ko");
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS + DATASET_STALE_WINDOW_MS - 1);
    const atWindowEnd = await service.getHomeLayout("ko");

    // Assert
    expect(atTtl).toEqual(earlier);
    expect(atWindowEnd).toEqual(earlier);
    expect(callsOf("warn", "cache.reload_failed")).toHaveLength(2);
  });

  it("keeps serving the good revision when the next one fails its schema", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeHomeLayout(layoutOf(grid({ kind: "game", id: "wave-run" })));
    const good = await service.getHomeLayout("ko");
    repository.storeHomeLayout({ ...layoutOf(grid({ kind: "game", id: "subway-typing" })), extra: 1 });

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const served = await service.getHomeLayout("ko");

    // Assert
    expect(served).toEqual(good);
  });

  it("answers HOME_LAYOUT_UNAVAILABLE (503) on a first read that finds no layout", async () => {
    // Act & Assert
    await expect(service.getHomeLayout("ko")).rejects.toMatchObject({ code: "HOME_LAYOUT_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers HOME_LAYOUT_UNAVAILABLE (503) on a first read that finds an invalid layout", async () => {
    // Arrange
    repository.storeHomeLayout({ ...storedLayout(), extra: 1 });

    // Act & Assert
    await expect(service.getHomeLayout("ko")).rejects.toMatchObject({ code: "HOME_LAYOUT_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers HOME_LAYOUT_UNAVAILABLE (503) on a first read that fails, logging the failure", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    repository.failWith = failure;

    // Act & Assert
    await expect(service.getHomeLayout("ko")).rejects.toMatchObject({ code: "HOME_LAYOUT_UNAVAILABLE", httpStatus: 503 });
    expect(callsOf("error", "ui.home_layout.read_failed")).toEqual([expect.objectContaining({ err: failure })]);
  });

  it("leaves out an unregistered mini app's tile and serves the rest of the grid", async () => {
    // Arrange
    repository.storeHomeLayout(layoutOf(grid({ kind: "miniapp", id: "nope" }, { kind: "game", id: "wave-run" })));

    // Act
    const layout = await service.getHomeLayout("ko");

    // Assert
    expect(tileIdsOf(layout)).toEqual(["wave-run"]);
  });

  it("logs each left-out item at error once per revision, however often it reloads", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const stale = layoutOf(grid({ kind: "miniapp", id: "nope" }, { kind: "game", id: "wave-run" }));
    repository.storeHomeLayout(stale);

    // Act
    for (let reload = 0; reload < 3; reload++) {
      jest.setSystemTime(NOW.getTime() + reload * DATASET_CACHE_TTL_MS);
      await service.getHomeLayout("ko");
    }
    repository.storeHomeLayout(stale);
    jest.setSystemTime(NOW.getTime() + 3 * DATASET_CACHE_TTL_MS);
    await service.getHomeLayout("ko");

    // Assert
    expect(repository.readCount).toBe(4);
    expect(callsOf("error", "ui.home_layout.item_left_out")).toEqual([
      expect.objectContaining({ revision: 1, path: "sections.0.tiles.0.id" }),
      expect.objectContaining({ revision: 2, path: "sections.0.tiles.0.id" }),
    ]);
  });
});

describe("UiHomeService.getHomeLayout with no good layout", () => {
  // WHY: the unavailable state is timed by the injected clock, the loader by the system time; both move together here.
  let at = NOW;
  const movingClock: Clock = { now: () => at };
  const moveTo = (ms: number) => {
    at = new Date(ms);
    jest.setSystemTime(ms);
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    at = NOW;
    service = new UiHomeService(asReal<UiHomeRepository>(repository), fixtureMiniappsService(), movingClock);
  });

  it("reads a missing layout at most once per TTL, answering 503 in between", async () => {
    // Act
    const answers: unknown[] = [];
    for (let request = 0; request < 5; request++) {
      moveTo(NOW.getTime() + request * 1_000);
      answers.push(await service.getHomeLayout("ko").catch((err: unknown) => err));
    }
    const readsInFirstTtl = repository.readCount;
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS);
    await service.getHomeLayout("ko").catch(() => undefined);

    // Assert
    expect(answers).toEqual(Array(5).fill(expect.objectContaining({ code: "HOME_LAYOUT_UNAVAILABLE", httpStatus: 503 })));
    expect(readsInFirstTtl).toBe(1);
    expect(repository.readCount).toBe(2);
  });

  it("serves a layout pushed while it was unavailable within one TTL", async () => {
    // Arrange
    await service.getHomeLayout("ko").catch(() => undefined);
    repository.storeHomeLayout(layoutOf(grid({ kind: "game", id: "wave-run" })));

    // Act
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.getHomeLayout("ko").catch((err: unknown) => err);
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.getHomeLayout("ko");

    // Assert
    expect(beforeTtl).toMatchObject({ code: "HOME_LAYOUT_UNAVAILABLE", httpStatus: 503 });
    expect(tileIdsOf(atTtl)).toEqual(["wave-run"]);
  });

  it("logs one read_failed for one failed read, however many requests waited on it", async () => {
    // Arrange
    repository.failWith = new Error("server selection timed out");

    // Act
    const answers = await Promise.allSettled(Array.from({ length: 5 }, () => service.getHomeLayout("ko")));

    // Assert
    expect(answers.every((answer) => answer.status === "rejected")).toBe(true);
    expect(callsOf("error", "ui.home_layout.read_failed")).toHaveLength(1);
  });

  it("counts failed reads, not the requests that waited on them, in a later read_failed's suppressed", async () => {
    // Arrange
    repository.failWith = new Error("server selection timed out");
    const fiveRequests = () => Promise.allSettled(Array.from({ length: 5 }, () => service.getHomeLayout("ko")));

    // Act
    await fiveRequests();
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS);
    await fiveRequests();

    // Assert
    expect(callsOf("error", "ui.home_layout.read_failed")).toEqual([
      expect.objectContaining({ suppressed: 0 }),
      expect.objectContaining({ suppressed: 0 }),
    ]);
  });

  it("lets a fault in this code reach the exception filter as itself, not as a 503", async () => {
    // Arrange
    const fault = new TypeError("cannot read properties of undefined");
    class FaultyMiniapps extends MiniappsService {
      override isRegistered(): boolean {
        throw fault;
      }
    }
    service = new UiHomeService(asReal<UiHomeRepository>(repository), new FaultyMiniapps(fixtureRegistryRepository(), movingClock), movingClock);
    repository.storeHomeLayout(layoutOf(grid({ kind: "miniapp", id: "eskara" })));

    // Act & Assert
    await expect(service.getHomeLayout("ko")).rejects.toBe(fault);
    expect(callsOf("error", "ui.home_layout.read_failed")).toEqual([]);
  });
});
