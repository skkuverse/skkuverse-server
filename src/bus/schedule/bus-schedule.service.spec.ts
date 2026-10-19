/**
 * BusScheduleService over an in-memory timetable store: how a week resolves
 * (an override, then a rest day or holiday, then the pattern in effect, then
 * the fallback display), the week cache and its TTL, and the smart view's
 * opening day, suspension and noData. The holiday lookup is stubbed per test.
 * Each service's notices and suspension come from an in-memory content store
 * holding revision 1 of `bus-service-notices`; a test that needs other content
 * stores it as the next revision before its first read (move-editorial-datasets
 * D9).
 */

jest.mock("../../infra/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

jest.mock("./bus-schedule.rules", () => ({
  ...jest.requireActual("./bus-schedule.rules"),
  toNonOperatingDayLabel: jest.fn(() => null),
}));

import { FakeBusScheduleRepository } from "../../../__tests__/helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { FakeBusScheduleContentRepository } from "../../../__tests__/helpers/fakes/bus/bus-schedule-content.repository.fake";
import { restDaysFixture, serviceNoticesWithNotices, serviceNoticesWithSuspension, storedScheduleContentRepository } from "../../../__tests__/helpers/bus/schedule-content";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { HolidaysService } from "../../holidays/holidays.service";
import type { Clock } from "../../infra/clock";
import type { BusScheduleContentRepository } from "../schedule-content/bus-schedule-content.repository";
import { BusScheduleContentService } from "../schedule-content/bus-schedule-content.service";
import type { BusScheduleDoc } from "./bus-schedule.document";
import type { BusScheduleRepository } from "./bus-schedule.repository";
import { BusScheduleService } from "./bus-schedule.service";

const logger = require("../../infra/logger");
const { toNonOperatingDayLabel: getNonOperatingDayLabel } = require("./bus-schedule.rules");

// WHY: reads the (fake-timer) Date, as the tests that freeze the time expect.
const clock: Clock = { now: () => new Date() };

let repository: FakeBusScheduleRepository;
let content: FakeBusScheduleContentRepository;
let service: BusScheduleService;

const SUSPENSION = { from: "2026-06-21", until: "2026-08-31" };

function scheduleServiceOver(timetable: FakeBusScheduleRepository, stored: FakeBusScheduleContentRepository): BusScheduleService {
  const contentService = new BusScheduleContentService(asReal<BusScheduleContentRepository>(stored), clock);
  return new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), contentService, clock);
}

beforeEach(() => {
  repository = new FakeBusScheduleRepository();
  content = storedScheduleContentRepository();
  getNonOperatingDayLabel.mockImplementation(() => null);
  service = scheduleServiceOver(repository, content);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("BusScheduleService.resolveWeek", () => {
  it("weekday pattern (days:[1,2,3,4]) resolves Mon-Thu to schedule", async () => {
    // Arrange
    repository.patterns = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.days).toHaveLength(7);

    for (let i = 0; i < 4; i++) {
      expect(result!.days[i]!.display).toBe("schedule");
      expect(result!.days[i]!.schedule).toHaveLength(1);
    }
  });

  it("separate friday pattern (days:[5]) resolves Friday to its entries", async () => {
    // Arrange
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
      { serviceId: "campus-inja", patternId: "friday", days: [5], entries: [{ index: 1, time: "09:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(result!.days[4]!.display).toBe("schedule");
    expect((result!.days[4]!.schedule[0] as { time: string }).time).toBe("09:00");
  });

  it("Sat/Sun with no pattern and hidden fallback → display hidden", async () => {
    // Arrange
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(result!.days[5]!.display).toBe("hidden");
    expect(result!.days[5]!.schedule).toEqual([]);
    expect(result!.days[6]!.display).toBe("hidden");
    expect(result!.days[6]!.schedule).toEqual([]);
  });

  it("override type replace → display schedule with override entries and merged notices", async () => {
    // Arrange
    // The service notice is set here, so the merge does not depend on the content stored today.
    content.storeServiceNotices(serviceNoticesWithNotices("campus-inja", [{ style: "info", text: "서비스 공지" }]));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "ESKARA 1일차", notices: [{ style: "warning", text: "특별 운행" }], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 2, notes: "special" }] },
    ];

    // Act & Assert
    const result = await service.resolveWeek("campus-inja", "2026-03-09");
    const monday = result!.days[0]!;
    expect(monday.display).toBe("schedule");
    expect(monday.label).toBe("ESKARA 1일차");
    expect((monday.schedule[0]! as { time: string }).time).toBe("10:00");
    expect(monday.notices).toEqual([
      { style: "info", text: "서비스 공지", source: "service" },
      { style: "warning", text: "특별 운행", source: "override" },
    ]);
  });

  it("campus-inja and campus-jain schedule days carry the live-traffic ai notice", async () => {
    // Act & Assert
    for (const serviceId of ["campus-inja", "campus-jain"]) {
      repository.patterns = [
        { serviceId, patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
      ];

      const result = await service.resolveWeek(serviceId, "2026-03-09");
      expect(result!.days[0]!.display).toBe("schedule");
      expect(result!.days[0]!.notices).toEqual([
        { style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요", source: "service" },
      ]);
    }
  });

  it("override type noService → display noService, empty schedule/notices, label set", async () => {
    // Arrange
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-10", type: "noService", label: "삼일절", notices: [], entries: [] },
    ];

    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Act
    const tuesday = result!.days[1]!;

    // Assert
    expect(tuesday.display).toBe("noService");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([]);
    expect(tuesday.label).toBe("삼일절");
  });

  it("override type noService with notices → notices pass through tagged override, no service notices", async () => {
    // Arrange
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-10", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
    ];

    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Act
    const tuesday = result!.days[1]!;

    // Assert
    expect(tuesday.display).toBe("noService");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([
      { style: "info", text: "축제 인자셔틀을 확인해 주세요", source: "override" },
    ]);
    expect(tuesday.label).toBe("축제 기간");
  });

  it("override on a Monday overrides the weekday pattern", async () => {
    // Arrange
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "특별", notices: [], entries: [{ index: 1, time: "11:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Act
    const monday = result!.days[0]!;

    // Assert
    expect(monday.display).toBe("schedule");
    expect((monday.schedule[0]! as { time: string }).time).toBe("11:00");
    expect(monday.label).toBe("특별");
  });

  it("holiday on a weekday → noService + label, beating the weekday pattern", async () => {
    // Arrange
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    getNonOperatingDayLabel.mockImplementation((_restDays: unknown, d: string) =>
      d === "2026-03-10" ? "삼일절 대체공휴일" : null,
    );

    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Act
    const tuesday = result!.days[1]!;

    // Assert
    expect(tuesday.display).toBe("noService");
    expect(tuesday.label).toBe("삼일절 대체공휴일");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([]);
    expect(result!.days[0]!.display).toBe("schedule");
  });

  it("service without respectsKoreanHolidays ignores holidays", async () => {
    // Arrange
    repository.patterns = [
      { serviceId: "fasttrack-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
    ];
    getNonOperatingDayLabel.mockImplementation(() => "공휴일");

    // Act
    const result = await service.resolveWeek("fasttrack-inja", "2026-03-09");

    // Assert
    expect(result!.days[0]!.display).toBe("schedule");
    expect((result!.days[0]!.schedule[0] as { time: string }).time).toBe("10:00");
    expect(getNonOperatingDayLabel).not.toHaveBeenCalled();
  });

  it("override on a holiday wins over the holiday (escape hatch)", async () => {
    // Arrange
    getNonOperatingDayLabel.mockImplementation(() => "신정");
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "신정 특별운행", notices: [], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Act
    const monday = result!.days[0]!;

    // Assert
    expect(monday.display).toBe("schedule");
    expect(monday.label).toBe("신정 특별운행");
    expect((monday.schedule[0]! as { time: string }).time).toBe("10:00");
  });

  it("fasttrack with hidden fallback on non-event day → display hidden", async () => {
    // Arrange
    repository.patterns = [];

    // Act
    const result = await service.resolveWeek("fasttrack-inja", "2026-03-09");

    // Assert
    expect(result).not.toBeNull();
    for (const day of result!.days) {
      expect(day.display).toBe("hidden");
      expect(day.schedule).toEqual([]);
    }
  });

  it("Wednesday date normalizes to that week Monday", async () => {
    // Arrange
    repository.patterns = [];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-03-11");

    // Assert
    expect(result!.from).toBe("2026-03-09");
  });

  it("from omitted defaults to current week Monday", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    repository.patterns = [];

    // Act
    const result = await service.resolveWeek("campus-inja");

    // Assert
    expect(result!.from).toBe("2026-03-09");
    jest.useRealTimers();
  });

  it("requestedFrom preserves original value, null if omitted", async () => {
    // Arrange
    repository.patterns = [];

    // Act
    const result1 = await service.resolveWeek("campus-inja", "2026-03-11");

    // Assert
    expect(result1!.requestedFrom).toBe("2026-03-11");

    const result2 = await service.resolveWeek("campus-inja");
    expect(result2!.requestedFrom).toBeNull();
  });

  it("unknown serviceId returns null", async () => {
    // Act
    const result = await service.resolveWeek("nonexistent-service", "2026-03-09");

    // Assert
    expect(result).toBeNull();
  });

  it("second call with same key does not re-query DB", async () => {
    // Arrange
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    await service.resolveWeek("campus-inja", "2026-03-09");
    const callCount = repository.reads;

    // Act
    await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(repository.reads).toBe(callCount);
  });

  it("CACHE=off: every call re-queries DB", async () => {
    // Arrange
    const config = require("../../infra/config");
    config.cache.enabled = false;

    // Act & Assert
    try {
      await service.resolveWeek("campus-inja", "2026-03-09");
      const callCount = repository.reads;
      await service.resolveWeek("campus-inja", "2026-03-09");
      expect(repository.reads).toBe(callCount * 2);
    } finally {
      config.cache.enabled = true;
    }
  });

  it("after 1hr TTL, re-queries DB", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T00:00:00.000Z"));
    repository.patterns = [];

    await service.resolveWeek("campus-inja", "2026-03-09");
    const callCount = repository.reads;

    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    // Act
    await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(repository.reads).toBeGreaterThan(callCount);
    jest.useRealTimers();
  });

  it("always returns exactly 7 days Mon-Sun in order", async () => {
    // Arrange
    repository.patterns = [];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(result!.days).toHaveLength(7);
    expect(result!.days[0]!.dayOfWeek).toBe(1);
    expect(result!.days[6]!.dayOfWeek).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(result!.days[i]!.dayOfWeek).toBe(i + 1);
    }
  });

  it("response has correct top-level shape", async () => {
    // Arrange
    repository.patterns = [];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(result).toMatchObject({
      serviceId: "campus-inja",
      requestedFrom: "2026-03-09",
      from: "2026-03-09",
    });
    expect(result!.days).toHaveLength(7);
    expect(result!.days[0]).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dayOfWeek: expect.any(Number),
      display: expect.stringMatching(/^(schedule|noService|hidden)$/),
      schedule: expect.any(Array),
      notices: expect.any(Array),
    });
    expect(result!.days[0]).toHaveProperty("label");
  });
});

describe("BusScheduleService week cache freshness (ADR 0012, D6)", () => {
  const WEEKDAY = { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4] };
  const at = (time: string) => [{ index: 1, time, routeType: "regular", busCount: 1, notes: null }];
  const mondayTimes = async (): Promise<Array<string | undefined> | undefined> =>
    (await service.resolveWeek("campus-inja", "2026-03-09"))?.days[0]!.schedule.map((entry) => entry.time);

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    jest.setSystemTime(new Date("2026-03-09T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves a timetable written by another process 61 s later, with no restart", async () => {
    // Arrange
    repository.patterns = [{ ...WEEKDAY, entries: at("08:00") }];
    await mondayTimes();
    repository.patterns = [{ ...WEEKDAY, entries: at("09:30") }];

    // Act
    jest.advanceTimersByTime(61_000);
    const times = await mondayTimes();

    // Assert
    expect(times).toEqual(["09:30"]);
  });

  it("keeps serving the last week when a reload fails within an hour, and logs cache.reload_failed", async () => {
    // Arrange
    repository.patterns = [{ ...WEEKDAY, entries: at("08:00") }];
    await mondayTimes();
    repository.failWith = new Error("atlas unreachable");

    // Act
    jest.advanceTimersByTime(60 * 60 * 1000);
    const times = await mondayTimes();

    // Assert
    expect(times).toEqual(["08:00"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cache.reload_failed", cache: "bus.schedule.campus-inja:2026-03-09" }),
      expect.any(String),
    );
  });

  it("fails a read once the last good week is over an hour past its TTL", async () => {
    // Arrange
    repository.patterns = [{ ...WEEKDAY, entries: at("08:00") }];
    await mondayTimes();
    repository.failWith = new Error("atlas unreachable");

    // Act
    jest.advanceTimersByTime(60_000 + 60 * 60 * 1000);

    // Assert
    await expect(mondayTimes()).rejects.toThrow("atlas unreachable");
  });
});

describe("pattern effective ranges", () => {
  const entry = (time: string) => ({ index: 1, time, routeType: "regular", busCount: 1, notes: null });
  const pilot = {
    serviceId: "campus-inja",
    patternId: "pilot",
    days: [1, 2, 3, 4, 5],
    effectiveFrom: "2026-10-19",
    effectiveUntil: "2026-12-18",
    entries: [entry("07:40")],
  };

  it("a date before the range falls back to the non-operating display", async () => {
    // Arrange
    repository.patterns = [pilot];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-10-12");

    // Assert
    for (const day of result!.days.slice(0, 5)) {
      expect(day.display).toBe("hidden");
      expect(day.schedule).toEqual([]);
    }
  });

  it("the first and last dates of the range serve the pattern", async () => {
    // Arrange
    repository.patterns = [pilot];

    // Act
    const first = await service.resolveWeek("campus-inja", "2026-10-19");

    // Assert
    expect(first!.days[0]!.display).toBe("schedule");
    expect((first!.days[0]!.schedule[0] as { time: string }).time).toBe("07:40");

    const last = await service.resolveWeek("campus-inja", "2026-12-14");
    expect(last!.days[4]!.date).toBe("2026-12-18");
    expect(last!.days[4]!.display).toBe("schedule");
  });

  it("a date after the range does not apply the pattern", async () => {
    // Arrange
    repository.patterns = [pilot];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-12-21");

    // Assert
    expect(result!.days[0]!.date).toBe("2026-12-21");
    expect(result!.days[0]!.display).toBe("hidden");
  });

  it("a pattern with neither bound applies on every listed weekday", async () => {
    // Arrange
    repository.patterns = [{ serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [entry("08:00")] }];

    // Act & Assert
    for (const from of ["2020-01-06", "2026-10-19", "2031-06-02"]) {
      const result = await service.resolveWeek("campus-inja", from);
      expect(result!.days[0]!.display).toBe("schedule");
    }
  });

  it("a replace override wins on a date outside every range", async () => {
    // Arrange
    repository.patterns = [pilot];
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-10-14", type: "replace", label: "시범 운행", notices: [], entries: [entry("09:00")] },
    ];

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-10-12");

    // Assert
    expect(result!.days[2]!.display).toBe("schedule");
    expect((result!.days[2]!.schedule[0] as { time: string }).time).toBe("09:00");
    expect(result!.days[1]!.display).toBe("hidden");
  });

  it("a holiday inside the range resolves to no service with its label", async () => {
    // Arrange
    repository.patterns = [pilot];
    getNonOperatingDayLabel.mockImplementation((_restDays: unknown, d: string) => (d === "2026-10-21" ? "휴일" : null));

    // Act
    const result = await service.resolveWeek("campus-inja", "2026-10-19");

    // Assert
    expect(result!.days[2]!.display).toBe("noService");
    expect(result!.days[2]!.label).toBe("휴일");
    expect(result!.days[1]!.display).toBe("schedule");
  });

  it("two applying patterns: the later effectiveFrom is served and one error names both", async () => {
    // Arrange
    repository.patterns = [
      { serviceId: "campus-jain", patternId: "old-weekday", days: [1, 2, 3, 4, 5], entries: [entry("08:00")] },
      { serviceId: "campus-jain", patternId: "new-weekday", days: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-19", entries: [entry("09:30")] },
    ];

    // Act
    const result = await service.resolveWeek("campus-jain", "2026-10-19");

    // Assert
    expect((result!.days[1]!.schedule[0] as { time: string }).time).toBe("09:30");

    const conflicts = logger.error.mock.calls.filter(
      ([fields]: [{ event?: string }]) => fields.event === "bus.schedule.pattern_conflict",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0][0]).toMatchObject({
      serviceId: "campus-jain",
      patternIds: ["new-weekday", "old-weekday"],
      served: "new-weekday",
    });
  });
});

describe("BusScheduleService.resolveSmartSchedule across a range start", () => {
  const pilot = {
    serviceId: "campus-inja",
    patternId: "pilot",
    days: [1, 2, 3, 4, 5],
    effectiveFrom: "2026-10-19",
    entries: [{ index: 1, time: "07:40", routeType: "regular", busCount: 1, notes: null }],
  };

  afterEach(() => jest.useRealTimers());

  it("opens on the first day of a range that starts next week", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-14T03:00:00.000Z")); // Wed 12:00 KST
    repository.patterns = [pilot];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result).toMatchObject({ status: "active", from: "2026-10-19", selectedDate: "2026-10-19" });
    // No field or status a pre-range client does not already handle.
    expect(Object.keys(result!).sort()).toEqual(["days", "from", "selectedDate", "serviceId", "status"]);
  });

  it("reports noData when the range starts two weeks out", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-05T03:00:00.000Z")); // Mon 12:00 KST
    repository.patterns = [pilot];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result).toMatchObject({ status: "noData", from: null, selectedDate: null, days: [] });
    expect(Object.keys(result!).sort()).toEqual(["days", "from", "selectedDate", "serviceId", "status"]);
  });
});

describe("BusScheduleService.resolveSmartSchedule", () => {
  it("on a weekday with schedule, selectedDate = today and hidden days filtered", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.selectedDate).toBe("2026-03-10");
    expect(result!.from).toBe("2026-03-09");
    expect(result!.days.every((d) => d.display !== "hidden")).toBe(true);
    expect(result!.days).toHaveLength(5);
    jest.useRealTimers();
  });

  it("on Saturday, selectedDate crosses to next week Monday", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-14T03:00:00.000Z"));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.selectedDate).toBe("2026-03-16");
    expect(result!.from).toBe("2026-03-16");
    expect(result!.days).toHaveLength(5);
    jest.useRealTimers();
  });

  it("holiday (noService override) on today, selectedDate skips to next schedule day", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "noService", label: "공휴일", notices: [], entries: [] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.selectedDate).toBe("2026-03-10");
    const holidayDay = result!.days.find((d) => d.date === "2026-03-09");
    expect(holidayDay).toBeDefined();
    expect(holidayDay!.display).toBe("noService");
    expect(holidayDay!.label).toBe("공휴일");
    jest.useRealTimers();
  });

  it("announced closure (noService override with notices) on today → selectedDate is today", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-12T03:00:00.000Z")); // Thu
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-12", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
      { serviceId: "campus-inja", date: "2026-03-13", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).toBe("active");
    expect(result!.selectedDate).toBe("2026-03-12");
    expect(result!.from).toBe("2026-03-09");
    const today = result!.days.find((d) => d.date === "2026-03-12");
    expect(today!.display).toBe("noService");
    expect(today!.notices).toHaveLength(1);
    jest.useRealTimers();
  });

  it("announced closure later in the week does not beat an earlier schedule day", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-11T03:00:00.000Z")); // Wed
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    repository.overrides = [
      { serviceId: "campus-inja", date: "2026-03-12", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.selectedDate).toBe("2026-03-11");
    jest.useRealTimers();
  });

  it("fasttrack with only override days → only those days visible", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    repository.patterns = [];
    repository.overrides = [
      { serviceId: "fasttrack-inja", date: "2026-03-09", type: "replace", label: "ESKARA 1일차", notices: [], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
      { serviceId: "fasttrack-inja", date: "2026-03-10", type: "replace", label: "ESKARA 2일차", notices: [], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("fasttrack-inja");

    // Assert
    expect(result!.selectedDate).toBe("2026-03-09");
    expect(result!.days).toHaveLength(2);
    expect(result!.days[0]!.date).toBe("2026-03-09");
    expect(result!.days[1]!.date).toBe("2026-03-10");
    jest.useRealTimers();
  });

  it("all days hidden → status noData, selectedDate null, days empty", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    repository.patterns = [];
    repository.overrides = [];

    // Act
    const result = await service.resolveSmartSchedule("fasttrack-inja");

    // Assert
    expect(result!.status).toBe("noData");
    expect(result!.selectedDate).toBeNull();
    expect(result!.from).toBeNull();
    expect(result!.days).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "bus.schedule.no_data", serviceId: "fasttrack-inja", suppressed: 0 },
      expect.stringContaining("noData"),
    );
    jest.useRealTimers();
  });

  it("unknown serviceId returns null", async () => {
    // Act
    const result = await service.resolveSmartSchedule("nonexistent");

    // Assert
    expect(result).toBeNull();
  });

  it("response has correct shape", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result).toMatchObject({
      serviceId: "campus-inja",
      status: "active",
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      selectedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      days: expect.any(Array),
    });
    for (const day of result!.days) {
      expect(day).toMatchObject({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        dayOfWeek: expect.any(Number),
        display: expect.stringMatching(/^(schedule|noService)$/),
        schedule: expect.any(Array),
        notices: expect.any(Array),
      });
      expect(day).toHaveProperty("label");
    }
    jest.useRealTimers();
  });

  it("within suspend period → status suspended, resumeDate = until+1, no DB query", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", SUSPENSION));

    const callsBefore = repository.reads;

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).toBe("suspended");
    expect(result!.resumeDate).toBe("2026-09-01");
    expect(result!.from).toBeNull();
    expect(result!.selectedDate).toBeNull();
    expect(result!.days).toHaveLength(0);
    expect(repository.reads).toBe(callsBefore);

    jest.useRealTimers();
  });

  it("outside suspend period → status active", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-02T03:00:00.000Z"));
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", SUSPENSION));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).toBe("active");
    expect(result!.selectedDate).not.toBeNull();

    jest.useRealTimers();
  });

  it("suspend null → status active when schedule exists", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).toBe("active");
    jest.useRealTimers();
  });

  it("suspend boundary: until day itself → suspended", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-31T03:00:00.000Z"));
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", SUSPENSION));

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).toBe("suspended");

    jest.useRealTimers();
  });

  it("suspend boundary: day after until → not suspended", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T03:00:00.000Z"));
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", SUSPENSION));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).not.toBe("suspended");

    jest.useRealTimers();
  });

  it("suspend boundary: from day itself → suspended", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-21T03:00:00.000Z"));
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", SUSPENSION));

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).toBe("suspended");

    jest.useRealTimers();
  });

  it("suspend boundary: day before from → not suspended", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-20T03:00:00.000Z"));
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", SUSPENSION));
    repository.patterns = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    // Act
    const result = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(result!.status).not.toBe("suspended");

    jest.useRealTimers();
  });
});

describe("BusScheduleService over the stored schedule content (move-editorial-datasets D9)", () => {
  const WEEKDAYS = { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] };
  const TRAFFIC_NOTICE = { style: "warning", text: "교통 통제로 늦어질 수 있어요" };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    repository.patterns = [WEEKDAYS];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("carries a service's stored notices on its operating days, and none on a day without service", async () => {
    // Arrange
    content.storeServiceNotices(serviceNoticesWithNotices("campus-inja", [TRAFFIC_NOTICE, { style: "ai", text: "AI 안내" }]));

    // Act
    const week = await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(week!.days[0]!.notices).toEqual([
      { ...TRAFFIC_NOTICE, source: "service" },
      { style: "ai", text: "AI 안내", source: "service" },
    ]);
    expect(week!.days[5]).toMatchObject({ display: "hidden", notices: [] });
  });

  it("serves a pushed notice in a week it had cached once the content's TTL has passed, before the week's own TTL", async () => {
    // Arrange
    await service.resolveWeek("campus-jain", "2026-03-09");
    jest.advanceTimersByTime(50_000);
    await service.resolveWeek("campus-inja", "2026-03-09");
    content.storeServiceNotices(serviceNoticesWithNotices("campus-inja", [TRAFFIC_NOTICE]));

    // Act
    jest.advanceTimersByTime(9_000);
    const beforePush = await service.resolveWeek("campus-inja", "2026-03-09");
    jest.advanceTimersByTime(1_000);
    const afterPush = await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(beforePush!.days[0]!.notices.map((n) => n.text)).toEqual(["도착 시간은 실시간 교통 상황을 반영해요"]);
    expect(afterPush!.days[0]!.notices).toEqual([{ ...TRAFFIC_NOTICE, source: "service" }]);
  });

  it("drops the weeks cached under an older revision once a new one is read", async () => {
    // Arrange
    // The cache is private; its keys are what shows that no week of the older revision is kept.
    const cachedWeeks = () => [...(service as unknown as { weeks: Map<string, unknown> }).weeks.keys()];
    await service.resolveWeek("campus-inja", "2026-03-09");
    await service.resolveWeek("campus-jain", "2026-03-16");
    const olderRevision = cachedWeeks();
    content.storeServiceNotices(serviceNoticesWithNotices("campus-inja", [TRAFFIC_NOTICE]));
    jest.advanceTimersByTime(60_000);

    // Act
    await service.resolveWeek("campus-inja", "2026-03-09");

    // Assert
    expect(olderRevision).toHaveLength(2);
    expect(cachedWeeks()).toHaveLength(1);
    expect(cachedWeeks()[0]).toMatch(/^campus-inja:2026-03-09:/);
    expect(olderRevision).not.toContain(cachedWeeks()[0]);
  });

  it("answers suspended from a suspension stored in the content, resuming the day after it", async () => {
    // Arrange
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-03-01", until: "2026-03-15" }));

    // Act
    const smart = await service.resolveSmartSchedule("campus-inja");

    // Assert
    expect(smart).toEqual({ serviceId: "campus-inja", status: "suspended", resumeDate: "2026-03-16", from: null, selectedDate: null, days: [] });
  });

  it("serves a pushed one-off rest day as no service with its label after the TTL, on holiday-respecting services only, an override still winning", async () => {
    // Arrange
    getNonOperatingDayLabel.mockImplementation(jest.requireActual("./bus-schedule.rules").toNonOperatingDayLabel);
    repository.patterns = [WEEKDAYS, { ...WEEKDAYS, serviceId: "fasttrack-inja" }, { ...WEEKDAYS, serviceId: "campus-jain" }];
    repository.overrides = [{ serviceId: "campus-jain", date: "2026-03-11", type: "replace", label: "특별 운행", notices: [], entries: WEEKDAYS.entries }];
    const before = await service.resolveWeek("campus-inja", "2026-03-09");
    content.storeRestDays({ ...restDaysFixture(), "2026-03-11": "학사휴교" });

    // Act
    jest.advanceTimersByTime(59_000);
    const beforeTtl = await service.resolveWeek("campus-inja", "2026-03-09");
    jest.advanceTimersByTime(1_000);
    const inja = await service.resolveWeek("campus-inja", "2026-03-09");
    const fasttrack = await service.resolveWeek("fasttrack-inja", "2026-03-09");
    const jain = await service.resolveWeek("campus-jain", "2026-03-09");

    // Assert
    expect(before!.days[2]).toMatchObject({ date: "2026-03-11", display: "schedule" });
    expect(beforeTtl!.days[2]).toMatchObject({ date: "2026-03-11", display: "schedule" });
    expect(inja!.days[2]).toEqual({ date: "2026-03-11", dayOfWeek: 3, display: "noService", label: "학사휴교", notices: [], schedule: [] });
    expect(fasttrack!.days[2]).toMatchObject({ date: "2026-03-11", display: "schedule", label: null });
    expect(jain!.days[2]).toMatchObject({ date: "2026-03-11", display: "schedule", label: "특별 운행" });
  });

  it("answers null for an unknown service without reading the content, even when it is unavailable", async () => {
    // Arrange
    const unread = scheduleServiceOver(repository, new FakeBusScheduleContentRepository());

    // Act & Assert
    await expect(unread.resolveWeek("campus-jaja", "2026-03-09")).resolves.toBeNull();
    await expect(unread.resolveSmartSchedule("campus-jaja")).resolves.toBeNull();
  });

  it("rejects the week and the smart view with BUS_SCHEDULE_UNAVAILABLE (503) while no content was ever read", async () => {
    // Arrange
    const empty = new FakeBusScheduleContentRepository();
    empty.failWith = new Error("server selection timed out");
    const unread = scheduleServiceOver(repository, empty);

    // Act & Assert
    await expect(unread.resolveWeek("campus-inja", "2026-03-09")).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE", httpStatus: 503 });
    await expect(unread.resolveSmartSchedule("campus-inja")).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE", httpStatus: 503 });
    expect(repository.reads).toBe(0);
  });
});

describe("자과캠 통학셔틀 resolution (built from scripts/data/commute-schedule.json)", () => {
  // The committed file, built the way the tool writes it, served from the
  // mocked collection: what prod resolves after `npm run schedule --create`.
  const fs = require("fs");
  const path = require("path");
  const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
  const commuteDocs: BusScheduleDoc[] = buildDocuments(
    parseTimetableFile(
      JSON.parse(fs.readFileSync(path.join(__dirname, "../../../scripts/data/commute-schedule.json"), "utf8")),
    ),
  );
  const docsFor = (serviceId: string) => commuteDocs.filter((d) => d.serviceId === serviceId);

  it("runs Monday to Friday from Monday 2026-10-19 and hides the weekend of the first week", async () => {
    // Arrange
    repository.patterns = docsFor("commute-jamsil");

    // Act
    const week = await service.resolveWeek("commute-jamsil", "2026-10-19");

    // Assert
    expect(week!.days.slice(0, 5).map((d) => d.display)).toEqual(Array(5).fill("schedule"));
    expect(week!.days[0]!.date).toBe("2026-10-19");
    expect(week!.days[4]!.date).toBe("2026-10-23");
    expect(week!.days[5]).toMatchObject({ date: "2026-10-24", display: "hidden" });
    expect(week!.days[6]).toMatchObject({ date: "2026-10-25", display: "hidden" });
  });

  it("opens the smart view on the first day while the card is up before the pilot", async () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-12T02:55:00.000Z")); // Mon 11:55 KST, the card's first minute

    // Act & Assert
    try {
      repository.patterns = docsFor("commute-jeongja");
      const result = await service.resolveSmartSchedule("commute-jeongja");
      expect(result).toMatchObject({ status: "active", from: "2026-10-19", selectedDate: "2026-10-19" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("serves no timetable after the pilot", async () => {
    // Arrange
    repository.patterns = docsFor("commute-dogok");

    // Act
    const week = await service.resolveWeek("commute-dogok", "2026-12-21");

    // Assert
    expect(week!.days[0]).toMatchObject({ date: "2026-12-21", display: "hidden", schedule: [] });
  });

  it("adds the via-route notice second, on the 강남·양재 tab only", async () => {
    // Arrange
    repository.patterns = docsFor("commute-gangnam-yangjae");

    // Act
    const gy = await service.resolveWeek("commute-gangnam-yangjae", "2026-11-02");

    // Assert
    for (const day of gy!.days.filter((d) => d.display === "schedule")) {
      expect(day.notices.map((n) => n.text)).toEqual([
        "시범 운행 · 무료 · 킹고M QR 탑승",
        "등교: 강남역 → 양재역 → 자과캠\n하교: 자과캠 → 양재역 → 강남역",
        "도착 시간은 실시간 교통 상황을 반영해요",
      ]);
    }
    repository.patterns = docsFor("commute-jeongja");
    const jeongja = await service.resolveWeek("commute-jeongja", "2026-11-02");
    expect(jeongja!.days[0]!.notices.map((n) => n.text)).not.toContain("등교: 강남역 → 양재역 → 자과캠\n하교: 자과캠 → 양재역 → 강남역");
  });

  it("closes every operating day with the live-traffic ai notice, since arrivals are estimated", async () => {
    // Act & Assert
    for (const serviceId of ["commute-jeongja", "commute-jamsil", "commute-dogok", "commute-gangnam-yangjae", "commute-gwanggyo"]) {
      repository.patterns = docsFor(serviceId);
      const week = await service.resolveWeek(serviceId, "2026-11-02");
      for (const day of week!.days.filter((d) => d.display === "schedule")) {
        expect(day.notices.at(-1)).toEqual({ style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요", source: "service" });
        expect(day.notices.filter((n) => n.style === "ai")).toHaveLength(1);
      }
    }
  });

  it("opens every operating day with the pilot notice", async () => {
    // Act & Assert
    for (const serviceId of [
      "commute-jeongja",
      "commute-jamsil",
      "commute-dogok",
      "commute-gangnam-yangjae",
      "commute-gwanggyo",
    ]) {
      repository.patterns = docsFor(serviceId);
      const week = await service.resolveWeek(serviceId, "2026-11-02");
      for (const day of week!.days.filter((d) => d.display === "schedule")) {
        expect(day.notices[0]!.text).toMatch(/시범 운행.*무료.*킹고M QR/);
      }
    }
  });
});
