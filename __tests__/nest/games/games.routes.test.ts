/**
 * GET /games and GET /games/:id through the production pipeline (buildTestApp): the real controller and service
 * over the `games` dataset stored in the registry fake (skkuverse-app add-game-factory design D3).
 *
 * The app resolves every game id against these routes, so the guards that matter are: the index lists every entry
 * in the dataset's order, disabled ones included, since a listed id is never opened from a bundled copy; a detail
 * is one entry; an unlisted id 404s GAME_NOT_FOUND, uncached by shared caches; both are cacheable for five
 * minutes, as the mini-app registry is, with an ETag a client revalidates with; revision 1, which lists no game,
 * answers an empty index. A replica that never read the dataset answers 503 GAME_REGISTRY_UNAVAILABLE on both,
 * uncached, so a client keeps its cached copy. A push is served within the dataset TTL with no restart.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { ConfigModule } from "../../../src/config/config.module";
import { GamesModule } from "../../../src/games/games.module";
import { GamesRepository } from "../../../src/games/games.repository";
import { gameEntry, gameIndex } from "../../../src/games/games.wire";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { DATASET_CACHE_TTL_MS } from "../../../src/shared/dataset.constants";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeGamesRepository } from "../../helpers/fakes/games/games.repository.fake";
import { emptyGames, listedGames } from "../../helpers/games/games-fixture";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

// WHY: one fixed instant, so nothing these routes answer depends on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-21T03:00:00.000Z") };

function bootGamesApp(registry: FakeGamesRepository, clock: Clock = CLOCK): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: [ConfigModule, SchedulingModule, GamesModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: GamesRepository, useValue: registry },
      { provide: Clock, useValue: clock },
    ],
    role: "api",
  });
}

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await bootGamesApp(FakeGamesRepository.seededWith(listedGames()));
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /games", () => {
  it("lists every entry in the dataset's order, disabled ones too, in the standard envelope", async () => {
    // Act
    const res = await request(httpServer).get("/games");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: {}, data: listedGames() });
  });

  it("is cacheable by clients and shared caches for five minutes, with an ETag", async () => {
    // Act
    const res = await request(httpServer).get("/games");

    // Assert
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.etag).toMatch(/^W\/"/);
  });

  it("answers a revalidation with the same ETag as 304", async () => {
    // Arrange
    const first = await request(httpServer).get("/games");

    // Act
    const res = await request(httpServer).get("/games").set("If-None-Match", first.headers.etag!);

    // Assert
    expect(res.status).toBe(304);
  });

  it("serves the same body in every language", async () => {
    // Act
    const ko = await request(httpServer).get("/games");
    const en = await request(httpServer).get("/games").set("Accept-Language", "en");

    // Assert
    expect(en.body).toEqual(ko.body);
  });

  it("requires no auth (succeeds without a Bearer token)", async () => {
    // Act
    const res = await request(httpServer).get("/games");

    // Assert
    expect(res.status).toBe(200);
  });
});

describe("GET /games/:id", () => {
  it.each([
    ["an enabled game", 0],
    ["a disabled game", 1],
  ])("serves %s's entry", async (_case, position) => {
    // Arrange
    const entry = listedGames().games[position]!;

    // Act
    const res = await request(httpServer).get(`/games/${String(entry.id)}`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: {}, data: entry });
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("404s GAME_NOT_FOUND on an id the dataset does not list, uncached by shared caches", async () => {
    // Act
    const res = await request(httpServer).get("/games/wave-run");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "GAME_NOT_FOUND", message: "Unknown game id: wave-run" } });
    // An id listed by a later push must not stay a cached 404.
    expect(res.headers["cache-control"] ?? "").not.toMatch(/public/);
  });

  it("404s on a path-traversal-shaped id", async () => {
    // Act
    const res = await request(httpServer).get("/games/..%2F..%2Fpackage");

    // Assert
    expect(res.status).toBe(404);
  });
});

describe("GET /games and GET /games/:id wire", () => {
  it("serves the published index shape", async () => {
    // Act
    const res = await request(httpServer).get("/games");

    // Assert
    expectWire(gameIndex, res.body.data);
  });

  it("serves the published entry shape", async () => {
    // Act
    const res = await request(httpServer).get("/games/apple-game");

    // Assert
    expectWire(gameEntry, res.body.data);
  });
});

describe("the game routes over revision 1, which lists no game", () => {
  let emptyApp: NestExpressApplication;

  beforeAll(async () => {
    emptyApp = await bootGamesApp(FakeGamesRepository.seededWith(emptyGames()));
  });

  afterAll(async () => {
    await emptyApp.close();
  });

  it("answer an empty index and a 404 for every id", async () => {
    // Act
    const index = await request(emptyApp.getHttpServer()).get("/games");
    const detail = await request(emptyApp.getHttpServer()).get("/games/apple-game");

    // Assert
    expect(index.status).toBe(200);
    expect(index.body.data).toEqual({ games: [] });
    expect(detail.status).toBe(404);
  });
});

describe("the game routes on a replica that has never read the dataset", () => {
  let unreadApp: NestExpressApplication;

  beforeAll(async () => {
    const unreachable = new FakeGamesRepository();
    unreachable.failWith = new Error("server selection timed out");
    unreadApp = await bootGamesApp(unreachable);
  });

  afterAll(async () => {
    await unreadApp.close();
  });

  it.each(["/games", "/games/apple-game"])("answer %s with 503 GAME_REGISTRY_UNAVAILABLE, uncached", async (url) => {
    // Act
    const res = await request(unreadApp.getHttpServer()).get(url);

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: "GAME_REGISTRY_UNAVAILABLE", message: "The game registry is unavailable" } });
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

describe("a games push while the app runs", () => {
  const T0 = new Date("2026-10-21T03:00:00.000Z");
  let liveApp: NestExpressApplication;
  let registry: FakeGamesRepository;

  beforeAll(async () => {
    jest.useFakeTimers({ now: T0, doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    registry = FakeGamesRepository.seededWith(emptyGames());
    liveApp = await bootGamesApp(registry, { now: () => new Date(Date.now()) });
  });

  afterAll(async () => {
    jest.useRealTimers();
    await liveApp.close();
  });

  it("lists a pushed game and serves its entry within the dataset TTL, with no restart", async () => {
    // Arrange
    const before = await request(liveApp.getHttpServer()).get("/games");
    registry.storeGames(listedGames());

    // Act
    jest.setSystemTime(T0.getTime() + DATASET_CACHE_TTL_MS + 1);
    const after = await request(liveApp.getHttpServer()).get("/games");
    const detail = await request(liveApp.getHttpServer()).get("/games/apple-game");

    // Assert
    expect(before.body.data).toEqual({ games: [] });
    expect(after.body.data).toEqual(listedGames());
    expect(detail.status).toBe(200);
  });
});
