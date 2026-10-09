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
import { haversineM } from "../../../src/bus/schedule/schedule-stops";
import { getBusList } from "../../../src/ui/ui/ui.buslist";

const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");

const COMMUTE_FILE = path.join(__dirname, "../../../scripts/data/commute-schedule.json");
type Doc = {
  serviceId: string;
  days: number[];
  effectiveFrom: string;
  effectiveUntil?: string;
  entries: Array<{ time: string; routeType: string; busCount: number; notes: string | null; stopTimes?: Array<string | null> }>;
};
const commuteDocs: Doc[] = buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(COMMUTE_FILE, "utf8"))));

/** "up 07:40→07:45→08:45": the time at each stop of the run, "?" where unknown. */
function runs(serviceId: string): string[] {
  return commuteDocs
    .find((d) => d.serviceId === serviceId)!
    .entries.map((e) => `${e.routeType} ${(e.stopTimes ?? []).map((t) => t ?? "?").join("→")}`);
}

describe("commute timetable (spec scenarios: departure → arrival per run)", () => {
  it("정자", () => {
    expect(runs("commute-jeongja")).toEqual([
      "up 07:45→08:25", "up 09:20→10:05", "up 11:00→11:45",
      "down 16:30→17:15", "down 18:30→19:15", "down 20:30→21:15",
    ]);
  });

  it("잠실", () => {
    expect(runs("commute-jamsil")).toEqual(["up 07:30→08:40", "up 10:20→11:40", "down 18:00→19:20", "down 21:00→22:20"]);
  });

  it("도곡", () => {
    expect(runs("commute-dogok")).toEqual(["up 07:40→08:45", "up 09:40→10:15", "down 16:30→17:45", "down 18:45→20:30"]);
  });

  it("강남·양재: one row per bus — 강남, then 양재, then campus; 하교 drops at 양재 (5 min before 강남), then 강남", () => {
    expect(runs("commute-gangnam-yangjae")).toEqual([
      "up 07:40→07:45→08:45",
      "up 08:55→09:00→10:15",
      "up 10:25→10:30→11:45",
      "up 11:55→12:00→13:15",
      "down 17:00→18:15→18:20",
      "down 18:00→19:15→19:20",
      "down 19:15→21:00→21:05",
      "down 20:15→22:00→22:05",
    ]);
  });

  it("광교중앙", () => {
    expect(runs("commute-gwanggyo")).toEqual([
      "up 08:00→08:35", "up 08:30→09:05", "up 09:00→09:35", "up 09:30→10:05", "up 10:00→10:35", "up 10:30→11:05",
      "down 16:30→17:05", "down 17:00→17:35", "down 17:30→18:05", "down 18:00→18:35", "down 18:30→19:05", "down 19:00→19:35",
    ]);
  });

  it("keeps the 양재 time in notes for clients that do not read stopTimes", () => {
    const gy = commuteDocs.find((d) => d.serviceId === "commute-gangnam-yangjae")!;
    for (const e of gy.entries.filter((x) => x.routeType === "up")) expect(e.notes).toBe(`양재역 ${e.stopTimes![1]}`);
  });

  it("one bus per run, weekdays only, over the pilot window", () => {
    expect(commuteDocs).toHaveLength(5);
    for (const doc of commuteDocs) {
      expect(doc.days).toEqual([1, 2, 3, 4, 5]);
      expect(doc.effectiveFrom).toBe("2026-10-20");
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

  it("is absent on Monday 2026-10-19, the opening day the school moved", () => {
    expect(listedAt("2026-10-18T15:00:00.000Z")).toBe(false); // 2026-10-19 00:00 KST
    expect(listedAt("2026-10-19T03:00:00.000Z")).toBe(false); // 2026-10-19 12:00 KST
  });

  it("is absent the minute before the pilot starts", () => {
    expect(listedAt("2026-10-19T14:59:00.000Z")).toBe(false); // 2026-10-19 23:59 KST
  });

  it("is present from the first day, Tuesday 2026-10-20", () => {
    expect(listedAt("2026-10-19T15:00:00.000Z")).toBe(true); // 2026-10-20 00:00 KST
  });

  it("is present until the end of the last day", () => {
    expect(listedAt("2026-12-18T14:59:00.000Z")).toBe(true); // 2026-12-18 23:59 KST
    expect(listedAt("2026-12-18T15:00:00.000Z")).toBe(false); // 2026-12-19 00:00 KST
  });
});

describe("commute stop sequences (spec scenarios, from the committed catalog)", () => {
  const CAMPUS_SEQUENCE = "N센터 인근 → CNS센터 → 산학협력센터 인근 → 학생회관 인근";
  type SeqStop = { label: string; action: string; timing: string; stopId?: string; detail?: string };
  const services = (lang: "ko" | "en" | "zh" = "ko") =>
    commute(lang).screen.services as Array<{ serviceId: string; stopSequences: Record<string, SeqStop[]> }>;
  const sequences = (serviceId: string, lang: "ko" | "en" | "zh" = "ko") =>
    services(lang).find((s) => s.serviceId === serviceId)!.stopSequences;
  const stops = (lang: "ko" | "en" | "zh" = "ko") => commute(lang).screen.stops as Array<Record<string, any>>;
  const stopById = (id: string, lang: "ko" | "en" | "zh" = "ko") => stops(lang).find((s) => s.id === id)!;
  const brief = (seq: SeqStop[]) => seq.map((st) => `${st.action}:${st.label}:${st.timing}`);

  it("정자 boarding: the run boards at 정자역 3번 출구 and arrives at campus (estimated)", () => {
    const seq = sequences("commute-jeongja");
    expect(brief(seq.up!)).toEqual(["board:정자역 3번 출구:scheduled", "alight:자과캠:estimated"]);
    expect(stopById(seq.up![0]!.stopId!)).toMatchObject({ name: "정자역 3번 출구", detail: "파리바게뜨 앞" });
    expect(brief(seq.down!)).toEqual(["board:N센터 맞은편:scheduled", "alight:정자역 2번 출구 앞:estimated"]);
  });

  it("강남·양재: 등교 boards at 강남, then 양재; 하교 drops at 양재, then 강남", () => {
    const seq = sequences("commute-gangnam-yangjae");
    expect(brief(seq.up!)).toEqual([
      "board:강남역 5번 출구:scheduled",
      "board:양재역 2번 출구:scheduled",
      "alight:자과캠:estimated",
    ]);
    expect(brief(seq.down!)).toEqual([
      "board:N센터 맞은편:scheduled",
      "alight:양재역 3번 출구 앞:estimated",
      "alight:강남역 사거리 전 중앙버스차로 정류장:estimated",
    ]);
  });

  it("Drop-off sequence: every 등교 run ends at campus, with the campus stops in order as detail", () => {
    for (const s of services()) {
      const last = s.stopSequences.up!.at(-1)!;
      expect(last).toMatchObject({ action: "alight", label: "자과캠", detail: CAMPUS_SEQUENCE });
    }
  });

  it("하교 drop-off spots match the school's 2026-10-08 answer", () => {
    const drops = Object.fromEntries(
      services().map((s) => [s.serviceId, s.stopSequences.down!.filter((st) => st.action === "alight").map((st) => st.label)]),
    );
    expect(drops).toEqual({
      "commute-jeongja": ["정자역 2번 출구 앞"],
      "commute-jamsil": ["잠실역 5번 출구 앞"],
      "commute-dogok": ["도곡역 4번 출구 앞"],
      "commute-gangnam-yangjae": ["양재역 3번 출구 앞", "강남역 사거리 전 중앙버스차로 정류장"],
      "commute-gwanggyo": ["광교중앙역 1번 출구 앞"],
    });
  });

  it("Drop-off with its exit: 정자's 하교 drop-off is a catalog stop with exit 2 and no walk", () => {
    const last = sequences("commute-jeongja").down!.at(-1)!;
    expect(last.stopId).toBe("jeongja-exit2");
    const stop = stopById(last.stopId!);
    expect(stop.coords).toBeDefined();
    expect(stop.map.markers).toEqual([expect.objectContaining({ kind: "subwayExit", number: 2, label: "2번 출구" })]);
    expect(stop.map.paths).toEqual([]);
  });

  it("Drop-off on a median bus lane: the 강남역 bus stop has coordinates and a pin-only map", () => {
    const gangnam = sequences("commute-gangnam-yangjae").down!.at(-1)!;
    const stop = stopById(gangnam.stopId!);
    expect(stop.coords).toBeDefined();
    expect(stop.map).toEqual({ markers: [], paths: [] });
  });

  it("every 하교 drop-off is a catalog stop in front of the exit its name gives, with no walk and no photo", () => {
    for (const s of services()) {
      for (const st of s.stopSequences.down!.filter((x) => x.action === "alight")) {
        const stop = stopById(st.stopId!);
        expect(stop).not.toHaveProperty("photoUrl");
        expect(stop.map.paths).toEqual([]);
        const exit = /(\d+)번 출구 앞$/.exec(stop.name);
        if (exit) {
          expect(stop.map.markers).toHaveLength(1);
          expect(stop.map.markers[0]).toMatchObject({ kind: "subwayExit", number: Number(exit[1]) });
          // "앞": the stop stands at its exit, not a walk away from it.
          expect(haversineM(stop.coords, stop.map.markers[0].coords)).toBeLessThan(20);
        } else {
          expect(stop.map.markers).toEqual([]);
        }
      }
    }
    expect(sequences("commute-gangnam-yangjae").down!.map((st) => st.stopId)).toEqual([
      "nsc-opposite",
      "yangjae-exit3",
      "gangnam-median",
    ]);
  });

  it("Station stop in English: its en photo, a street view link, and a map with the exit and a walk to the stop", () => {
    const stationIds = ["jeongja-exit3", "jamsil-exit4", "dogok-exit1", "gangnam-exit5", "yangjae-exit2", "gwanggyo-exit4"];
    expect(stops("en").map((s) => s.id)).toEqual(expect.arrayContaining([...stationIds, "nsc-opposite"]));
    for (const id of stationIds) {
      const stop = stopById(id, "en");
      expect(stop.photoUrl).toMatch(new RegExp(`^https://media\\.skkuverse\\.com/commute/stops/${id}/en-[0-9a-f]{8}\\.jpg$`));
      expect(stop.streetViewUrl).toMatch(/^https:\/\/inapp\.map\.naver\.com\/launchApp\/panorama\/street\?/);
      const { markers, paths } = stop.map;
      expect(markers).toHaveLength(1);
      expect(markers[0]).toMatchObject({ kind: "subwayExit", label: `Exit ${markers[0].number}` });
      expect(id).toBe(`${id.split("-")[0]}-exit${markers[0].number}`);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toMatchObject({ kind: "walk", from: markers[0].id, to: "stop" });
      expect(paths[0].points[0]).toEqual(markers[0].coords);
      expect(paths[0].points.at(-1)).toEqual(stop.coords);
    }
  });

  it("정자역 3번 출구 in English: the exit marker reads Exit 3", () => {
    expect(stopById("jeongja-exit3", "en").map.markers[0]).toEqual({
      id: "exit3",
      kind: "subwayExit",
      label: "Exit 3",
      number: 3,
      coords: { lat: 37.365922, lng: 127.107774 },
    });
  });

  it("Campus stop: the original photo in any language, a street view link, a pin-only map", () => {
    for (const lang of ["ko", "en", "zh"] as const) {
      const stop = stopById("nsc-opposite", lang);
      expect(stop.photoUrl).toMatch(/^https:\/\/media\.skkuverse\.com\/commute\/stops\/nsc-opposite\/original-[0-9a-f]{8}\.jpg$/);
      expect(stop.streetViewUrl).toBeDefined();
      expect(stop.map).toEqual({ markers: [], paths: [] });
    }
  });

  it("notes for the timetable's notes column: station or 자과캠, with 탑승/하차", () => {
    const notes = (serviceId: string, rt: string, lang: "ko" | "en" | "zh" = "ko") =>
      sequences(serviceId, lang)[rt]!.map((st) => (st as SeqStop & { note?: string }).note);
    expect(notes("commute-gangnam-yangjae", "up")).toEqual(["강남역 탑승", "양재역 탑승", "자과캠 하차"]);
    expect(notes("commute-gangnam-yangjae", "down")).toEqual(["자과캠 탑승", "양재역 하차", "강남역 하차"]);
    expect(notes("commute-gangnam-yangjae", "up", "en")).toEqual(["Board · Gangnam Stn.", "Board · Yangjae Stn.", "Get off · NSC"]);
    expect(notes("commute-gangnam-yangjae", "down", "zh")).toEqual(["自然校区上车", "良才站下车", "江南站下车"]);
    for (const [serviceId, station] of [
      ["commute-jeongja", "정자"],
      ["commute-jamsil", "잠실"],
      ["commute-dogok", "도곡"],
      ["commute-gwanggyo", "광교중앙"],
    ]) {
      expect(notes(serviceId!, "up")).toEqual([`${station}역 탑승`, "자과캠 하차"]);
      expect(notes(serviceId!, "down")).toEqual(["자과캠 탑승", `${station}역 하차`]);
    }
    // The eight-character limit is checked for every timetable file in campus-schedule-data.test.ts.
  });

  it("labels translate with the request language", () => {
    expect(sequences("commute-gangnam-yangjae", "en").up!.map((st) => st.label)).toEqual([
      "Gangnam Stn. Exit 5",
      "Yangjae Stn. Exit 2",
      "NSC",
    ]);
  });
});
