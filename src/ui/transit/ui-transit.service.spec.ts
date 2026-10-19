/**
 * UiTransitService, the stored transit layout's door, over an in-memory
 * dataset store and the real mini app registry (ADR 0013, D6;
 * move-editorial-datasets D5). It reads the `transit-layout` dataset through
 * createDatasetLoader, so a push serves after DATASET_CACHE_TTL_MS, an invalid
 * reload keeps the last good layout, and a layout never read answers 503
 * TRANSIT_LAYOUT_UNAVAILABLE. Against the bus groups and stations its caller
 * serves, it leaves out each item that names one not served or a link that no
 * longer resolves (`ui.transit_layout.item_left_out`), and logs each served
 * one the layout does not place (`ui.transit_layout.unplaced`) without adding
 * it, each once per revision.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake
 * system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeUiTransitRepository } from "../../../__tests__/helpers/fakes/ui/ui-transit.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { DATASET_CACHE_TTL_MS } from "../../shared/dataset.constants";
import type { UiTransitRepository } from "./ui-transit.repository";
import type { TransitLayoutRaw } from "./ui-transit.schema";
import { UiTransitService } from "./ui-transit.service";
import { toTransitItemId } from "./ui-transit.rules";

const NOW = new Date("2026-10-20T03:00:00.000Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (event: string) => mockedLogger.error.mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

const SERVED = { busGroupIds: ["campus", "hssc"], stationIds: ["hyehwa"] };
const LINK = { kind: "link", id: "taxi-share", title: { ko: "택시 합승" }, icon: { type: "taxi", color: "FFB300", text: { ko: "택시" } }, actionType: "miniapp", actionValue: "inja" };

function layoutOf(...items: unknown[]): Record<string, unknown> {
  return { version: 1, sections: [{ type: "item_list", id: "campus", items }] };
}

const PLACED = [{ kind: "bus", groupId: "campus" }, { kind: "bus", groupId: "hssc" }, { kind: "subway", stationId: "hyehwa" }];
const itemIdsOf = (layout: TransitLayoutRaw) => layout.sections.map((section) => section.items.map(toTransitItemId));

let repository: FakeUiTransitRepository;
let service: UiTransitService;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new FakeUiTransitRepository();
  service = new UiTransitService(asReal<UiTransitRepository>(repository), new MiniappsService(), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("UiTransitService.getStoredLayout", () => {
  it("serves the stored layout whole when it names only what is served", async () => {
    // Arrange
    repository.storeTransitLayout(layoutOf(...PLACED, LINK));

    // Act
    const layout = await service.getStoredLayout(SERVED);

    // Assert
    expect(itemIdsOf(layout)).toEqual([["bus:campus", "bus:hssc", "subway:hyehwa", "taxi-share"]]);
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  it("leaves out an item naming a group, a station or a mini app that is not served, and serves the rest", async () => {
    // Arrange
    repository.storeTransitLayout(layoutOf({ kind: "bus", groupId: "night" }, ...PLACED, { kind: "subway", stationId: "seoul" }, { ...LINK, actionValue: "removed-by-a-deploy" }));

    // Act
    const layout = await service.getStoredLayout(SERVED);

    // Assert
    expect(itemIdsOf(layout)).toEqual([["bus:campus", "bus:hssc", "subway:hyehwa"]]);
    expect(callsOf("ui.transit_layout.item_left_out").map((fields) => fields.path)).toEqual([
      "sections.0.items.0.groupId",
      "sections.0.items.4.stationId",
      "sections.0.items.5.actionValue",
    ]);
  });

  it("logs a served group the layout does not place as unplaced, and does not add it", async () => {
    // Arrange
    repository.storeTransitLayout(layoutOf(...PLACED));

    // Act
    const layout = await service.getStoredLayout({ ...SERVED, busGroupIds: [...SERVED.busGroupIds, "night"] });

    // Assert
    expect(itemIdsOf(layout)).toEqual([["bus:campus", "bus:hssc", "subway:hyehwa"]]);
    expect(callsOf("ui.transit_layout.unplaced")).toEqual([expect.objectContaining({ revision: 1, reason: 'bus group "night" is not placed' })]);
    expect(callsOf("ui.transit_layout.item_left_out")).toEqual([]);
  });

  it("logs each issue once per revision, however often it is asked or reloads", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const stale = layoutOf(...PLACED, { kind: "bus", groupId: "night" });
    repository.storeTransitLayout(stale);

    // Act
    for (let reload = 0; reload < 3; reload++) {
      jest.setSystemTime(NOW.getTime() + reload * DATASET_CACHE_TTL_MS);
      await service.getStoredLayout(SERVED);
      await service.getStoredLayout(SERVED);
    }
    repository.storeTransitLayout(stale);
    jest.setSystemTime(NOW.getTime() + 3 * DATASET_CACHE_TTL_MS);
    await service.getStoredLayout(SERVED);

    // Assert
    expect(repository.readCount).toBe(4);
    expect(callsOf("ui.transit_layout.item_left_out")).toEqual([
      expect.objectContaining({ revision: 1, path: "sections.0.items.3.groupId" }),
      expect.objectContaining({ revision: 2, path: "sections.0.items.3.groupId" }),
    ]);
  });

  it("serves a pushed revision once the TTL has passed, and not before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeTransitLayout(layoutOf(...PLACED));
    await service.getStoredLayout(SERVED);
    repository.storeTransitLayout(layoutOf(...[...PLACED].reverse()));

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.getStoredLayout(SERVED);
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.getStoredLayout(SERVED);

    // Assert
    expect(itemIdsOf(beforeTtl)).toEqual([["bus:campus", "bus:hssc", "subway:hyehwa"]]);
    expect(itemIdsOf(atTtl)).toEqual([["subway:hyehwa", "bus:hssc", "bus:campus"]]);
  });

  it("keeps serving the good revision when the next one fails its schema", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeTransitLayout(layoutOf(...PLACED));
    const good = await service.getStoredLayout(SERVED);
    repository.storeTransitLayout({ ...layoutOf(...PLACED), extra: 1 });

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const served = await service.getStoredLayout(SERVED);

    // Assert
    expect(served).toEqual(good);
  });

  it("answers TRANSIT_LAYOUT_UNAVAILABLE (503) on a first read that finds nothing", async () => {
    // Act & Assert
    await expect(service.getStoredLayout(SERVED)).rejects.toMatchObject({ code: "TRANSIT_LAYOUT_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers TRANSIT_LAYOUT_UNAVAILABLE (503) on a first read that fails, logging the failure", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    repository.failWith = failure;

    // Act & Assert
    await expect(service.getStoredLayout(SERVED)).rejects.toMatchObject({ code: "TRANSIT_LAYOUT_UNAVAILABLE", httpStatus: 503 });
    expect(callsOf("ui.transit_layout.read_failed")).toEqual([expect.objectContaining({ err: failure })]);
  });
});
