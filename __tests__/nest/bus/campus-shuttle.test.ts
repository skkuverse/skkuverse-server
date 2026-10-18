/**
 * The 인자셔틀 group on schedule v2, against the inja-shuttle spec: its stops
 * (the school's 관리팀 answer of 2026-10-08 and the school's shuttle page, which
 * give the regular and the 학부대학 runs the same spots), one route per
 * direction for both route types, the notes, and the rule that a client
 * reading only v1 fields sees the same group as before v2.
 */
import fs from "fs";
import path from "path";
import { BusConfigService } from "../../../src/bus/config/bus-config.service";
import type { BusGroup } from "../../../src/bus/config/bus-config.wire";
import { seededBusRegistryService } from "../../helpers/bus/bus-registry";
import { BusStopsService } from "../../../src/bus/stops/bus-stops.service";
import { SubwayStationsService } from "../../../src/subway/stations/subway-stations.service";
import { haversineM } from "../../../src/shared/distance.util";
import type { LatLng } from "../../../src/shared/lat-lng.types";

import type { SupportedLang } from "../../../src/infra/types";

let busConfig: BusConfigService;
const groupsByLang = new Map<SupportedLang, BusGroup[]>();
// WHY: the stations come from the registry, seeded here as a boot seeds it; the groups are read once.
beforeAll(async () => {
  busConfig = new BusConfigService(new BusStopsService(new SubwayStationsService()), await seededBusRegistryService());
  for (const lang of ["ko", "en", "zh"] as const) groupsByLang.set(lang, await busConfig.getBusGroups(lang));
});
const getBusGroups = (lang: SupportedLang = "ko"): BusGroup[] => groupsByLang.get(lang)!;

// Captured from getGroupById before the campus group gained its v2 fields.
const V1: Record<string, { json: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/bus-config-campus-v1.json"), "utf8"),
);

type SeqStop = { label: string; action: string; timing: string; stopId?: string; note?: string };
type Service = { serviceId: string; label: string; endpoint: string; stopSequences?: Record<string, SeqStop[]>; refresh?: unknown };
type Stop = {
  id: string;
  name: string;
  detail?: string;
  coords?: LatLng;
  map?: unknown;
  photoUrl?: string;
  streetViewUrl?: string;
};
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
};

describe("campus group config", () => {
  it("Group config in Korean: stopSequences with regular and hakbu on both services, stops, no serviceSelector", () => {
    // Arrange
    const { screen } = campus("ko");

    // Act & Assert
    expect(screen.services.map((s) => s.serviceId)).toEqual(["campus-inja", "campus-jain"]);
    for (const s of screen.services) expect(Object.keys(s.stopSequences!)).toEqual(["regular", "hakbu"]);
    expect(screen.stops!.length).toBeGreaterThan(0);
    expect(screen).not.toHaveProperty("serviceSelector");
  });

  it.each(LANGS)("A client that has not updated (%s): without stops, stopSequences and refresh the body is the v1 body", (lang) => {
    // Arrange
    const group = JSON.parse(JSON.stringify(campus(lang))) as CampusGroup;
    delete group.screen.stops;
    for (const s of group.screen.services) {
      delete s.stopSequences;
      delete s.refresh;
    }

    // Act & Assert
    expect(JSON.stringify(group)).toBe(V1[`campus:${lang}`]!.json);
  });

  it("lists exactly the stops its sequences reference, each once", () => {
    // Act
    const referenced = new Set(
      campus().screen.services.flatMap((s) => Object.values(s.stopSequences!).flat().map((st) => st.stopId!)),
    );

    // Assert
    expect(campus().screen.stops!.map((s) => s.id).sort()).toEqual([...referenced].sort());
  });
});

describe("인자셔틀 stops and sequences (spec scenarios)", () => {
  it("Stop sequences per direction: board at one campus (scheduled), get off at the other (estimated)", () => {
    // Act & Assert
    expect(brief(sequences("campus-inja").regular!)).toEqual([
      "board:hssc-bus-lot:scheduled",
      "alight:nsc-n-center:estimated",
    ]);
    expect(brief(sequences("campus-jain").regular!)).toEqual([
      "board:nsc-opposite:scheduled",
      "alight:hssc-600th:estimated",
    ]);
  });

  it("학부대학 runs use the regular stops: one route per direction", () => {
    // Act & Assert
    for (const serviceId of ["campus-inja", "campus-jain"]) {
      for (const lang of LANGS) {
        const { regular, hakbu } = sequences(serviceId, lang);
        expect(hakbu).toEqual(regular);
      }
    }
  });

  it("인사캠 boarding stop: 학생회관 버스 주차장, its detail mentions 600주년기념관", () => {
    // Arrange
    const first = sequences("campus-inja").regular![0]!;

    // Act
    const stop = stopById(first.stopId!);

    // Assert
    expect(stop.name).toBe("학생회관 버스 주차장");
    expect(stop.detail).toContain("600주년기념관");
  });

  it("every stop at a school point lies within 25 m of it", () => {
    // Act & Assert
    for (const [id, point] of Object.entries(SCHOOL)) {
      expect(`${id} ${Math.round(haversineM(stopById(id).coords!, point))} m`).toMatch(/^\S+ (\d|1\d|2[0-5]) m$/);
    }
  });

  it("자과캠 boarding stop is shared with the commute shuttle", () => {
    // Arrange
    const commute = getBusGroups("ko").find((g) => g.id === "commute") as unknown as CampusGroup;

    // Act
    const commuteBoard = commute.screen.services[0]!.stopSequences!.down![0]!.stopId;

    // Assert
    expect(sequences("campus-jain").regular![0]!.stopId).toBe(commuteBoard);
    expect(commuteBoard).toBe("nsc-opposite");
  });

  it("자과캠 boarding stop is named as on the school's shuttle page: N센터 맞은편", () => {
    // Act & Assert
    expect(stopById("nsc-opposite").name).toBe("N센터 맞은편");
  });

  it("Stop notes name the place: 탑승 first, 하차 after, at most eight characters, in every language", () => {
    // Act & Assert
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
    expect(sequences("campus-inja").regular!.map((st) => st.note)).toEqual(["인사캠 탑승", "자과캠 하차"]);
    expect(sequences("campus-jain").regular!.map((st) => st.note)).toEqual(["자과캠 탑승", "인사캠 하차"]);
  });

  it.each(LANGS)("Boarding stop (%s): the capture alone as its photo, and a street view link", (lang) => {
    // Act
    const boarding = new Set(
      campus(lang).screen.services.flatMap((s) =>
        Object.values(s.stopSequences!)
          .flat()
          .filter((st) => st.action === "board")
          .map((st) => st.stopId!),
      ),
    );

    // Assert
    expect([...boarding].sort()).toEqual(["hssc-bus-lot", "nsc-opposite"]);
    for (const id of boarding) {
      const stop = stopById(id, lang);
      expect(stop.photoUrl).toMatch(new RegExp(`^https://media\\.skkuverse\\.com/[a-z]+/stops/${id}/original-[0-9a-f]{8}\\.jpg$`));
      expect(stop.streetViewUrl).toMatch(/^https:\/\/inapp\.map\.naver\.com\/launchApp\/panorama\/street\?/);
    }
  });

  it("Drop-off stop: N센터 앞 has coordinates and a map", () => {
    // Act
    const stop = stopById("nsc-n-center");

    // Assert
    expect(stop.coords).toBeDefined();
    expect(stop.map).toEqual({ markers: [], paths: [] });
  });

  it("every 인자셔틀 stop has a pin-only map guide, and names and details in all three languages", () => {
    // Act & Assert
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

describe("인자셔틀 notices", () => {
  const serviceConfig = require("../../../src/bus/bus.constants").SERVICE_CONFIG;

  it.each(["campus-inja", "campus-jain"])("%s shows one ai banner: arrivals reflect live traffic", (serviceId) => {
    // Act & Assert
    expect(serviceConfig[serviceId].notices).toEqual([
      { style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요" },
    ]);
  });
});
