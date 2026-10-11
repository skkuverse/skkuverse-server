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

// WHY: only an origin one mini app owns outright: the app opens any URL on it in that mini app's shell.
export const FIRST_PARTY_MINIAPP_ORIGINS = [
  ESKARA_MINIAPP_ORIGIN,
  MUKJA_MINIAPP_ORIGIN,
  PLAYLIST_MINIAPP_ORIGIN,
  BOOTH_BOX_MINIAPP_ORIGIN,
  INJA_MINIAPP_ORIGIN,
  TIMETABLE_MINIAPP_ORIGIN,
] as const;

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
