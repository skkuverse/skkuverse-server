/**
 * Characterization of GET /miniapps, GET /miniapps/:id for every registered
 * id and GET /miniapps/no-such-app (move-miniapp-registry tasks 1.1 and 1.3,
 * design D12): the bytes, `Cache-Control`, `Vary` and `ETag` each answers,
 * through the production pipeline as an api replica, every module
 * `src/app.module.ts` imports under `src/miniapps/` booted with a fixed `Clock`.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`).
 *
 * Each first-party origin's stored manifest is the one it served in production
 * on 2026-10-19 (fixtures/manifests.capture.json), seeded into the stored
 * manifest fake parsed, as the poller stores it. With them, each detail's body
 * and weak ETag equal what production served at 2026-10-19T19:09:46Z, commit
 * f8dda24b: the six first-party shells come from their manifests, the four
 * third-party ones are the defaults.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { MiniappsManifestRepository } from "../../../src/miniapps/manifest/miniapps-manifest.repository";
import { parseShellFields } from "../../../src/miniapps/miniapps.mapper";
import { FakeMiniappsManifestRepository } from "../../helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const CAPTURED_AT: Clock = { now: () => new Date("2026-10-19T19:09:46.000Z") };

/** What production served for each id at CAPTURED_AT: the body text and its weak ETag. */
const CAPTURED_DETAILS: Record<string, { text: string; etag: string }> = {
  inja: {
    text: '{"meta":{},"data":{"version":1,"id":"inja","startUrl":"https://inja.mini.skkuverse.com/","verified":true,"relatedLinks":[],"shell":{"bar":"top","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"ce-Ouo2qlFlmVtkstQ+NRSrqEQ0Nss"',
  },
  "eskara-2026": {
    text: '{"meta":{},"data":{"version":1,"id":"eskara-2026","startUrl":"https://eskara.miniapp.skkuverse.com/eskara","verified":true,"relatedLinks":[],"shell":{"bar":"bottom","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"e3-0RBquceCMgJj5plWTZGhvWColyA"',
  },
  timetable: {
    text: '{"meta":{},"data":{"version":1,"id":"timetable","startUrl":"https://timetable.mini.skkuverse.com/","verified":true,"relatedLinks":[],"shell":{"bar":"top","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"d8-QTdkxp9IJyEjI800tBKNQPo72S0"',
  },
  mukja: {
    text: '{"meta":{},"data":{"version":1,"id":"mukja","startUrl":"https://mukja.mini.skkuverse.com/","verified":true,"relatedLinks":[],"shell":{"bar":"top","header":"opaque","statusBar":"dark","background":"#F2F4F6"}}}',
    etag: 'W/"d0-caNRb21cK8VaViLXHjUK0UUCNyk"',
  },
  playlist: {
    text: '{"meta":{},"data":{"version":1,"id":"playlist","startUrl":"https://playlist.mini.skkuverse.com/","verified":true,"relatedLinks":[],"shell":{"bar":"top","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"d6-M8i5QY344U267r4YxUqzlFqDGV8"',
  },
  "booth-box": {
    text: '{"meta":{},"data":{"version":1,"id":"booth-box","startUrl":"https://booth-box.mini.skkuverse.com/","verified":true,"relatedLinks":[],"shell":{"bar":"top","header":"overlay","statusBar":"light","background":"#073E32"}}}',
    etag: 'W/"da-xWVJkGIKd1igK8B6iAFwBdkF1Sw"',
  },
  hssc: {
    text: '{"meta":{},"data":{"version":1,"id":"hssc","startUrl":"https://student.skku.edu/student/notice2.do","verified":true,"relatedLinks":[],"shell":{"bar":"bottom","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"dc-WMRn8nyLBngvOlb7ThHhg0pud9M"',
  },
  nsc: {
    text: '{"meta":{},"data":{"version":1,"id":"nsc","startUrl":"https://student.skku.edu/student/notice3.do","verified":true,"relatedLinks":[],"shell":{"bar":"bottom","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"db-XI/Kwhk79s1sTaJvyzeCRE9LHU4"',
  },
  skkuw: {
    text: '{"meta":{},"data":{"version":1,"id":"skkuw","startUrl":"https://www.skkuw.com/","verified":true,"relatedLinks":[],"shell":{"bar":"bottom","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"c8-E4Rb53bU5meXv30kF1AurjSLMlU"',
  },
  skkuzine: {
    text: '{"meta":{},"data":{"version":1,"id":"skkuzine","startUrl":"https://webzine.skku.edu/skkuzine/index.do","verified":true,"description":"성균웹진은 우리 성균관대학교의 하나뿐인 공식 웹진입니다. 성균관대학교의 SKKU와 인터넷 잡지라는 뜻의 webzine이 합쳐져서 만든 이름입니다. 2001년부터 정식 발간된 성균웹진은 성균관대학교의 각종 소식들과 흥미롭고 유익한 내용들을 담아내고 있습니다.","relatedLinks":[{"url":"https://linktr.ee/skku_webzine"},{"label":"카카오톡 채널 바로가기","url":"https://pf.kakao.com/_skkuwebzine/friend"},{"label":"인스타그램","url":"https://www.instagram.com/skku_webzine"}],"noticeBanner":{"title":"성균웹진 6월호가 발행되었어요! 📢","subtitle":"방금 · 공지"},"shell":{"bar":"bottom","header":"opaque","statusBar":"dark","background":"#FFFFFF"}}}',
    etag: 'W/"380-Q/2Mf+5UuTMjYfpPB0Z+RscfWpA"',
  },
};

/** What today's code serves for the index, pinned on 2026-10-20. */
const INDEX = {
  text: '{"meta":{},"data":{"version":1,"miniApps":[{"id":"eskara-2026","name":"축제 가이드","order":4,"homeLogo":{"kind":"emoji","emoji":"📖"},"shellLogo":{"kind":"remote","uri":"https://media.skkuverse.com/miniapps/eskara-2026/logo-03a86934.jpg"},"hidden":true},{"id":"inja","name":"축제 인자셔틀","order":5,"homeLogo":{"kind":"emoji","emoji":"🚌"},"shellLogo":{"kind":"emoji","emoji":"🚌"},"hidden":true},{"id":"timetable","name":"무대 타임테이블","order":6,"homeLogo":{"kind":"emoji","emoji":"📅"},"shellLogo":{"kind":"emoji","emoji":"📅"},"hidden":true},{"id":"playlist","name":"플리 예습","order":7,"homeLogo":{"kind":"emoji","emoji":"🎧"},"shellLogo":{"kind":"emoji","emoji":"🎧"},"hidden":true},{"id":"mukja","name":"음식 룰렛","order":8,"homeLogo":{"kind":"emoji","emoji":"😋"},"shellLogo":{"kind":"emoji","emoji":"😋"},"hidden":true},{"id":"booth-box","name":"선물상자","order":9,"homeLogo":{"kind":"emoji","emoji":"🎁"},"shellLogo":{"kind":"emoji","emoji":"🎁"},"hidden":true},{"id":"hssc","name":"인사캠 총학생회","shortName":"인사캠 총학","order":10,"homeLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/hssc.png"},"shellLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/hssc.png"},"hidden":true},{"id":"nsc","name":"자과캠 총학생회","shortName":"자과캠 총학","order":20,"homeLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/nsc.png"},"shellLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/nsc.png"},"hidden":true},{"id":"skkuw","name":"성대신문","order":30,"homeLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/skkuw.png"},"shellLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/skkuw.png"},"hidden":true},{"id":"skkuzine","name":"성균웹진","order":40,"homeLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/skkuzine.png"},"shellLogo":{"kind":"remote","uri":"https://skkuverse.com/miniapps/skkuzine.png"},"hidden":true}]}}',
  etag: 'W/"7c7-0wqpe2B0Ak+F6GQN/8E13qBmWZA"',
};

const NOT_FOUND = {
  text: '{"error":{"code":"MINIAPP_NOT_FOUND","message":"Unknown mini-app id: no-such-app"}}',
};

async function storedCapturedManifests(): Promise<FakeMiniappsManifestRepository> {
  const capture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/manifests.capture.json"), "utf8")) as Record<string, unknown>;
  delete capture._about;
  const repository = new FakeMiniappsManifestRepository();
  for (const [origin, manifest] of Object.entries(capture)) {
    await repository.upsertManifest(origin, parseShellFields((manifest as { shell?: unknown }).shell), CAPTURED_AT.now());
  }
  return repository;
}

let app: NestExpressApplication;

beforeAll(async () => {
  const manifests = await storedCapturedManifests();
  app = await buildTestApp({
    imports: appModulesUnder("src/config/", "src/scheduling/", "src/miniapps/"),
    overrides: [
      { provide: MiniappsManifestRepository, useValue: manifests },
      { provide: Clock, useValue: CAPTURED_AT },
    ],
    role: "api",
  });
});

afterAll(async () => {
  await app?.close();
});

describe("GET /miniapps", () => {
  it("answers the index today's registry serves, cacheable by shared caches", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/miniapps");

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(INDEX.text);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(INDEX.etag);
  });
});

describe("GET /miniapps/:id at the production capture", () => {
  it("covers every id the index lists", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/miniapps");

    // Assert
    expect(res.body.data.miniApps.map((entry: { id: string }) => entry.id).sort()).toEqual(Object.keys(CAPTURED_DETAILS).sort());
  });

  it.each(Object.keys(CAPTURED_DETAILS))("answers %s with the bytes and ETag production served", async (id) => {
    // Act
    const res = await request(app.getHttpServer()).get(`/miniapps/${id}`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(CAPTURED_DETAILS[id]!.text);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(CAPTURED_DETAILS[id]!.etag);
  });
});

describe("GET /miniapps/no-such-app", () => {
  it("answers 404 MINIAPP_NOT_FOUND", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/miniapps/no-such-app");

    // Assert
    expect(res.status).toBe(404);
    expect(res.text).toBe(NOT_FOUND.text);
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers.vary).toBe("Accept-Language, Origin");
  });
});
