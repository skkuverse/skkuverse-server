/**
 * The 인자셔틀 group on schedule v2, against the inja-shuttle spec: its stops
 * (the school's 관리팀 answer of 2026-10-08, and the 학부대학 notice where it
 * differs), the four stop sequences and their notes, and the rule that a
 * client reading only v1 fields sees the same group as before v2.
 */
import fs from "fs";
import path from "path";
import { getBusGroups } from "../../../src/bus/bus-config/bus-config.data";
import { haversineM } from "../../../src/bus/schedule/schedule-stops";
import type { LatLng } from "../../../src/bus/types";
import type { SupportedLang } from "../../../src/infra/types";

// Captured from getGroupById before the campus group gained its v2 fields.
const V1: Record<string, { json: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/bus-config-campus-v1.json"), "utf8"),
);

type SeqStop = { label: string; action: string; timing: string; stopId?: string; note?: string };
type Service = { serviceId: string; label: string; endpoint: string; stopSequences?: Record<string, SeqStop[]> };
type Stop = { id: string; name: string; detail?: string; coords?: LatLng; map?: unknown; photoUrl?: string };
type CampusGroup = { id: string; screen: { services: Service[]; stops?: Stop[]; [k: string]: unknown } };

const LANGS: SupportedLang[] = ["ko", "en", "zh"];

function campus(lang: SupportedLang = "ko"): CampusGroup {
  return getBusGroups(lang).find((g) => g.id === "campus") as unknown as CampusGroup;
}
const sequences = (serviceId: string, lang: SupportedLang = "ko") =>
  campus(lang).screen.services.find((s) => s.serviceId === serviceId)!.stopSequences!;
const stopById = (id: string, lang: SupportedLang = "ko") => campus(lang).screen.stops!.find((s) => s.id === id)!;
const brief = (seq: SeqStop[]) => seq.map((st) => `${st.action}:${st.stopId}:${st.timing}`);

/** The 관리팀's points, 2026-10-08. */
const SCHOOL: Record<string, LatLng> = {
  "hssc-bus-lot": { lat: 37.587367, lng: 126.993643 },
  "hssc-600th": { lat: 37.587258, lng: 126.993904 },
  "nsc-opposite": { lat: 37.292492, lng: 126.975077 },
  "nsc-n-center": { lat: 37.292298, lng: 126.975057 },
  "nsc-welfare": { lat: 37.293999, lng: 126.973183 },
};

describe("campus group config", () => {
  it("Group config in Korean: stopSequences with regular and hakbu on both services, stops, no serviceSelector", () => {
    const { screen } = campus("ko");
    expect(screen.services.map((s) => s.serviceId)).toEqual(["campus-inja", "campus-jain"]);
    for (const s of screen.services) expect(Object.keys(s.stopSequences!)).toEqual(["regular", "hakbu"]);
    expect(screen.stops!.length).toBeGreaterThan(0);
    expect(screen).not.toHaveProperty("serviceSelector");
  });

  it.each(LANGS)("A client that has not updated (%s): without stops and stopSequences the body is the v1 body", (lang) => {
    const group = JSON.parse(JSON.stringify(campus(lang))) as CampusGroup;
    delete group.screen.stops;
    for (const s of group.screen.services) delete s.stopSequences;
    expect(JSON.stringify(group)).toBe(V1[`campus:${lang}`]!.json);
  });

  it("lists exactly the stops its sequences reference, each once", () => {
    const referenced = new Set(
      campus().screen.services.flatMap((s) => Object.values(s.stopSequences!).flat().map((st) => st.stopId!)),
    );
    expect(campus().screen.stops!.map((s) => s.id).sort()).toEqual([...referenced].sort());
  });
});

describe("인자셔틀 stops and sequences (spec scenarios)", () => {
  it("Stop sequences per direction: board first (scheduled), then each drop-off in order (estimated)", () => {
    expect(brief(sequences("campus-inja").regular!)).toEqual([
      "board:hssc-bus-lot:scheduled",
      "alight:nsc-n-center:estimated",
      "alight:nsc-welfare:estimated",
    ]);
    expect(brief(sequences("campus-inja").hakbu!)).toEqual([
      "board:hssc-bus-lot:scheduled",
      "alight:nsc-n-center:estimated",
      "alight:nsc-cns:estimated",
    ]);
    expect(brief(sequences("campus-jain").regular!)).toEqual([
      "board:nsc-opposite:scheduled",
      "alight:hssc-600th:estimated",
    ]);
    expect(brief(sequences("campus-jain").hakbu!)).toEqual([
      "board:nsc-n-center:scheduled",
      "alight:hssc-bus-lot:estimated",
    ]);
  });

  it("인사캠 boarding stop: 학생회관 버스 주차장, its detail mentions 600주년기념관", () => {
    const first = sequences("campus-inja").regular![0]!;
    const stop = stopById(first.stopId!);
    expect(stop.name).toBe("학생회관 버스 주차장");
    expect(stop.detail).toContain("600주년기념관");
  });

  it("every stop at a school point lies within 25 m of it", () => {
    for (const [id, point] of Object.entries(SCHOOL)) {
      expect(`${id} ${Math.round(haversineM(stopById(id).coords!, point))} m`).toMatch(/^\S+ (\d|1\d|2[0-5]) m$/);
    }
  });

  it("자과캠 boarding stop is shared with the commute shuttle", () => {
    const commute = getBusGroups("ko").find((g) => g.id === "commute") as unknown as CampusGroup;
    const commuteBoard = commute.screen.services[0]!.stopSequences!.down![0]!.stopId;
    expect(sequences("campus-jain").regular![0]!.stopId).toBe(commuteBoard);
    expect(commuteBoard).toBe("nsc-opposite");
  });

  it("학부대학 boards across the road from the regular shuttle", () => {
    const regular = sequences("campus-jain").regular![0]!.stopId;
    const hakbu = sequences("campus-jain").hakbu![0]!.stopId;
    expect(regular).not.toBe(hakbu);
    expect([stopById(regular!).name, stopById(hakbu!).name]).toEqual(["N센터 건너편", "N센터 앞"]);
  });

  it("N센터 앞 is one stop: the 인→자 drop-offs and the 학부대학 자→인 boarding there share a stopId", () => {
    const atNCenter = [
      ...sequences("campus-inja").regular!,
      ...sequences("campus-inja").hakbu!,
      ...sequences("campus-jain").hakbu!,
    ].filter((st) => st.label === "N센터 앞");
    expect(atNCenter).toHaveLength(3);
    expect(new Set(atNCenter.map((st) => st.stopId))).toEqual(new Set(["nsc-n-center"]));
  });

  it("Stop notes name the place: 탑승 first, 하차 after, at most eight characters, in every language", () => {
    for (const serviceId of ["campus-inja", "campus-jain"]) {
      for (const [routeType, seq] of Object.entries(sequences(serviceId, "ko"))) {
        const notes = seq.map((st) => st.note ?? "");
        expect(`${serviceId}.${routeType} ${notes[0]}`).toMatch(/ 탑승$/);
        for (const note of notes.slice(1)) expect(`${serviceId}.${routeType} ${note}`).toMatch(/ 하차$/);
        for (const note of notes) expect([...note].length).toBeLessThanOrEqual(8);
      }
      for (const lang of ["en", "zh"] as const) {
        const ko = Object.values(sequences(serviceId, "ko")).flat().map((st) => st.note);
        const other = Object.values(sequences(serviceId, lang)).flat().map((st) => st.note);
        other.forEach((note, i) => {
          expect(note).toBeDefined();
          expect(note).not.toBe(ko[i]);
        });
      }
    }
    expect(sequences("campus-inja").regular!.map((st) => st.note)).toEqual(["인사캠 탑승", "N센터 앞 하차", "복지회관 하차"]);
  });

  it("Drop-off stop: 복지회관 앞 has coordinates and a map", () => {
    const stop = stopById("nsc-welfare");
    expect(stop.coords).toBeDefined();
    expect(stop.map).toEqual({ markers: [], paths: [] });
  });

  it("every 인자셔틀 stop has a pin-only map guide, and names and details in all three languages", () => {
    for (const lang of LANGS) {
      for (const stop of campus(lang).screen.stops!) {
        expect(stop.map).toEqual({ markers: [], paths: [] });
        expect(stop.detail).toBeDefined();
      }
    }
    const ko = campus("ko").screen.stops!.map((s) => s.name);
    for (const lang of ["en", "zh"] as const) {
      campus(lang).screen.stops!.forEach((s, i) => expect(s.name).not.toBe(ko[i]));
    }
  });
});
