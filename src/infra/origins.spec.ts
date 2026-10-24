/**
 * The first-party mini app origins and the mini app that owns each one
 * (ADR 0013, D2). The owner is a trust decision held in
 * code, not in the registry dataset: the app opens any URL on the origin in
 * that mini app's shell, with the bridge. So the record is spelled out here,
 * and the origin list the bridge, the manifest pollers and the registry
 * checks read is its keys, in the same order /app/config has always served.
 *
 * The first-party game origins (skkuverse-app add-game-factory design D2) are
 * a second trust list: each is `https://<id>.game.skkuverse.com`, owned by the
 * game of that id, and in no list a mini app's page is trusted through (the
 * bridge, CORS, the mini-app owners), so no game page ever gets a mini-app
 * grant.
 */
import {
  BRIDGE_ORIGINS,
  CORS_ORIGINS,
  FIRST_PARTY_MINIAPP_ORIGINS,
  GAME_ID_BY_FIRST_PARTY_ORIGIN,
  MINIAPP_ID_BY_FIRST_PARTY_ORIGIN,
  corsOrigins,
} from "./origins";

describe("MINIAPP_ID_BY_FIRST_PARTY_ORIGIN", () => {
  it("maps each first-party origin to the mini app that owns it", () => {
    // Act & Assert
    expect(MINIAPP_ID_BY_FIRST_PARTY_ORIGIN).toEqual({
      "https://eskara.miniapp.skkuverse.com": "eskara-2026",
      "https://mukja.mini.skkuverse.com": "mukja",
      "https://playlist.mini.skkuverse.com": "playlist",
      "https://booth-box.mini.skkuverse.com": "booth-box",
      "https://inja.mini.skkuverse.com": "inja",
      "https://timetable.mini.skkuverse.com": "timetable",
    });
  });

  it("cannot be changed at runtime", () => {
    // Act & Assert
    expect(Object.isFrozen(MINIAPP_ID_BY_FIRST_PARTY_ORIGIN)).toBe(true);
  });
});

describe("FIRST_PARTY_MINIAPP_ORIGINS", () => {
  it("is the owner record's keys, in today's order", () => {
    // Act & Assert
    expect(FIRST_PARTY_MINIAPP_ORIGINS).toEqual(Object.keys(MINIAPP_ID_BY_FIRST_PARTY_ORIGIN));
    expect(FIRST_PARTY_MINIAPP_ORIGINS).toEqual([
      "https://eskara.miniapp.skkuverse.com",
      "https://mukja.mini.skkuverse.com",
      "https://playlist.mini.skkuverse.com",
      "https://booth-box.mini.skkuverse.com",
      "https://inja.mini.skkuverse.com",
      "https://timetable.mini.skkuverse.com",
    ]);
  });
});

describe("GAME_ID_BY_FIRST_PARTY_ORIGIN", () => {
  const gameOrigins = Object.keys(GAME_ID_BY_FIRST_PARTY_ORIGIN);

  it("maps each first-party game origin to the game that owns it", () => {
    // Act & Assert
    expect(GAME_ID_BY_FIRST_PARTY_ORIGIN).toEqual({
      "https://apple-game.game.skkuverse.com": "apple-game",
      "https://suika-game.game.skkuverse.com": "suika-game",
      "https://wave-run.game.skkuverse.com": "wave-run",
      "https://subway-typing.game.skkuverse.com": "subway-typing",
      "https://building-stack.game.skkuverse.com": "building-stack",
      "https://bigger-building.game.skkuverse.com": "bigger-building",
    });
  });

  it("cannot be changed at runtime", () => {
    // Act & Assert
    expect(Object.isFrozen(GAME_ID_BY_FIRST_PARTY_ORIGIN)).toBe(true);
  });

  it("names each game's origin after its id, on the game host", () => {
    // Act & Assert
    for (const [origin, id] of Object.entries(GAME_ID_BY_FIRST_PARTY_ORIGIN)) {
      expect(origin).toBe(`https://${id}.game.skkuverse.com`);
      expect(new URL(origin).origin).toBe(origin);
    }
  });

  it("grants no game origin the bridge", () => {
    // Act & Assert
    expect(BRIDGE_ORIGINS.filter((origin) => gameOrigins.includes(origin))).toEqual([]);
  });

  it("grants no game origin CORS, in production or in development", () => {
    // Act & Assert
    expect(CORS_ORIGINS.filter((origin) => gameOrigins.includes(origin))).toEqual([]);
    expect(corsOrigins(false).filter((origin) => typeof origin === "string" && gameOrigins.includes(origin))).toEqual([]);
    expect(corsOrigins(true).filter((origin) => typeof origin === "string" && gameOrigins.includes(origin))).toEqual([]);
  });

  it("shares no origin with the mini-app owners, so none is polled for a manifest", () => {
    // Act & Assert
    expect(FIRST_PARTY_MINIAPP_ORIGINS.filter((origin) => gameOrigins.includes(origin))).toEqual([]);
    expect(Object.keys(MINIAPP_ID_BY_FIRST_PARTY_ORIGIN).filter((origin) => gameOrigins.includes(origin))).toEqual([]);
  });
});
