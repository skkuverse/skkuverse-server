/**
 * The committed campus shuttle timetable — scripts/data/campus-schedule.json
 * and the reader that turns it into bus_schedules documents.
 *
 * These tests deliberately do NOT snapshot the departure times. A test
 * asserting `entries[3].time === "10:00"` is a change-detector: it gets edited
 * in the same commit as the data it claims to verify, so it can never fail for
 * a reason anyone cares about. What is pinned here is the SHAPE the data must
 * always have, and one real cross-file contract (routeType ↔ routeBadges) that
 * nothing else checks.
 *
 * The database is not this file's job. `npm run schedule -- --check --prod`
 * answers "is prod the file"; jest answers "is the file well-formed".
 */

import fs from "fs";
import path from "path";
import { BusConfigService } from "../../../src/bus/config/bus-config.service";
import type { BusGroup } from "../../../src/bus/config/bus-config.wire";
import { storedBusRegistryService } from "../../helpers/bus/bus-registry";
import { storedRouteAttributesService } from "../../helpers/bus/route-attributes";
import { storedBusStopsService } from "../../helpers/bus/bus-stops";
import type { SupportedLang } from "../../../src/infra/types";

let busConfig: BusConfigService;
const groupsByLang = new Map<SupportedLang, BusGroup[]>();
// WHY: the stations come from the registry, holding the routes stored on 2026-10-17; the groups are read once.
beforeAll(async () => {
  busConfig = new BusConfigService(storedBusStopsService(), storedBusRegistryService(), storedRouteAttributesService());
  for (const lang of ["ko", "en", "zh"] as const) groupsByLang.set(lang, await busConfig.getBusGroups(lang));
});
const getBusGroups = (lang: SupportedLang = "ko"): BusGroup[] => groupsByLang.get(lang)!;

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const {
  buildDocuments,
  diffRange,
  findOverlaps,
  parseTimetableFile,
} = require("../../../scripts/lib/campus-schedule-file");

const REAL_FILE = path.join(__dirname, "../../../scripts/data/campus-schedule.json");
const realTimetable = JSON.parse(fs.readFileSync(REAL_FILE, "utf8"));

/** A minimal valid file; each test bends one thing about it. */
function makeFile(entries: unknown[], extra: Record<string, unknown> = {}) {
  return {
    semester: "2026-2",
    effectiveFrom: "2026-08-31",
    routeTypes: ["regular", "hakbu"],
    ...extra,
    patterns: [
      {
        patternId: "weekday",
        days: [1, 2, 3, 4],
        serviceIds: ["campus-inja"],
        entries,
      },
    ],
  };
}

const OK_ENTRY = { time: "08:00", routeType: "regular", busCount: 1, notes: null };

describe("the committed timetable", () => {
  it("parses and builds one document per (serviceId, patternId)", () => {
    // Act
    const docs = buildDocuments(parseTimetableFile(realTimetable));

    // Assert
    expect(docs.map((d: { serviceId: string; patternId: string }) => `${d.serviceId}/${d.patternId}`).sort()).toEqual([
      "campus-inja/friday",
      "campus-inja/weekday",
      "campus-jain/friday",
      "campus-jain/weekday",
    ]);
  });

  it("gives each service a non-overlapping Mon–Fri partition", () => {
    // Arrange
    const docs = buildDocuments(parseTimetableFile(realTimetable));
    const byService = new Map<string, number[]>();
    for (const doc of docs) {
      byService.set(doc.serviceId, [...(byService.get(doc.serviceId) ?? []), ...doc.days]);
    }

    // Act & Assert
    for (const [serviceId, days] of byService) {
      expect(`${serviceId}:${[...days].sort().join(",")}`).toBe(`${serviceId}:1,2,3,4,5`);
    }
  });

  it("numbers index 1..N by position in every document", () => {
    // Act & Assert
    for (const doc of buildDocuments(parseTimetableFile(realTimetable))) {
      expect(doc.entries.map((e: { index: number }) => e.index)).toEqual(
        doc.entries.map((_: unknown, i: number) => i + 1),
      );
    }
  });

  it("only uses routeTypes the app has a badge for", () => {
    // Imported, not hardcoded: routeType is the join key between this data and
    // the client's badge list. A routeType with no matching badge renders as a
    // blank chip on a live screen and no server test would ever see it, because
    // BusScheduleDoc.entries is unknown[] and no server code reads routeType.
    // Arrange
    const campus = getBusGroups("ko").find((g) => g.id === "campus");

    // Act
    const badgeIds = (campus as { screen: { routeBadges: Array<{ id: string }> } }).screen.routeBadges.map(
      (b) => b.id,
    );

    // Assert
    expect(badgeIds.length).toBeGreaterThan(0);

    for (const doc of buildDocuments(parseTimetableFile(realTimetable))) {
      for (const entry of doc.entries) {
        expect(badgeIds).toContain(entry.routeType);
      }
    }
  });

  it("holds the 2026-2 shape: 7 weekday, 19 Friday, 14 hakbu buses", () => {
    // Act
    const docs = buildDocuments(parseTimetableFile(realTimetable));

    // Assert
    for (const doc of docs) {
      expect(doc.entries).toHaveLength(doc.patternId === "weekday" ? 7 : 19);
    }
    const friday = docs.find((d: { patternId: string }) => d.patternId === "friday");
    const hakbuBuses = friday.entries
      .filter((e: { routeType: string }) => e.routeType === "hakbu")
      .reduce((sum: number, e: { busCount: number }) => sum + e.busCount, 0);
    expect(hakbuBuses).toBe(14);
  });
});

describe("every committed timetable file", () => {
  // The tool is plain CommonJS and cannot import service-config.ts or the
  // badges, so the cross-file contract is checked here, for each file.
  const DATA_DIR = path.join(__dirname, "../../../scripts/data");
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith("-schedule.json"));
  const serviceConfig = require("../../../src/bus/bus.constants").SERVICE_CONFIG;

  it("finds both shuttles' files", () => {
    // Act & Assert
    expect(files.sort()).toEqual(["campus-schedule.json", "commute-schedule.json"]);
  });

  describe.each(files)("%s", (file) => {
    const docs: Array<{
      serviceId: string;
      entries: Array<{ time: string; routeType: string; notes: string | null; stopTimes?: Array<string | null> }>;
    }> = buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"))));
    type SeqStop = { timing: string; note?: string };
    const groupsOf = () => getBusGroups("ko") as unknown as Array<{
      id: string;
      screenType: string;
      screen: {
        services?: Array<{ serviceId: string; stopSequences?: Record<string, SeqStop[]> }>;
        routeBadges?: Array<{ id: string }>;
      };
    }>;
    const service = (serviceId: string) =>
      groupsOf().flatMap((g) => g.screen.services ?? []).find((s) => s.serviceId === serviceId);

    it("names only services that serviceConfig defines", () => {
      // Act & Assert
      for (const doc of docs) expect(Object.keys(serviceConfig)).toContain(doc.serviceId);
    });

    it("uses only route types that have a badge in the group listing the service", () => {
      // Act & Assert
      for (const doc of docs) {
        const group = groupsOf().find((g) => g.screen.services?.some((s) => s.serviceId === doc.serviceId));
        expect(group).toBeDefined();
        const badgeIds = group!.screen.routeBadges!.map((b) => b.id);
        for (const entry of doc.entries) expect(badgeIds).toContain(entry.routeType);
      }
    });

    // The tool is CommonJS and cannot see the stop catalog, so this is where the two files meet.
    it("gives every route type a stop sequence, and every sequence route type a badge", () => {
      // Act & Assert
      for (const doc of docs) {
        const group = groupsOf().find((g) => g.screen.services?.some((s) => s.serviceId === doc.serviceId))!;
        const badgeIds = group.screen.routeBadges!.map((b) => b.id);
        const seq = service(doc.serviceId)!.stopSequences ?? {};
        for (const rt of new Set(doc.entries.map((e) => e.routeType))) {
          expect(`${doc.serviceId}.${rt}`).toBe(`${doc.serviceId}.${rt in seq ? rt : "(no sequence)"}`);
        }
        for (const rt of Object.keys(seq)) expect(badgeIds).toContain(rt);
      }
    });

    it("gives every run one stop time per sequence stop, null only where the stop is estimated", () => {
      // Act & Assert
      for (const doc of docs) {
        const seq = service(doc.serviceId)!.stopSequences!;
        for (const e of doc.entries) {
          const stops = seq[e.routeType]!;
          const at = `${doc.serviceId} ${e.routeType} ${e.time}`;
          expect(`${at} ${e.stopTimes?.length}`).toBe(`${at} ${stops.length}`);
          e.stopTimes!.forEach((t, k) => {
            if (t === null) expect(`${at} #${k} ${stops[k]!.timing}`).toBe(`${at} #${k} estimated`);
          });
        }
      }
    });

    it("keeps every sequence stop note to eight characters, for the timetable's notes column", () => {
      // Act & Assert
      for (const doc of docs) {
        for (const seq of Object.values(service(doc.serviceId)!.stopSequences!)) {
          for (const st of seq) expect([...(st.note ?? "")].length).toBeLessThanOrEqual(8);
        }
      }
    });
  });

  it("gives every 인자셔틀 entry notes: null (the 특이사항 column is dropped)", () => {
    // Act
    const docs = buildDocuments(parseTimetableFile(realTimetable));

    // Assert
    for (const doc of docs) {
      for (const e of doc.entries) expect(`${doc.serviceId} ${e.time} ${e.notes}`).toBe(`${doc.serviceId} ${e.time} null`);
    }
  });
});

describe("parseTimetableFile rejects", () => {
  it("a hand-written index, by name", () => {
    // The whole reason buildDocuments derives index from position: a
    // hand-maintained 1..19 grows a duplicate the first time somebody inserts
    // a bus in the middle. Ignoring the key would hide that; rejecting says it.

    // Act & Assert
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, index: 1 }]))).toThrow(/must not carry "index"/);
  });

  it("an unknown entry key", () => {
    // Act & Assert
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, isAvailableBus: true }]))).toThrow(
      /unknown entry key/,
    );
  });

  it.each([["24:00"], ["8:00"], ["07:60"], ["0700"]])("a malformed time %s", (time) => {
    // Act & Assert
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, time }]))).toThrow(/entry\.time/);
  });

  it.each([[0], [-1], [1.5], ["1"], [null]])("a busCount of %p", (busCount) => {
    // Act & Assert
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, busCount }]))).toThrow(/busCount/);
  });

  it("a routeType the file does not declare, naming the pattern and the time", () => {
    // Act
    const file = makeFile([{ ...OK_ENTRY, routeType: "hakbu" }], { routeTypes: ["up", "down"] });

    // Assert
    expect(() => parseTimetableFile(file)).toThrow(/^weekday 08:00: routeType must be one of the declared up\/down/);
  });

  it.each([[undefined], [[]], [["up", "up"]], [["up", ""]]])("a routeTypes declaration of %p", (routeTypes) => {
    // Act & Assert
    expect(() => parseTimetableFile(makeFile([OK_ENTRY], { routeTypes }))).toThrow(/routeTypes must be/);
  });

  it("an effectiveUntil earlier than effectiveFrom", () => {
    // Act & Assert
    expect(() => parseTimetableFile(makeFile([OK_ENTRY], { effectiveUntil: "2026-08-30" }))).toThrow(
      /effectiveUntil 2026-08-30 is earlier than effectiveFrom 2026-08-31/,
    );
  });

  it("a malformed effectiveUntil", () => {
    // Act & Assert
    expect(() => parseTimetableFile(makeFile([OK_ENTRY], { effectiveUntil: "2026-12" }))).toThrow(
      /effectiveUntil must be YYYY-MM-DD/,
    );
  });

  it("a duplicate (time, routeType)", () => {
    // Act & Assert
    expect(() => parseTimetableFile(makeFile([OK_ENTRY, { ...OK_ENTRY }]))).toThrow(/duplicate entry/);
  });

  it("entries out of time order", () => {
    // Act & Assert
    expect(() =>
      parseTimetableFile(makeFile([{ ...OK_ENTRY, time: "10:00" }, { ...OK_ENTRY, time: "09:00" }])),
    ).toThrow(/must be sorted/);
  });

  it("hakbu placed before regular at the same time", () => {
    // Act & Assert
    expect(() =>
      parseTimetableFile(
        makeFile([
          { ...OK_ENTRY, routeType: "hakbu" },
          { ...OK_ENTRY, routeType: "regular" },
        ]),
      ),
    ).toThrow(/must be sorted/);
  });

  it("two patterns of one service claiming the same weekday", () => {
    // Both share the file's range, so both would apply on that weekday. At
    // runtime the engine only logs a pattern_conflict and serves one of them.
    // Arrange
    const file = makeFile([OK_ENTRY]);
    file.patterns.push({ ...file.patterns[0]!, patternId: "other" });

    // Act & Assert
    expect(() => parseTimetableFile(file)).toThrow(/claimed by more than one pattern/);
  });
});

describe("stopTimes", () => {
  const withStops = (stopTimes: unknown) => makeFile([{ ...OK_ENTRY, stopTimes }]);

  it("are written into the document when present, and absent otherwise", () => {
    // Arrange
    const [withTimes] = buildDocuments(parseTimetableFile(withStops(["08:00", null, "09:10"])));

    // Act & Assert
    expect(withTimes.entries[0].stopTimes).toEqual(["08:00", null, "09:10"]);
    const [plain] = buildDocuments(parseTimetableFile(makeFile([OK_ENTRY])));
    expect(plain.entries[0]).not.toHaveProperty("stopTimes");
  });

  it.each([
    [["08:00"], /at least two stops/],
    ["08:00", /at least two stops/],
    [["08:00", "9:10"], /HH:mm or null/],
    [["07:55", "09:10"], /stopTimes\[0\] must equal time/],
    [["08:00", "09:10", "08:30"], /must not go back in time — 08:30 follows 09:10/],
  ])("rejects stopTimes %p", (stopTimes, message) => {
    // Act & Assert
    expect(() => parseTimetableFile(withStops(stopTimes))).toThrow(message);
  });
});

describe("declared route-type order", () => {
  it("sorts same-minute entries by the file's order, not a fixed one", () => {
    // Act
    const entries = [
      { ...OK_ENTRY, routeType: "hakbu" },
      { ...OK_ENTRY, routeType: "regular" },
    ];

    // Assert
    expect(() => parseTimetableFile(makeFile(entries, { routeTypes: ["hakbu", "regular"] }))).not.toThrow();
  });
});

describe("the effective range in built documents", () => {
  it("writes effectiveFrom into every document, and no effectiveUntil when the file has none", () => {
    // Act & Assert
    for (const doc of buildDocuments(parseTimetableFile(makeFile([OK_ENTRY])))) {
      expect(doc.effectiveFrom).toBe("2026-08-31");
      expect(doc).not.toHaveProperty("effectiveUntil");
    }
  });

  it("writes effectiveUntil when the file declares it", () => {
    // Act
    const docs = buildDocuments(parseTimetableFile(makeFile([OK_ENTRY], { effectiveUntil: "2026-12-18" })));

    // Assert
    expect(docs[0]).toMatchObject({ effectiveFrom: "2026-08-31", effectiveUntil: "2026-12-18" });
  });

  it("reports a range drift the way check mode prints it", () => {
    // Act & Assert
    expect(diffRange({ effectiveFrom: "2026-08-31" }, { effectiveFrom: "2026-08-31", effectiveUntil: "2026-12-18" })).toEqual([
      'effectiveUntil null -> "2026-12-18"',
    ]);
    expect(diffRange({ days: [1] }, { effectiveFrom: "2026-08-31" })).toEqual(['effectiveFrom null -> "2026-08-31"']);
    expect(diffRange({ effectiveFrom: "2026-08-31" }, { effectiveFrom: "2026-08-31" })).toEqual([]);
  });
});

describe("findOverlaps", () => {
  const doc = (patternId: string, days: number[], effectiveFrom?: string, effectiveUntil?: string) => ({
    serviceId: "commute-jeongja",
    patternId,
    days,
    ...(effectiveFrom ? { effectiveFrom } : {}),
    ...(effectiveUntil ? { effectiveUntil } : {}),
  });

  it("refuses a pattern whose weekdays and range overlap another one", () => {
    // Arrange
    const target = doc("pilot", [1, 2, 3, 4, 5], "2026-10-19", "2026-12-18");

    // Act
    const other = doc("draft", [5], "2026-12-01", "2026-12-31");

    // Assert
    expect(findOverlaps([target], [other])).toEqual([{ target, other }]);
  });

  it("accepts back-to-back ranges on the same weekdays", () => {
    // Arrange
    const target = doc("pilot", [1, 2, 3, 4, 5], "2026-10-19", "2026-12-18");

    // Act
    const next = doc("winter", [1, 2, 3, 4, 5], "2026-12-21");

    // Assert
    expect(findOverlaps([target], [next])).toEqual([]);
  });

  it("accepts overlapping ranges on disjoint weekdays", () => {
    // Arrange
    const target = doc("weekday", [1, 2, 3, 4], "2026-08-31");

    // Act
    const friday = doc("friday-old", [5], "2026-03-02");

    // Assert
    expect(findOverlaps([target], [friday])).toEqual([]);
  });

  it("refuses a bounded pattern over an unbounded one", () => {
    // Arrange
    const target = doc("pilot", [1, 2, 3, 4, 5], "2026-10-19", "2026-12-18");

    // Act
    const legacy = doc("weekday", [1, 2, 3, 4]);

    // Assert
    expect(findOverlaps([target], [legacy])).toHaveLength(1);
  });

  it("ignores another service, and a document the file itself rewrites", () => {
    // Arrange
    const target = doc("pilot", [1, 2, 3, 4, 5], "2026-10-19");
    const sameKey = doc("pilot", [1, 2, 3, 4, 5]);

    // Act
    const otherService = { ...doc("weekday", [1, 2, 3, 4, 5]), serviceId: "commute-jamsil" };

    // Assert
    expect(findOverlaps([target], [sameKey, otherService])).toEqual([]);
  });
});
