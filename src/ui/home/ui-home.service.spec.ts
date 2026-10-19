/**
 * UiHomeService over an in-memory dataset store, the real mini app registry
 * and a fixed clock (ADR 0013, D6; move-runtime-data-to-db D7): the home
 * layout is read from the stored `home-layout` dataset, cached for
 * DATASET_CACHE_TTL_MS so a push serves within a minute, kept through a failed
 * or invalid reload inside DATASET_STALE_WINDOW_MS, and unavailable (503) when
 * no good layout was ever read. An item that names a mini app the registry no
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
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import type { UiHomeRepository } from "./ui-home.repository";
import { UiHomeService } from "./ui-home.service";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) =>
  mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

// The committed home-layout.json, kept as the fixture the dataset is seeded from.
const DATASET_FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/home-layout.dataset.json");

function committedLayout(): Record<string, unknown> {
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
  service = new UiHomeService(asReal<UiHomeRepository>(repository), new MiniappsService(), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("UiHomeService.getHomeLayout", () => {
  it("serves the stored layout in the request's language", async () => {
    // Arrange
    repository.storeHomeLayout(committedLayout());

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
    repository.storeHomeLayout(committedLayout());
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
    repository.storeHomeLayout({ ...committedLayout(), extra: 1 });

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
