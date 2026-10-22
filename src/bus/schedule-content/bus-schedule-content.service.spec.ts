/**
 * BusScheduleContentService over an in-memory dataset store and a fixed clock
 * (ADR 0013, D6): the editorial content each
 * shuttle timetable folds in, read from the stored `bus-service-notices` and
 * `skku-rest-days` datasets, each cached for DATASET_CACHE_TTL_MS so a push serves within a minute,
 * kept through a failed or invalid reload, and unavailable (503) when no good
 * value of either was ever read. `current()` answers one snapshot: each
 * service's notices and suspension, SKKU's rest days, and the revision key,
 * folding both revisions, that a cache derived from it is keyed by. A service the dataset leaves out has neither; a stored id the code
 * does not define is ignored and logged once per revision.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake
 * system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import fs from "fs";
import path from "path";
import { restDaysFixture } from "../../../__tests__/helpers/bus/schedule-content";
import { FakeBusScheduleContentRepository } from "../../../__tests__/helpers/fakes/bus/bus-schedule-content.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS } from "../../shared/dataset.constants";
import type { BusScheduleContentRepository } from "./bus-schedule-content.repository";
import { BusScheduleContentService } from "./bus-schedule-content.service";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) =>
  mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

const LIVE_TRAFFIC = { style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요" };
const PILOT = { style: "info", text: "시범 운행 · 무료 · 킹고M QR 탑승" };

/** Revision 1 of bus-service-notices, without its provenance note. */
function fixtureNotices(): { services: Record<string, any> } {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/bus/fixtures/bus-service-notices.dataset.json"), "utf8")) as Record<string, any>;
  delete dataset._about;
  return dataset as { services: Record<string, any> };
}

function withService(serviceId: string, content: { notices: unknown[]; suspend: unknown }): { services: Record<string, any> } {
  const data = fixtureNotices();
  data.services[serviceId] = content;
  return data;
}

let repository: FakeBusScheduleContentRepository;
let service: BusScheduleContentService;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new FakeBusScheduleContentRepository();
  repository.storeRestDays(restDaysFixture());
  service = new BusScheduleContentService(asReal<BusScheduleContentRepository>(repository), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusScheduleContentService.current", () => {
  it("answers each service's stored notices, in their order, and its suspension", async () => {
    // Arrange
    repository.storeServiceNotices(withService("campus-jain", { notices: [LIVE_TRAFFIC], suspend: { from: "2026-12-21", until: "2027-02-28" } }));

    // Act
    const content = await service.current();

    // Assert
    expect(content.noticesOf("campus-inja")).toEqual([LIVE_TRAFFIC]);
    expect(content.noticesOf("commute-jeongja")).toEqual([PILOT, LIVE_TRAFFIC]);
    expect(content.suspendOf("campus-inja")).toBeNull();
    expect(content.suspendOf("campus-jain")).toEqual({ from: "2026-12-21", until: "2027-02-28" });
    expect(typeof content.revisionKey).toBe("string");
  });

  it("answers no notice and no suspension for a service the dataset leaves out", async () => {
    // Arrange
    const data = fixtureNotices();
    delete data.services["campus-jain"];
    repository.storeServiceNotices(data);

    // Act
    const content = await service.current();

    // Assert
    expect(content.noticesOf("campus-jain")).toEqual([]);
    expect(content.suspendOf("campus-jain")).toBeNull();
  });

  it.each(["toString", "__proto__", "constructor", "nope"])("answers nothing for %s, which is no stored service", async (serviceId) => {
    // Arrange
    repository.storeServiceNotices(fixtureNotices());

    // Act
    const content = await service.current();

    // Assert
    expect(content.noticesOf(serviceId)).toEqual([]);
    expect(content.suspendOf(serviceId)).toBeNull();
  });

  it("ignores a stored service the code does not define, and logs it once per revision", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const stale = withService("campus-gone", { notices: [LIVE_TRAFFIC], suspend: null });
    repository.storeServiceNotices(stale);

    // Act
    const first = await service.current();
    for (let reload = 1; reload < 3; reload++) {
      jest.setSystemTime(NOW.getTime() + reload * DATASET_CACHE_TTL_MS);
      await service.current();
    }
    repository.storeServiceNotices(stale);
    jest.setSystemTime(NOW.getTime() + 3 * DATASET_CACHE_TTL_MS);
    await service.current();

    // Assert
    expect(first.noticesOf("campus-gone")).toEqual([]);
    expect(repository.readCount).toBe(4);
    expect(callsOf("warn", "bus.service_notices.item_left_out")).toEqual([
      expect.objectContaining({ revision: 1, serviceId: "campus-gone" }),
      expect.objectContaining({ revision: 2, serviceId: "campus-gone" }),
    ]);
  });

  it("serves a push once the TTL has passed, under a new revision key, and not before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeServiceNotices(fixtureNotices());
    const before = await service.current();
    repository.storeServiceNotices(withService("campus-inja", { notices: [{ style: "warning", text: "교통 통제" }], suspend: null }));

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.current();
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.current();

    // Assert
    expect(beforeTtl.revisionKey).toBe(before.revisionKey);
    expect(beforeTtl.noticesOf("campus-inja")).toEqual([LIVE_TRAFFIC]);
    expect(atTtl.revisionKey).not.toBe(before.revisionKey);
    expect(atTtl.noticesOf("campus-inja")).toEqual([{ style: "warning", text: "교통 통제" }]);
  });

  it("answers BUS_SCHEDULE_UNAVAILABLE (503) on a first read that finds nothing", async () => {
    // Act & Assert
    await expect(service.current()).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers BUS_SCHEDULE_UNAVAILABLE (503) on a first read that fails, logging the failure", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    repository.failWith = failure;

    // Act & Assert
    await expect(service.current()).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE", httpStatus: 503 });
    expect(callsOf("error", "bus.service_notices.read_failed")).toEqual([expect.objectContaining({ err: failure })]);
  });

  it("keeps serving the last good revision when a reload fails or finds an invalid one", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeServiceNotices(fixtureNotices());
    const good = await service.current();

    // Act
    repository.failWith = new Error("server selection timed out");
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const afterFailure = await service.current();
    repository.failWith = null;
    repository.storeServiceNotices(withService("campus-inja", { notices: [{ style: "warnig", text: "교통 통제" }], suspend: null }));
    jest.setSystemTime(NOW.getTime() + 2 * DATASET_CACHE_TTL_MS);
    const afterInvalid = await service.current();

    // Assert
    expect(afterFailure.revisionKey).toBe(good.revisionKey);
    expect(afterInvalid.revisionKey).toBe(good.revisionKey);
    expect(afterInvalid.noticesOf("campus-inja")).toEqual([LIVE_TRAFFIC]);
  });
});

describe("BusScheduleContentService.current rest days", () => {
  it("answers the stored rest days, yearly and one-off", async () => {
    // Arrange
    repository.storeServiceNotices(fixtureNotices());
    repository.storeRestDays({ ...restDaysFixture(), "2027-03-02": "학사휴교" });

    // Act
    const content = await service.current();

    // Assert
    expect(content.restDays).toEqual({
      exact: new Map([["2027-03-02", "학사휴교"]]),
      annual: new Map([["09-25", "건학기념일"], ["09-28", "공자탄신일"]]),
    });
  });

  it("folds a rest days push into the revision key once the TTL has passed, and not before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeServiceNotices(fixtureNotices());
    const before = await service.current();
    repository.storeRestDays({ ...restDaysFixture(), "2027-03-02": "학사휴교" });

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.current();
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.current();

    // Assert
    expect(beforeTtl.revisionKey).toBe(before.revisionKey);
    expect(beforeTtl.restDays.exact.size).toBe(0);
    expect(atTtl.revisionKey).not.toBe(before.revisionKey);
    expect(atTtl.restDays.exact.get("2027-03-02")).toBe("학사휴교");
    expect(atTtl.noticesOf("campus-inja")).toEqual(before.noticesOf("campus-inja"));
  });

  it("keys two snapshots apart that differ in either dataset's revision alone", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeServiceNotices(fixtureNotices());
    const first = await service.current();
    repository.storeServiceNotices(fixtureNotices());
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const noticesPushed = await service.current();
    repository.storeRestDays(restDaysFixture());
    jest.setSystemTime(NOW.getTime() + 2 * DATASET_CACHE_TTL_MS);
    const restDaysPushed = await service.current();

    // Act & Assert
    expect(new Set([first.revisionKey, noticesPushed.revisionKey, restDaysPushed.revisionKey]).size).toBe(3);
  });

  it("answers BUS_SCHEDULE_UNAVAILABLE (503) while the rest days were never read, even with notices stored", async () => {
    // Arrange
    const noRestDays = new FakeBusScheduleContentRepository();
    noRestDays.storeServiceNotices(fixtureNotices());
    const unread = new BusScheduleContentService(asReal<BusScheduleContentRepository>(noRestDays), clock);

    // Act & Assert
    await expect(unread.current()).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE", httpStatus: 503 });
  });

  it("keeps serving the last good rest days when a reload finds an invalid revision", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeServiceNotices(fixtureNotices());
    const good = await service.current();
    repository.storeRestDays({ ...restDaysFixture(), "02-30": "휴일" });

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const afterInvalid = await service.current();

    // Assert
    expect(afterInvalid.revisionKey).toBe(good.revisionKey);
    expect(afterInvalid.restDays).toEqual(good.restDays);
  });
});
