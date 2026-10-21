// SEE: docs/explanation/web-origins.md — every first-party host is named once, here, and the
// bridge and CORS lists derive from these constants.
export const WEBVIEW_ORIGIN = "https://webview.skkuverse.com";

export const ESKARA_MINIAPP_ORIGIN = "https://eskara.miniapp.skkuverse.com";

export const MUKJA_MINIAPP_ORIGIN = "https://mukja.mini.skkuverse.com";

export const PLAYLIST_MINIAPP_ORIGIN = "https://playlist.mini.skkuverse.com";

export const BOOTH_BOX_MINIAPP_ORIGIN = "https://booth-box.mini.skkuverse.com";

export const INJA_MINIAPP_ORIGIN = "https://inja.mini.skkuverse.com";

export const TIMETABLE_MINIAPP_ORIGIN = "https://timetable.mini.skkuverse.com";

export const WEB_ORIGIN = "https://skkuverse.com";

// WHY: images only: never in BRIDGE_ORIGINS or CORS_ORIGINS; nothing on it is a page or reads this API.
export const MEDIA_ORIGIN = "https://media.skkuverse.com";

// WHY: a trust decision held in code, not in the registry dataset: the app opens any URL on the
// origin in the shell of the mini app named here, with the bridge.
export const MINIAPP_ID_BY_FIRST_PARTY_ORIGIN: Readonly<Record<string, string>> = Object.freeze({
  [ESKARA_MINIAPP_ORIGIN]: "eskara-2026",
  [MUKJA_MINIAPP_ORIGIN]: "mukja",
  [PLAYLIST_MINIAPP_ORIGIN]: "playlist",
  [BOOTH_BOX_MINIAPP_ORIGIN]: "booth-box",
  [INJA_MINIAPP_ORIGIN]: "inja",
  [TIMETABLE_MINIAPP_ORIGIN]: "timetable",
});

export const FIRST_PARTY_MINIAPP_ORIGINS: readonly string[] = Object.freeze(Object.keys(MINIAPP_ID_BY_FIRST_PARTY_ORIGIN));

// WHY: a trust list of its own, kept out of BRIDGE_ORIGINS, CORS_ORIGINS and the mini-app owners: a page
// here gets only the game methods, granted per message to the game named here, never the mini-app shell.
export const GAME_ID_BY_FIRST_PARTY_ORIGIN: Readonly<Record<string, string>> = Object.freeze({
  "https://apple-game.game.skkuverse.com": "apple-game",
  "https://suika-game.game.skkuverse.com": "suika-game",
  "https://wave-run.game.skkuverse.com": "wave-run",
  "https://subway-typing.game.skkuverse.com": "subway-typing",
});

// WHY: each entry is a trust decision: it hands `Linking.openURL` and the map-select channel to every
// page its host serves.
export const BRIDGE_ORIGINS = [WEBVIEW_ORIGIN, ...FIRST_PARTY_MINIAPP_ORIGINS] as const;

// WHY: not BRIDGE_ORIGINS: a browser read of public GET responses, not native code; no credentials.
export const CORS_ORIGINS = [WEBVIEW_ORIGIN] as const;

export const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function corsOrigins(isDevelopment: boolean): Array<string | RegExp> {
  return isDevelopment ? [...CORS_ORIGINS, LOCAL_DEV_ORIGIN] : [...CORS_ORIGINS];
}

// WHY: read-only, so a browser at an allowed origin never gets past a preflight to POST /internal/*.
export const CORS_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

// QUIRK(cors): `ETag` is not CORS-safelisted, so a browser client can read it to revalidate only once
// it is exposed.
export const EXPOSED_RESPONSE_HEADERS = "ETag";
