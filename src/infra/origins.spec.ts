/**
 * The first-party mini app origins and the mini app that owns each one
 * (move-miniapp-registry design D5). The owner is a trust decision held in
 * code, not in the registry dataset: the app opens any URL on the origin in
 * that mini app's shell, with the bridge. So the record is spelled out here,
 * and the origin list the bridge, the manifest pollers and the registry
 * checks read is its keys, in the same order /app/config has always served.
 */
import { FIRST_PARTY_MINIAPP_ORIGINS, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN } from "./origins";

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
