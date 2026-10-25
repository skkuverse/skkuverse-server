/**
 * GET /app/config: the boot-time client config (version gates, the bridge
 * allowlist, the web origin, first-party mini-app and game origins) in the standard
 * envelope, cacheable for five minutes, with no auth. Runs main.ts's pipeline for
 * this route: request logging, JSON body, LangMiddleware, the general limiter
 * (AppConfigModule binds it on /app), the controller, ResponseInterceptor and
 * HttpExceptionFilter.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BRIDGE_ORIGINS, GAME_ID_BY_FIRST_PARTY_ORIGIN, WEBVIEW_ORIGIN, WEB_ORIGIN } from "../../../src/infra/origins";
import { ConfigModule } from "../../../src/config/config.module";
import { AppConfigModule } from "../../../src/app-config/app-config.module";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { appClientConfig } from "../../../src/app-config/app-config.wire";

function bootAppConfig(): Promise<NestExpressApplication> {
  return buildTestApp({ imports: [ConfigModule, AppConfigModule] });
}

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await bootAppConfig();
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /app/config", () => {
  it("returns { ios, android } in the standard envelope", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({});
    expect(res.body.data).toHaveProperty("ios");
    expect(res.body.data).toHaveProperty("android");
    expect(res.body.data.ios).toHaveProperty("minVersion");
    expect(res.body.data.ios).toHaveProperty("updateUrl");
    expect(res.body.data.android).toHaveProperty("minVersion");
    expect(res.body.data.android).toHaveProperty("updateUrl");
  });

  it("is cacheable by clients and shared caches: boot-time, language-independent", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("publishes webview.bridgeOrigins derived from infra/origins", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.status).toBe(200);
    // Derived rather than re-listed, so adding an origin does not mean editing
    // the same list in two places. This asserts the plumbing: whatever
    // infra/origins declares is what the endpoint publishes.
    expect(res.body.data.webview.bridgeOrigins).toEqual([...BRIDGE_ORIGINS]);
    // The host the API currently builds webview URLs from has to be in the
    // allowlist, or every page it serves loads with a dead bridge.
    expect(res.body.data.webview.bridgeOrigins).toContain(WEBVIEW_ORIGIN);
  });

  it("grants the bridge to exactly these hosts, spelled out", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    const origins = res.body.data.webview.bridgeOrigins as string[];
    // Deliberately literal rather than derived from BRIDGE_ORIGINS. The
    // assertion above passes whatever the constant happens to say, including a
    // list that has silently lost a host — which is the one mistake that cannot
    // be caught after deploy, because a missing origin produces no error on
    // either side, just a page whose buttons stop doing anything.
    //
    // The webview host, the 음식 룰렛 roulette, whose results open the
    // map through `map.openPlace`, the 선물상자 box, whose links go out through
    // `share.open`, 플리 예습, whose
    // song buttons open YouTube and Spotify, and 인자셔틀, whose night boarding
    // spot opens the map, and 무대 타임테이블, which sends
    // nothing of its own yet. Exact equality rather than `toContain`,
    // because the other direction matters just as much — an origin added here
    // hands `Linking.openURL` and the map-select channel to every page that host
    // serves, so it has to be written down in this test too. The standalone
    // ESKARA site is left out since the festival closed on 2026-10-09: its
    // origin still names the eskara-2026 shell below, but no longer the bridge.
    expect(origins).toEqual([
      "https://webview.skkuverse.com",
      "https://mukja.mini.skkuverse.com",
      "https://playlist.mini.skkuverse.com",
      "https://booth-box.mini.skkuverse.com",
      "https://inja.mini.skkuverse.com",
      "https://timetable.mini.skkuverse.com",
    ]);
  });

  it("maps each first-party mini-app origin to its mini app, spelled out", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    // Literal for the same reason as the bridge list: the app opens any URL on
    // these origins in the named mini app's shell, so a wrong or missing entry
    // sends that page to the generic /webview and its "open in the app" gate.
    // The webview SPA is absent on purpose — it is not a mini app.
    expect(res.body.data.miniapps.origins).toEqual({
      "https://eskara.miniapp.skkuverse.com": "eskara-2026",
      "https://mukja.mini.skkuverse.com": "mukja",
      "https://playlist.mini.skkuverse.com": "playlist",
      "https://booth-box.mini.skkuverse.com": "booth-box",
      "https://inja.mini.skkuverse.com": "inja",
      "https://timetable.mini.skkuverse.com": "timetable",
    });
  });

  it("maps each first-party game origin to its game, spelled out", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    // Literal for the same reason as the mini-app origins: the app grants a
    // page on one of these origins the game methods, for the game named here
    // only, so a wrong entry hands one game's grants to another's page.
    expect(res.body.data.games.origins).toEqual({
      "https://apple-game.game.skkuverse.com": "apple-game",
      "https://suika-game.game.skkuverse.com": "suika-game",
      "https://wave-run.game.skkuverse.com": "wave-run",
      "https://subway-typing.game.skkuverse.com": "subway-typing",
      "https://building-stack.game.skkuverse.com": "building-stack",
      "https://bigger-building.game.skkuverse.com": "bigger-building",
    });
  });

  it("grants no first-party game origin the bridge or a mini app's shell", async () => {
    // Arrange
    const gameOrigins = Object.keys(GAME_ID_BY_FIRST_PARTY_ORIGIN);

    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    // A game page is trusted only through its own list: in either of these it
    // would get every mini-app grant, or open in a mini app's shell.
    expect(gameOrigins.length).toBeGreaterThan(0);
    expect((res.body.data.webview.bridgeOrigins as string[]).filter((origin) => gameOrigins.includes(origin))).toEqual([]);
    expect(Object.keys(res.body.data.miniapps.origins as Record<string, string>).filter((origin) => gameOrigins.includes(origin))).toEqual([]);
  });

  it("lists only absolute https origins in bridgeOrigins", async () => {
    // The client compares these against `new URL(pageUrl).origin`, which is
    // always scheme+host+port with no trailing slash. A path or trailing slash
    // here would never match and would silently disable the bridge.
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    for (const origin of res.body.data.webview.bridgeOrigins as string[]) {
      expect(origin).toMatch(/^https:\/\//);
      expect(new URL(origin).origin).toBe(origin);
    }
  });

  it("publishes web.origin so the client needn't hardcode the launcher host", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.body.data.web.origin).toBe(WEB_ORIGIN);
    expect(new URL(res.body.data.web.origin).origin).toBe(WEB_ORIGIN);
  });

  it("requires no auth (succeeds without a Bearer token)", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.status).toBe(200);
  });

  it("serves the same body for every language and names none in meta, since the edge cache keeps one copy", async () => {
    // Act
    const ko = await request(httpServer).get("/app/config");
    const en = await request(httpServer)
      .get("/app/config")
      .set("Accept-Language", "en");

    // Assert
    expect(en.status).toBe(200);
    expect(en.body.meta).toEqual({});
    expect(en.body).toEqual(ko.body);
  });
});

/**
 * `minOsVersion` beside each platform's gate: the lowest OS that can install the store build meeting
 * `minVersion`, read from APP_IOS_MIN_OS_VERSION and APP_ANDROID_MIN_OS_VERSION (jest.setup.ts sets
 * values production does not use, so a hard-coded value fails here). Below it the app lets the user through.
 */
describe("GET /app/config minOsVersion", () => {
  it("serves each platform's minOsVersion from its environment value, after minVersion and updateUrl", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.ios.minOsVersion).toBe("17.0");
    expect(res.body.data.android.minOsVersion).toBe("26");
    expect(Object.keys(res.body.data.ios)).toEqual(["minVersion", "updateUrl", "minOsVersion"]);
    expect(Object.keys(res.body.data.android)).toEqual(["minVersion", "updateUrl", "minOsVersion"]);
    expectWire(appClientConfig, res.body.data);
  });
});

/**
 * The served body against its wire schema (PR 219 F2): the contract fixture was captured once, so
 * a field the service starts to serve without the wire declaring it shows only here.
 */
describe("/app/config body against its wire schema", () => {
  it("serves /app/config as appClientConfig declares", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.status).toBe(200);
    expectWire(appClientConfig, res.body.data);
  });
});

/**
 * No `features` key: the app's one kill switch, `sharedMapShell`, is retired. Installed builds read an
 * absent `features` as every switch off, and only an exact `true` turned one on.
 */
describe("GET /app/config without features", () => {
  it("serves no features key, ending the body at games", async () => {
    // Act
    const res = await request(httpServer).get("/app/config");

    // Assert
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data)).toEqual(["ios", "android", "webview", "web", "miniapps", "games"]);
    expectWire(appClientConfig, res.body.data);
  });
});
