/**
 * UiCampusService over an in-memory dataset store, the real mini app registry
 * and a fixed clock (ADR 0013, D6; move-editorial-datasets D4): the campus
 * sheet is built from the stored `campus-banners` dataset, cached for
 * DATASET_CACHE_TTL_MS so a push serves within a minute, kept through an
 * invalid reload, and unavailable (503) when no good banners were ever read.
 * A banner whose action names a mini app the registry no longer holds is left
 * out and logged once per revision; a carousel left with no banner is left out
 * as one whose every banner has closed.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake
 * system time; the mapper's clock stays the injected one.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import fs from "fs";
import path from "path";
import { FakeUiCampusRepository } from "../../../__tests__/helpers/fakes/ui/ui-campus.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { fixtureMiniappsService } from "../../../__tests__/helpers/miniapps/registry-fixture";
import { DATASET_CACHE_TTL_MS } from "../../shared/dataset.constants";
import type { UiCampusRepository } from "./ui-campus.repository";
import { UiCampusService } from "./ui-campus.service";
import type { CampusSheet } from "./ui-campus.wire";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) =>
  mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

const IMAGE_URL = "https://media.skkuverse.com/campus/banners/test-00000000.webp";

function image(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "image", id, imageUrl: IMAGE_URL, alt: { ko: "현수막", en: "Banner" }, ...overrides };
}

function carousel(...items: Array<Record<string, unknown>>): Record<string, unknown> {
  return { type: "banner_carousel", id: "campus_banners", aspectRatio: 6, autoRotateSec: 4, items };
}

// Revision 1 of the campus-banners dataset: every banner closed on 2026-10-03.
function fixtureBanners(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/ui/fixtures/campus-banners.dataset.json"), "utf8")) as Record<string, unknown>;
  delete fixture._about;
  return fixture;
}

const bannerIdsOf = (sheet: CampusSheet) => sheet.sections.flatMap((section) => section.items.map((item) => ("id" in item ? item.id : item.type)));

let repository: FakeUiCampusRepository;
let service: UiCampusService;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new FakeUiCampusRepository();
  service = new UiCampusService(asReal<UiCampusRepository>(repository), fixtureMiniappsService(), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("UiCampusService.getCampusSheet", () => {
  it("serves the stored banners in the request's language", async () => {
    // Arrange
    repository.storeCampusBanners(carousel(image("a"), image("b")));

    // Act
    const sheet = await service.getCampusSheet("en");

    // Assert
    expect(sheet).toEqual({
      minAppVersion: "2.0.0",
      sections: [
        {
          type: "banner_carousel",
          id: "campus_banners",
          aspectRatio: 6,
          autoRotateSec: 4,
          items: [
            { type: "image", id: "a", imageUrl: IMAGE_URL, alt: "Banner" },
            { type: "image", id: "b", imageUrl: IMAGE_URL, alt: "Banner" },
          ],
        },
      ],
    });
  });

  it("serves no section for revision 1, whose every banner has closed", async () => {
    // Arrange
    repository.storeCampusBanners(fixtureBanners());

    // Act & Assert
    expect(await service.getCampusSheet("ko")).toEqual({ minAppVersion: "2.0.0", sections: [] });
  });

  it("serves a pushed revision once the TTL has passed, and not before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeCampusBanners(carousel(image("a")));
    await service.getCampusSheet("ko");
    repository.storeCampusBanners(carousel(image("a"), image("b")));

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.getCampusSheet("ko");
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.getCampusSheet("ko");

    // Assert
    expect(bannerIdsOf(beforeTtl)).toEqual(["a"]);
    expect(bannerIdsOf(atTtl)).toEqual(["a", "b"]);
  });

  it("keeps serving the good revision when the next one fails its schema", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeCampusBanners(carousel(image("a")));
    const good = await service.getCampusSheet("ko");
    repository.storeCampusBanners({ ...carousel(image("b")), extra: 1 });

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const served = await service.getCampusSheet("ko");

    // Assert
    expect(served).toEqual(good);
  });

  it("answers CAMPUS_BANNERS_UNAVAILABLE (503) on a first read that finds nothing", async () => {
    // Act & Assert
    await expect(service.getCampusSheet("ko")).rejects.toMatchObject({ code: "CAMPUS_BANNERS_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers CAMPUS_BANNERS_UNAVAILABLE (503) on a first read that fails, logging the failure", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    repository.failWith = failure;

    // Act & Assert
    await expect(service.getCampusSheet("ko")).rejects.toMatchObject({ code: "CAMPUS_BANNERS_UNAVAILABLE", httpStatus: 503 });
    expect(callsOf("error", "ui.campus_banners.read_failed")).toEqual([expect.objectContaining({ err: failure })]);
  });

  it("leaves out a banner whose mini app is unregistered, and serves the rest", async () => {
    // Arrange
    repository.storeCampusBanners(carousel(image("a"), image("gone", { actionType: "miniapp", actionValue: "removed-by-a-deploy" }), image("c")));

    // Act
    const sheet = await service.getCampusSheet("ko");

    // Assert
    expect(bannerIdsOf(sheet)).toEqual(["a", "c"]);
  });

  it("leaves the carousel out when its only banner is left out", async () => {
    // Arrange
    repository.storeCampusBanners(carousel(image("gone", { actionType: "miniapp", actionValue: "removed-by-a-deploy" })));

    // Act & Assert
    expect(await service.getCampusSheet("ko")).toEqual({ minAppVersion: "2.0.0", sections: [] });
  });

  it("logs each left-out banner at error once per revision, however often it reloads", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const stale = carousel(image("a"), image("gone", { actionType: "miniapp", actionValue: "removed-by-a-deploy" }));
    repository.storeCampusBanners(stale);

    // Act
    for (let reload = 0; reload < 3; reload++) {
      jest.setSystemTime(NOW.getTime() + reload * DATASET_CACHE_TTL_MS);
      await service.getCampusSheet("ko");
    }
    repository.storeCampusBanners(stale);
    jest.setSystemTime(NOW.getTime() + 3 * DATASET_CACHE_TTL_MS);
    await service.getCampusSheet("ko");

    // Assert
    expect(repository.readCount).toBe(4);
    expect(callsOf("error", "ui.campus_banners.item_left_out")).toEqual([
      expect.objectContaining({ revision: 1, path: "items.1.actionValue" }),
      expect.objectContaining({ revision: 2, path: "items.1.actionValue" }),
    ]);
  });
});
