/**
 * The 자과캠 통학셔틀 group, against the commute-shuttle spec: labels that fit
 * old clients, a card visible only during the pilot (Asia/Seoul), and the
 * committed timetable.
 *
 * Unlike the 인자셔틀 data test, the departure times ARE pinned here: they are
 * the spec's scenarios (the school's notice with its 2026-10-07 corrections,
 * confirmed by the 2026-10-08 draft), so a change to them is a spec change.
 */
import fs from "fs";
import path from "path";
import { getBusGroups } from "../../../src/bus/bus-config/bus-config.data";
import { getBusList } from "../../../src/ui/ui/ui.buslist";

const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");

const COMMUTE_FILE = path.join(__dirname, "../../../scripts/data/commute-schedule.json");
type Doc = {
  serviceId: string;
  days: number[];
  effectiveFrom: string;
  effectiveUntil?: string;
  entries: Array<{ time: string; routeType: string; busCount: number; notes: string | null }>;
};
const commuteDocs: Doc[] = buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(COMMUTE_FILE, "utf8"))));

function runs(serviceId: string): string[] {
  return commuteDocs
    .find((d) => d.serviceId === serviceId)!
    .entries.map((e) => `${e.routeType} ${e.time}${e.notes ? ` (${e.notes})` : ""}`);
}

describe("commute timetable (spec scenarios)", () => {
  it("정자", () => {
    expect(runs("commute-jeongja")).toEqual([
      "up 07:45", "up 09:20", "up 11:00",
      "down 16:30", "down 18:30", "down 20:30",
    ]);
  });

  it("잠실", () => {
    expect(runs("commute-jamsil")).toEqual(["up 07:30", "up 10:20", "down 18:00", "down 21:00"]);
  });

  it("도곡", () => {
    expect(runs("commute-dogok")).toEqual(["up 07:40", "up 09:40", "down 16:30", "down 18:45"]);
  });

  it("강남·양재: one entry per run at the 강남 time, the 양재 time in its notes", () => {
    expect(runs("commute-gangnam-yangjae")).toEqual([
      "up 07:40 (양재 07:45)",
      "up 08:55 (양재 09:00)",
      "up 10:25 (양재 10:30)",
      "up 11:55 (양재 12:00)",
      "down 17:00", "down 18:00", "down 19:15", "down 20:15",
    ]);
  });

  it("광교중앙", () => {
    expect(runs("commute-gwanggyo")).toEqual([
      "up 08:00", "up 08:30", "up 09:00", "up 09:30", "up 10:00", "up 10:30",
      "down 16:30", "down 17:00", "down 17:30", "down 18:00", "down 18:30", "down 19:00",
    ]);
  });

  it("one bus per run, weekdays only, over the pilot window", () => {
    expect(commuteDocs).toHaveLength(5);
    for (const doc of commuteDocs) {
      expect(doc.days).toEqual([1, 2, 3, 4, 5]);
      expect(doc.effectiveFrom).toBe("2026-10-19");
      expect(doc.effectiveUntil).toBe("2026-12-18");
      for (const entry of doc.entries) expect(entry.busCount).toBe(1);
    }
  });
});

type Group = ReturnType<typeof getBusGroups>[number];

function commute(lang: "ko" | "en" | "zh" = "ko"): Group & { screen: Record<string, any> } {
  return getBusGroups(lang).find((g) => g.id === "commute") as Group & { screen: Record<string, any> };
}

describe("commute group config", () => {
  it("labels every route in five Korean characters or fewer, for v1 segmented controls", () => {
    const labels = commute("ko").screen.services.map((s: { label: string }) => s.label);
    expect(labels).toEqual(["정자", "잠실", "도곡", "강남·양재", "광교중앙"]);
    for (const label of labels) expect([...label].length).toBeLessThanOrEqual(5);
  });

  it("is labeled 자과캠 통학 셔틀버스 and has a badge for each direction", () => {
    const group = commute("ko");
    expect(group.label).toBe("자과캠 통학 셔틀버스");
    expect(group.screen.routeBadges.map((b: { id: string; label: string }) => `${b.id}:${b.label}`)).toEqual([
      "up:등교",
      "down:하교",
    ]);
  });

  it("translates every label it serves", () => {
    for (const lang of ["en", "zh"] as const) {
      const group = commute(lang);
      const texts = [group.label, ...group.screen.services.map((s: { label: string }) => s.label)];
      for (const text of texts) expect(text).not.toMatch(/^busconfig\./);
    }
  });
});

describe("commute card visibility", () => {
  afterEach(() => jest.useRealTimers());

  const listedAt = (iso: string) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(iso));
    return getBusList("ko").some((item) => item.groupId === "commute");
  };

  it("is absent the minute before the pilot starts", () => {
    expect(listedAt("2026-10-18T14:59:00.000Z")).toBe(false); // 2026-10-18 23:59 KST
  });

  it("is present from the first day", () => {
    expect(listedAt("2026-10-18T15:00:00.000Z")).toBe(true); // 2026-10-19 00:00 KST
  });

  it("is present until the end of the last day", () => {
    expect(listedAt("2026-12-18T14:59:00.000Z")).toBe(true); // 2026-12-18 23:59 KST
    expect(listedAt("2026-12-18T15:00:00.000Z")).toBe(false); // 2026-12-19 00:00 KST
  });
});

describe("commute boarding (spec scenarios, from the committed catalog)", () => {
  const CAMPUS_SEQUENCE = "N센터 인근 → CNS센터 → 산학협력센터 인근 → 학생회관 인근";
  const services = (lang: "ko" | "en" | "zh" = "ko") =>
    commute(lang).screen.services as Array<{
      serviceId: string;
      boarding: Array<{ routeTypes: string[]; stopId: string; alight?: string }>;
    }>;
  const stops = (lang: "ko" | "en" | "zh" = "ko") =>
    commute(lang).screen.stops as Array<Record<string, any>>;
  const stopById = (id: string, lang: "ko" | "en" | "zh" = "ko") => stops(lang).find((s) => s.id === id)!;

  it("정자 boarding", () => {
    const jeongja = services().find((s) => s.serviceId === "commute-jeongja")!;
    const up = jeongja.boarding.find((b) => b.routeTypes.includes("up"))!;
    const down = jeongja.boarding.find((b) => b.routeTypes.includes("down"))!;
    expect(stopById(up.stopId)).toMatchObject({ name: "정자역 3번 출구", detail: "파리바게뜨 앞" });
    expect(stopById(down.stopId).name).toBe("N센터 건너편");
  });

  it("every route type of every service boards somewhere, and each is a badge of the group", () => {
    const badgeIds = commute().screen.routeBadges.map((b: { id: string }) => b.id);
    const expected: Record<string, string[]> = {
      "commute-jeongja": ["up", "down"],
      "commute-jamsil": ["up", "down"],
      "commute-dogok": ["up", "down"],
      "commute-gangnam-yangjae": ["up", "up", "down"],
      "commute-gwanggyo": ["up", "down"],
    };
    for (const s of services()) {
      const routeTypes = s.boarding.flatMap((b) => b.routeTypes);
      expect(routeTypes.sort()).toEqual([...expected[s.serviceId]!].sort());
      for (const rt of routeTypes) expect(badgeIds).toContain(rt);
    }
  });

  it("Drop-off sequence: every 등교 run lets riders off at the campus stops in order", () => {
    for (const s of services()) {
      for (const b of s.boarding.filter((e) => e.routeTypes.some((rt) => rt.startsWith("up")))) {
        expect(b.alight).toBe(CAMPUS_SEQUENCE);
      }
    }
  });

  it("하교 drop-off lines match the school's 2026-10-08 answer", () => {
    const down = Object.fromEntries(
      services().map((s) => [s.serviceId, s.boarding.find((b) => b.routeTypes.includes("down"))!.alight]),
    );
    expect(down).toEqual({
      "commute-jeongja": "정자역 2번 출구 앞",
      "commute-jamsil": "잠실역 5번 출구 앞",
      "commute-dogok": "도곡역 4번 출구 앞",
      "commute-gangnam-yangjae": "양재역 3번 출구 앞 → 강남역 사거리 전 중앙버스차로 정류장",
      "commute-gwanggyo": "광교중앙역 1번 출구 앞",
    });
  });

  it("강남·양재 등교 runs board at 강남, then 양재", () => {
    const gy = services().find((s) => s.serviceId === "commute-gangnam-yangjae")!;
    expect(gy.boarding.filter((b) => b.routeTypes.includes("up")).map((b) => b.stopId)).toEqual([
      "gangnam-exit5",
      "yangjae-exit2",
    ]);
  });

  it("하교 drop-off order: 양재 before the 강남 bus stop", () => {
    const gy = services().find((s) => s.serviceId === "commute-gangnam-yangjae")!;
    const alight = gy.boarding.find((b) => b.routeTypes.includes("down"))!.alight!;
    expect(alight.indexOf("양재역 3번 출구")).toBeLessThan(alight.indexOf("강남역"));
  });

  it("Station stop in English: its en photo, a street view link, the exit and the path", () => {
    const stationIds = ["jeongja-exit3", "jamsil-exit4", "dogok-exit1", "gangnam-exit5", "yangjae-exit2", "gwanggyo-exit4"];
    expect(stops("en").map((s) => s.id).sort()).toEqual([...stationIds, "nsc-opposite"].sort());
    for (const id of stationIds) {
      const stop = stopById(id, "en");
      expect(stop.photoUrl).toMatch(new RegExp(`^https://media\\.skkuverse\\.com/commute/stops/${id}/en-[0-9a-f]{8}\\.jpg$`));
      expect(stop.streetViewUrl).toMatch(/^https:\/\/inapp\.map\.naver\.com\/launchApp\/panorama\/street\?/);
      expect(stop.exit.number).toBeGreaterThan(0);
      expect(stop.walkPath[stop.walkPath.length - 1]).toEqual(stop.coords);
    }
  });

  it("Campus stop: the original photo in any language, a street view link, no exit or path", () => {
    for (const lang of ["ko", "en", "zh"] as const) {
      const stop = stopById("nsc-opposite", lang);
      expect(stop.photoUrl).toMatch(/^https:\/\/media\.skkuverse\.com\/commute\/stops\/nsc-opposite\/original-[0-9a-f]{8}\.jpg$/);
      expect(stop.streetViewUrl).toBeDefined();
      expect(stop).not.toHaveProperty("exit");
      expect(stop).not.toHaveProperty("walkPath");
    }
  });

  it("each station's photo variant matches the request language", () => {
    for (const lang of ["ko", "zh"] as const) {
      expect(stopById("yangjae-exit2", lang).photoUrl).toContain(`/yangjae-exit2/${lang}-`);
    }
  });
});
