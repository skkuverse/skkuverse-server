/**
 * Schedule config v2: the stop-sequence helper, the street view link, and the rule
 * that groups using no v2 field serialize exactly as before (design D5).
 *
 * The fixture was captured from `getGroupById` / `computeGroupEtag` on the code
 * as it stood before v2 (2026-10-08). If it ever has to be re-captured, the
 * change that does so is changing what installed apps receive for 인자셔틀 —
 * say so in the commit.
 */
import fs from "fs";
import path from "path";
import {
  computeGroupEtag,
  getGroupById,
  resolveStopSequences,
} from "../../../src/bus/bus-config/bus-config.data";
import { buildStreetViewUrl } from "../../../src/bus/schedule/naver-street-view";
import type { ScheduleStopCatalog } from "../../../src/bus/types";
import type { SupportedLang } from "../../../src/infra/types";

const FIXTURE: Record<string, { json: string; etag: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/bus-config-v1-groups.json"), "utf8"),
);

const VERIFIED_LINK =
  "https://inapp.map.naver.com/launchApp/panorama/street?street=on&vrpanoid=oCt8OYgXgYopNL-f4h4MAw&vrpanopan=-53&vrpanotilt=0&vrpanofov=80&appTargetPage=panorama%2Fstreet&id=oCt8OYgXgYopNL-f4h4MAw&pan=-53&tilt=0&fov=80&fallbackUrl=https%3A%2F%2Fviewer.map.naver.com%2Fpanorama%2F%3Fid%3DoCt8OYgXgYopNL-f4h4MAw%26heading%3D-53%26tilt%3D0%26fov%3D80&app=Y&appmarket=N";

describe("groups without v2 fields", () => {
  it.each(Object.keys(FIXTURE))("%s matches the pre-v2 body and ETag byte for byte", (key) => {
    const [id, lang] = key.split(":") as [string, SupportedLang];
    expect(JSON.stringify(getGroupById(id, lang))).toBe(FIXTURE[key]!.json);
    expect(computeGroupEtag(id, lang)).toBe(FIXTURE[key]!.etag);
  });
});

describe("buildStreetViewUrl", () => {
  it("returns exactly the link verified on a phone", () => {
    expect(buildStreetViewUrl({ panoId: "oCt8OYgXgYopNL-f4h4MAw", pan: -53, tilt: 0, fov: 80 })).toBe(VERIFIED_LINK);
  });

  it("carries the same panorama and view in all three places", () => {
    const url = new URL(buildStreetViewUrl({ panoId: "t3fVimfVujMkQbI7-J3YnQ", pan: -72, tilt: 12, fov: 60 }));
    const q = url.searchParams;
    const fallback = new URL(q.get("fallbackUrl")!);
    expect(fallback.origin + fallback.pathname).toBe("https://viewer.map.naver.com/panorama/");
    const f = fallback.searchParams;
    for (const [app, page, viewer] of [
      [q.get("vrpanoid"), q.get("id"), f.get("id")],
      [q.get("vrpanopan"), q.get("pan"), f.get("heading")],
      [q.get("vrpanotilt"), q.get("tilt"), f.get("tilt")],
      [q.get("vrpanofov"), q.get("fov"), f.get("fov")],
    ]) {
      expect([app, page]).toEqual([viewer, viewer]);
    }
    expect([q.get("vrpanoid"), q.get("vrpanopan"), q.get("vrpanotilt"), q.get("vrpanofov")]).toEqual([
      "t3fVimfVujMkQbI7-J3YnQ",
      "-72",
      "12",
      "60",
    ]);
  });
});

describe("resolveStopSequences", () => {
  const MEDIA = "https://media.skkuverse.com/commute/stops";
  const CAMPUS = {
    label: { ko: "자과캠", en: "NSC" },
    detail: { ko: "N센터 인근 → 학생회관 인근", en: "Near N Center → near Student Center" },
    action: "alight" as const,
    timing: "estimated" as const,
  };
  const catalog: ScheduleStopCatalog = {
    stops: [
      {
        id: "jeongja-exit3",
        name: { ko: "정자역 3번 출구", en: "Jeongja Stn. Exit 3" },
        detail: { ko: "파리바게뜨 앞" },
        coords: { lat: 37.365499, lng: 127.107906 },
        photo: {
          original: `${MEDIA}/jeongja-exit3/original-00000000.jpg`,
          localized: { ko: `${MEDIA}/jeongja-exit3/ko-11111111.jpg`, zh: `${MEDIA}/jeongja-exit3/zh-22222222.jpg` },
        },
        panorama: { panoId: "oCt8OYgXgYopNL-f4h4MAw", pan: -53, tilt: 0, fov: 80 },
        exit: { number: 3, coords: { lat: 37.365922, lng: 127.107774 } },
        walkPath: [
          { lat: 37.365922, lng: 127.107774 },
          { lat: 37.365499, lng: 127.107906 },
        ],
      },
      { id: "nsc-opposite", name: { ko: "N센터 건너편", en: "Across from N Center", zh: "N中心对面" } },
      { id: "unused", name: { ko: "쓰이지 않는 정류장" } },
    ],
    sequences: {
      "commute-jeongja": {
        up: [{ stopId: "jeongja-exit3", action: "board", timing: "scheduled" }, CAMPUS],
        down: [
          { stopId: "nsc-opposite", action: "board", timing: "scheduled" },
          { label: { ko: "정자역 2번 출구 앞" }, action: "alight", timing: "estimated" },
        ],
      },
      "commute-jamsil": {
        down: [{ stopId: "nsc-opposite", action: "board", timing: "scheduled" }, CAMPUS],
      },
    },
  };

  it("lists only referenced catalog stops, each once, in order of first reference", () => {
    const { stops } = resolveStopSequences(["commute-jeongja", "commute-jamsil", "commute-dogok"], "ko", catalog);
    expect(stops.map((s) => s.id)).toEqual(["jeongja-exit3", "nsc-opposite"]);
  });

  it("omits a service without sequences", () => {
    const { sequences } = resolveStopSequences(["commute-jeongja", "commute-dogok"], "ko", catalog);
    expect(Object.keys(sequences)).toEqual(["commute-jeongja"]);
  });

  it("names a catalog stop by its name and a plain stop by its label, with action and timing", () => {
    const { sequences } = resolveStopSequences(["commute-jeongja"], "ko", catalog);
    expect(sequences["commute-jeongja"]).toEqual({
      up: [
        { label: "정자역 3번 출구", action: "board", timing: "scheduled", stopId: "jeongja-exit3" },
        { label: "자과캠", action: "alight", timing: "estimated", detail: "N센터 인근 → 학생회관 인근" },
      ],
      down: [
        { label: "N센터 건너편", action: "board", timing: "scheduled", stopId: "nsc-opposite" },
        { label: "정자역 2번 출구 앞", action: "alight", timing: "estimated" },
      ],
    });
  });

  it("serves a short name only when the sequence stop has one, resolved like text", () => {
    const withShort: ScheduleStopCatalog = {
      ...catalog,
      sequences: {
        "commute-jeongja": {
          up: [
            { stopId: "jeongja-exit3", short: { ko: "정자", en: "Jeongja" }, action: "board", timing: "scheduled" },
            CAMPUS,
          ],
        },
      },
    };
    const up = (lang: SupportedLang) => resolveStopSequences(["commute-jeongja"], lang, withShort).sequences["commute-jeongja"]!.up!;
    expect(up("ko")[0]!.short).toBe("정자");
    expect(up("zh")[0]!.short).toBe("Jeongja");
    expect(up("ko")[1]).not.toHaveProperty("short");
  });

  it("resolves text zh → en → ko", () => {
    const { stops, sequences } = resolveStopSequences(["commute-jeongja"], "zh", catalog);
    expect(stops[0]!.name).toBe("Jeongja Stn. Exit 3");
    expect(stops[0]!.detail).toBe("파리바게뜨 앞");
    expect(stops[1]!.name).toBe("N中心对面");
    expect(sequences["commute-jeongja"]!.up!.map((st) => st.label)).toEqual(["Jeongja Stn. Exit 3", "NSC"]);
  });

  it("serves the photo variant for the language, else the original", () => {
    const photo = (lang: SupportedLang) => resolveStopSequences(["commute-jeongja"], lang, catalog).stops[0]!.photoUrl;
    expect(photo("zh")).toBe(`${MEDIA}/jeongja-exit3/zh-22222222.jpg`);
    expect(photo("ko")).toBe(`${MEDIA}/jeongja-exit3/ko-11111111.jpg`);
    expect(photo("en")).toBe(`${MEDIA}/jeongja-exit3/original-00000000.jpg`);
  });

  it("builds the street view link and passes the exit and path through", () => {
    const stop = resolveStopSequences(["commute-jeongja"], "ko", catalog).stops[0]!;
    expect(stop.streetViewUrl).toBe(VERIFIED_LINK);
    expect(stop.exit).toEqual({ number: 3, coords: { lat: 37.365922, lng: 127.107774 } });
    expect(stop.walkPath).toHaveLength(2);
  });

  it("emits no key for a field the catalog does not set", () => {
    const { stops } = resolveStopSequences(["commute-jamsil"], "ko", catalog);
    expect(stops[0]).toEqual({ id: "nsc-opposite", name: "N센터 건너편" });
  });
});
