/**
 * Nest port of schedule-data.test.ts — ScheduleService is the exact port of
 * features/bus/schedule.data.ts.
 *
 * Same mocking strategy as the Express test: lib/db (driver-level reads),
 * lib/config (dbName), lib/logger, and the holiday calendar feature module
 * (HolidayCalendarService delegates to it). features/bus/schedule-db is mocked
 * so onModuleInit's ensureScheduleIndexes is a no-op.
 *
 * The service holds its 1-hr cache on the instance, so we new it up per test.
 * serviceConfig is the same shared object the Express test mutates, so the
 * suspend-window tests mutate it identically.
 */

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn(),
}));

jest.mock("../../../src/infra/config", () => ({
  mongo: { dbName: "test_db" },
  cache: { enabled: true },
}));

jest.mock("../../../src/infra/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

jest.mock("../../../src/bus/schedule/holiday-calendar", () => ({
  getNonOperatingDayLabel: jest.fn(() => null),
}));

jest.mock("../../../src/bus/schedule/schedule-db", () => ({
  ensureScheduleIndexes: jest.fn().mockResolvedValue(undefined),
}));

import { ScheduleService } from "../../../src/bus/schedule/schedule.service";
import { HolidayCalendarService } from "../../../src/bus/schedule/holiday-calendar.service";

const logger = require("../../../src/infra/logger");
const { getNonOperatingDayLabel } = require("../../../src/bus/schedule/holiday-calendar");
const { getClient } = require("../../../src/infra/db");
const serviceConfig = require("../../../src/bus/schedule/service-config").default;

let mockSchedules: unknown[] = [];
let mockOverrides: unknown[] = [];

const mockFind = jest.fn();
const mockCollection = jest.fn();

let service: ScheduleService;
// Convenience wrappers so the test bodies mirror the Express functional style.
const resolveWeek = (...args: [string, string?]) => service.resolveWeek(...args);
const resolveSmartSchedule = (id: string) => service.resolveSmartSchedule(id);
const clearCache = () => service.clearCache();
const clearCacheForService = (id: string) => service.clearCacheForService(id);

beforeEach(() => {
  mockSchedules = [];
  mockOverrides = [];
  getNonOperatingDayLabel.mockImplementation(() => null);

  mockFind.mockImplementation(() => ({
    toArray: jest.fn().mockImplementation(() => {
      const lastCall =
        mockCollection.mock.calls[mockCollection.mock.calls.length - 1];
      if (lastCall && lastCall[0] === "bus_overrides") {
        return Promise.resolve(mockOverrides);
      }
      return Promise.resolve(mockSchedules);
    }),
  }));

  mockCollection.mockReturnValue({ find: mockFind });

  getClient.mockReturnValue({
    db: jest.fn().mockReturnValue({
      collection: mockCollection,
    }),
  });

  service = new ScheduleService(new HolidayCalendarService());
});

afterEach(() => {
  clearCache();
  jest.clearAllMocks();
});

describe("resolveWeek", () => {
  it("weekday pattern (days:[1,2,3,4]) resolves Mon-Thu to schedule", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result).not.toBeNull();
    expect(result!.days).toHaveLength(7);

    for (let i = 0; i < 4; i++) {
      expect(result!.days[i].display).toBe("schedule");
      expect(result!.days[i].schedule).toHaveLength(1);
    }
  });

  it("separate friday pattern (days:[5]) resolves Friday to its entries", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
      { serviceId: "campus-inja", patternId: "friday", days: [5], entries: [{ index: 1, time: "09:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result!.days[4].display).toBe("schedule");
    expect((result!.days[4].schedule[0] as { time: string }).time).toBe("09:00");
  });

  it("Sat/Sun with no pattern and hidden fallback → display hidden", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result!.days[5].display).toBe("hidden");
    expect(result!.days[5].schedule).toEqual([]);
    expect(result!.days[6].display).toBe("hidden");
    expect(result!.days[6].schedule).toEqual([]);
  });

  it("override type replace → display schedule with override entries and merged notices", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "ESKARA 1일차", notices: [{ style: "warning", text: "특별 운행" }], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 2, notes: "special" }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result!.days[0];
    expect(monday.display).toBe("schedule");
    expect(monday.label).toBe("ESKARA 1일차");
    expect((monday.schedule[0] as { time: string }).time).toBe("10:00");
    const serviceNotices = monday.notices.filter((n) => n.source === "service");
    const overrideNotices = monday.notices.filter((n) => n.source === "override");
    expect(serviceNotices.length).toBeGreaterThan(0);
    expect(overrideNotices).toHaveLength(1);
    expect(overrideNotices[0].text).toBe("특별 운행");
  });

  it("override type noService → display noService, empty schedule/notices, label set", async () => {
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-10", type: "noService", label: "삼일절", notices: [], entries: [] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const tuesday = result!.days[1];
    expect(tuesday.display).toBe("noService");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([]);
    expect(tuesday.label).toBe("삼일절");
  });

  it("override type noService with notices → notices pass through tagged override, no service notices", async () => {
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-10", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const tuesday = result!.days[1];
    expect(tuesday.display).toBe("noService");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([
      { style: "info", text: "축제 인자셔틀을 확인해 주세요", source: "override" },
    ]);
    expect(tuesday.label).toBe("축제 기간");
  });

  it("override on a Monday overrides the weekday pattern", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "특별", notices: [], entries: [{ index: 1, time: "11:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result!.days[0];
    expect(monday.display).toBe("schedule");
    expect((monday.schedule[0] as { time: string }).time).toBe("11:00");
    expect(monday.label).toBe("특별");
  });

  it("holiday on a weekday → noService + label, beating the weekday pattern", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    getNonOperatingDayLabel.mockImplementation((d: string) =>
      d === "2026-03-10" ? "삼일절 대체공휴일" : null,
    );

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const tuesday = result!.days[1];
    expect(tuesday.display).toBe("noService");
    expect(tuesday.label).toBe("삼일절 대체공휴일");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([]);
    expect(result!.days[0].display).toBe("schedule");
  });

  it("service without respectsKoreanHolidays ignores holidays", async () => {
    mockSchedules = [
      { serviceId: "fasttrack-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
    ];
    getNonOperatingDayLabel.mockImplementation(() => "공휴일");

    const result = await resolveWeek("fasttrack-inja", "2026-03-09");
    expect(result!.days[0].display).toBe("schedule");
    expect((result!.days[0].schedule[0] as { time: string }).time).toBe("10:00");
    expect(getNonOperatingDayLabel).not.toHaveBeenCalled();
  });

  it("override on a holiday wins over the holiday (escape hatch)", async () => {
    getNonOperatingDayLabel.mockImplementation(() => "신정");
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "신정 특별운행", notices: [], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result!.days[0];
    expect(monday.display).toBe("schedule");
    expect(monday.label).toBe("신정 특별운행");
    expect((monday.schedule[0] as { time: string }).time).toBe("10:00");
  });

  it("fasttrack with hidden fallback on non-event day → display hidden", async () => {
    mockSchedules = [];

    const result = await resolveWeek("fasttrack-inja", "2026-03-09");
    expect(result).not.toBeNull();
    for (const day of result!.days) {
      expect(day.display).toBe("hidden");
      expect(day.schedule).toEqual([]);
    }
  });

  it("Wednesday date normalizes to that week Monday", async () => {
    mockSchedules = [];
    const result = await resolveWeek("campus-inja", "2026-03-11");
    expect(result!.from).toBe("2026-03-09");
  });

  it("from omitted defaults to current week Monday", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [];

    const result = await resolveWeek("campus-inja");
    expect(result!.from).toBe("2026-03-09");
    jest.useRealTimers();
  });

  it("requestedFrom preserves original value, null if omitted", async () => {
    mockSchedules = [];

    const result1 = await resolveWeek("campus-inja", "2026-03-11");
    expect(result1!.requestedFrom).toBe("2026-03-11");

    clearCache();
    const result2 = await resolveWeek("campus-inja");
    expect(result2!.requestedFrom).toBeNull();
  });

  it("unknown serviceId returns null", async () => {
    const result = await resolveWeek("nonexistent-service", "2026-03-09");
    expect(result).toBeNull();
  });

  it("second call with same key does not re-query DB", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    await resolveWeek("campus-inja", "2026-03-09");
    const callCount = mockCollection.mock.calls.length;

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBe(callCount);
  });

  it("CACHE=off: every call re-queries DB", async () => {
    const config = require("../../../src/infra/config");
    config.cache.enabled = false;
    try {
      await resolveWeek("campus-inja", "2026-03-09");
      const callCount = mockCollection.mock.calls.length;
      await resolveWeek("campus-inja", "2026-03-09");
      expect(mockCollection.mock.calls.length).toBe(callCount * 2);
    } finally {
      config.cache.enabled = true;
    }
  });

  it("after 1hr TTL, re-queries DB", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T00:00:00.000Z"));
    mockSchedules = [];

    await resolveWeek("campus-inja", "2026-03-09");
    const callCount = mockCollection.mock.calls.length;

    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBeGreaterThan(callCount);
    jest.useRealTimers();
  });

  it("always returns exactly 7 days Mon-Sun in order", async () => {
    mockSchedules = [];
    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result!.days).toHaveLength(7);
    expect(result!.days[0].dayOfWeek).toBe(1);
    expect(result!.days[6].dayOfWeek).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(result!.days[i].dayOfWeek).toBe(i + 1);
    }
  });

  it("response has correct top-level shape", async () => {
    mockSchedules = [];
    const result = await resolveWeek("campus-inja", "2026-03-09");
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
    mockSchedules = [pilot];
    const result = await resolveWeek("campus-inja", "2026-10-12");
    for (const day of result!.days.slice(0, 5)) {
      expect(day.display).toBe("hidden");
      expect(day.schedule).toEqual([]);
    }
  });

  it("the first and last dates of the range serve the pattern", async () => {
    mockSchedules = [pilot];
    const first = await resolveWeek("campus-inja", "2026-10-19");
    expect(first!.days[0].display).toBe("schedule");
    expect((first!.days[0].schedule[0] as { time: string }).time).toBe("07:40");

    const last = await resolveWeek("campus-inja", "2026-12-14");
    expect(last!.days[4].date).toBe("2026-12-18");
    expect(last!.days[4].display).toBe("schedule");
  });

  it("a date after the range does not apply the pattern", async () => {
    mockSchedules = [pilot];
    const result = await resolveWeek("campus-inja", "2026-12-21");
    expect(result!.days[0].date).toBe("2026-12-21");
    expect(result!.days[0].display).toBe("hidden");
  });

  it("a pattern with neither bound applies on every listed weekday", async () => {
    mockSchedules = [{ serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [entry("08:00")] }];
    for (const from of ["2020-01-06", "2026-10-19", "2031-06-02"]) {
      const result = await resolveWeek("campus-inja", from);
      expect(result!.days[0].display).toBe("schedule");
    }
  });

  it("a replace override wins on a date outside every range", async () => {
    mockSchedules = [pilot];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-10-14", type: "replace", label: "시범 운행", notices: [], entries: [entry("09:00")] },
    ];
    const result = await resolveWeek("campus-inja", "2026-10-12");
    expect(result!.days[2].display).toBe("schedule");
    expect((result!.days[2].schedule[0] as { time: string }).time).toBe("09:00");
    expect(result!.days[1].display).toBe("hidden");
  });

  it("a holiday inside the range resolves to no service with its label", async () => {
    mockSchedules = [pilot];
    getNonOperatingDayLabel.mockImplementation((d: string) => (d === "2026-10-21" ? "휴일" : null));
    const result = await resolveWeek("campus-inja", "2026-10-19");
    expect(result!.days[2].display).toBe("noService");
    expect(result!.days[2].label).toBe("휴일");
    expect(result!.days[1].display).toBe("schedule");
  });

  it("two applying patterns: the later effectiveFrom is served and one error names both", async () => {
    mockSchedules = [
      { serviceId: "campus-jain", patternId: "old-weekday", days: [1, 2, 3, 4, 5], entries: [entry("08:00")] },
      { serviceId: "campus-jain", patternId: "new-weekday", days: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-19", entries: [entry("09:30")] },
    ];
    const result = await resolveWeek("campus-jain", "2026-10-19");
    expect((result!.days[1].schedule[0] as { time: string }).time).toBe("09:30");

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

describe("resolveSmartSchedule across a range start", () => {
  const pilot = {
    serviceId: "campus-inja",
    patternId: "pilot",
    days: [1, 2, 3, 4, 5],
    effectiveFrom: "2026-10-19",
    entries: [{ index: 1, time: "07:40", routeType: "regular", busCount: 1, notes: null }],
  };

  afterEach(() => jest.useRealTimers());

  it("opens on the first day of a range that starts next week", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-14T03:00:00.000Z")); // Wed 12:00 KST
    mockSchedules = [pilot];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result).toMatchObject({ status: "active", from: "2026-10-19", selectedDate: "2026-10-19" });
    // No field or status a pre-range client does not already handle.
    expect(Object.keys(result!).sort()).toEqual(["days", "from", "selectedDate", "serviceId", "status"]);
  });

  it("reports noData when the range starts two weeks out", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-05T03:00:00.000Z")); // Mon 12:00 KST
    mockSchedules = [pilot];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result).toMatchObject({ status: "noData", from: null, selectedDate: null, days: [] });
    expect(Object.keys(result!).sort()).toEqual(["days", "from", "selectedDate", "serviceId", "status"]);
  });
});

describe("resolveSmartSchedule", () => {
  it("on a weekday with schedule, selectedDate = today and hidden days filtered", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result).not.toBeNull();
    expect(result!.selectedDate).toBe("2026-03-10");
    expect(result!.from).toBe("2026-03-09");
    expect(result!.days.every((d) => d.display !== "hidden")).toBe(true);
    expect(result!.days).toHaveLength(5);
    jest.useRealTimers();
  });

  it("on Saturday, selectedDate crosses to next week Monday", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-14T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.selectedDate).toBe("2026-03-16");
    expect(result!.from).toBe("2026-03-16");
    expect(result!.days).toHaveLength(5);
    jest.useRealTimers();
  });

  it("holiday (noService override) on today, selectedDate skips to next schedule day", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "noService", label: "공휴일", notices: [], entries: [] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.selectedDate).toBe("2026-03-10");
    const holidayDay = result!.days.find((d) => d.date === "2026-03-09");
    expect(holidayDay).toBeDefined();
    expect(holidayDay!.display).toBe("noService");
    expect(holidayDay!.label).toBe("공휴일");
    jest.useRealTimers();
  });

  it("announced closure (noService override with notices) on today → selectedDate is today", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-12T03:00:00.000Z")); // Thu
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-12", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
      { serviceId: "campus-inja", date: "2026-03-13", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("active");
    expect(result!.selectedDate).toBe("2026-03-12");
    expect(result!.from).toBe("2026-03-09");
    const today = result!.days.find((d) => d.date === "2026-03-12");
    expect(today!.display).toBe("noService");
    expect(today!.notices).toHaveLength(1);
    jest.useRealTimers();
  });

  it("announced closure later in the week does not beat an earlier schedule day", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-11T03:00:00.000Z")); // Wed
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-12", type: "noService", label: "축제 기간", notices: [{ style: "info", text: "축제 인자셔틀을 확인해 주세요" }], entries: [] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.selectedDate).toBe("2026-03-11");
    jest.useRealTimers();
  });

  it("fasttrack with only override days → only those days visible", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    mockSchedules = [];
    mockOverrides = [
      { serviceId: "fasttrack-inja", date: "2026-03-09", type: "replace", label: "ESKARA 1일차", notices: [], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
      { serviceId: "fasttrack-inja", date: "2026-03-10", type: "replace", label: "ESKARA 2일차", notices: [], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("fasttrack-inja");
    expect(result!.selectedDate).toBe("2026-03-09");
    expect(result!.days).toHaveLength(2);
    expect(result!.days[0].date).toBe("2026-03-09");
    expect(result!.days[1].date).toBe("2026-03-10");
    jest.useRealTimers();
  });

  it("all days hidden → status noData, selectedDate null, days empty", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    mockSchedules = [];
    mockOverrides = [];

    const result = await resolveSmartSchedule("fasttrack-inja");
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
    const result = await resolveSmartSchedule("nonexistent");
    expect(result).toBeNull();
  });

  it("response has correct shape", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
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
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const callsBefore = mockCollection.mock.calls.length;
    const result = await resolveSmartSchedule("campus-inja");

    expect(result!.status).toBe("suspended");
    expect(result!.resumeDate).toBe("2026-09-01");
    expect(result!.from).toBeNull();
    expect(result!.selectedDate).toBeNull();
    expect(result!.days).toHaveLength(0);
    expect(mockCollection.mock.calls.length).toBe(callsBefore);

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("outside suspend period → status active", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-02T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("active");
    expect(result!.selectedDate).not.toBeNull();

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend null → status active when schedule exists", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("active");
    jest.useRealTimers();
  });

  it("suspend boundary: until day itself → suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-31T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend boundary: day after until → not suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend boundary: from day itself → suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-21T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend boundary: day before from → not suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-20T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("invalid suspend config (from > until) → ignored, logs warning", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-08-31", until: "2026-06-21" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "campus-inja", suspend: expect.any(Object) }),
      expect.stringContaining("invalid suspend config"),
    );

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("invalid suspend date format → ignored, logs warning", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "bad-date", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "campus-inja" }),
      expect.stringContaining("invalid suspend config"),
    );

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("onModuleInit warns (non-fatal) when ensureScheduleIndexes rejects", async () => {
    const { ensureScheduleIndexes } = require("../../../src/bus/schedule/schedule-db");
    ensureScheduleIndexes.mockRejectedValueOnce(new Error("idx boom"));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: "bus.schedule.indexes_failed",
        err: expect.objectContaining({ message: "idx boom" }),
      },
      expect.stringContaining("ensureScheduleIndexes failed"),
    );
  });
});

describe("clearCacheForService", () => {
  it("clears only entries for a specific service", async () => {
    mockSchedules = [];

    await resolveWeek("campus-inja", "2026-03-09");
    await resolveWeek("campus-inja", "2026-03-16");
    const callsBefore = mockCollection.mock.calls.length;

    clearCacheForService("campus-inja");

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe("자과캠 통학셔틀 resolution (built from scripts/data/commute-schedule.json)", () => {
  // The committed file, built the way the tool writes it, served from the
  // mocked collection: what prod resolves after `npm run schedule --create`.
  const fs = require("fs");
  const path = require("path");
  const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
  const commuteDocs: Array<{ serviceId: string }> = buildDocuments(
    parseTimetableFile(
      JSON.parse(fs.readFileSync(path.join(__dirname, "../../../scripts/data/commute-schedule.json"), "utf8")),
    ),
  );
  const docsFor = (serviceId: string) => commuteDocs.filter((d) => d.serviceId === serviceId);

  it("hides the weekend of the first week", async () => {
    mockSchedules = docsFor("commute-jamsil");
    const week = await resolveWeek("commute-jamsil", "2026-10-19");
    expect(week!.days.slice(0, 5).map((d) => d.display)).toEqual(Array(5).fill("schedule"));
    expect(week!.days[5]).toMatchObject({ date: "2026-10-24", display: "hidden" });
    expect(week!.days[6]).toMatchObject({ date: "2026-10-25", display: "hidden" });
  });

  it("serves no timetable after the pilot", async () => {
    mockSchedules = docsFor("commute-dogok");
    const week = await resolveWeek("commute-dogok", "2026-12-21");
    expect(week!.days[0]).toMatchObject({ date: "2026-12-21", display: "hidden", schedule: [] });
  });

  it("adds the via-route notice second, on the 강남·양재 tab only", async () => {
    mockSchedules = docsFor("commute-gangnam-yangjae");
    const gy = await resolveWeek("commute-gangnam-yangjae", "2026-11-02");
    for (const day of gy!.days.filter((d) => d.display === "schedule")) {
      expect(day.notices.map((n) => n.text)).toEqual([
        "시범 운행 · 무료 · 킹고M QR 탑승",
        "등교: 강남역 → 양재역 → 자과캠\n하교: 자과캠 → 양재역 → 강남역",
      ]);
    }
    mockSchedules = docsFor("commute-jeongja");
    const jeongja = await resolveWeek("commute-jeongja", "2026-11-02");
    expect(jeongja!.days[0]!.notices).toHaveLength(1);
  });

  it("opens every operating day with the pilot notice", async () => {
    for (const serviceId of [
      "commute-jeongja",
      "commute-jamsil",
      "commute-dogok",
      "commute-gangnam-yangjae",
      "commute-gwanggyo",
    ]) {
      mockSchedules = docsFor(serviceId);
      const week = await resolveWeek(serviceId, "2026-11-02");
      for (const day of week!.days.filter((d) => d.display === "schedule")) {
        expect(day.notices[0]!.text).toMatch(/시범 운행.*무료.*킹고M QR/);
      }
    }
  });
});
