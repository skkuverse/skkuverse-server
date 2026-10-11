---
title: Web Origins and URL Rules
type: explanation
status: accepted
owner: spencer0124
last-updated: 2026-10-26
audience: internal
---

# Web Origins and URL Rules

> Why every first-party host lives in `src/infra/origins.ts` (the web view's in `src/shared/webview-origin.constants.ts`, beside the link checks that read it), why game origins are a trust list of their own, and why the web view and media URL checks in `src/shared/webview-url.util.ts` and `src/infra/media-url.ts` are as strict as they are. Read it before adding a host, a mini app, a game or a URL field.

## Context

The API hands clients URLs on hosts it owns: the web view SPA, the first-party mini apps and games, the media bucket and the marketing site. `GET /app/config` also publishes which of those hosts may reach the app's native bridge. If a module wrote a web view URL on a host the bridge list does not cover, the app would fail closed and the page would lose its bridge with no error and no log on either side. So every host is a constant in `src/infra/origins.ts`, and both the URLs and the allowlists are derived from those constants.

## Structure

| Constant | What it is | Who may use it |
| --- | --- | --- |
| `WEBVIEW_ORIGIN` | The web view SPA (skkuverse-web `apps/webview`, on Cloudflare Pages) | Every web view URL; `BRIDGE_ORIGINS`; the CORS grant |
| `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN` | Each origin of a mini app we host, mapped to the id of the mini app that owns it: a trust decision held in code, never in the registry dataset ([ADR 0013, D2](../decisions/0013-runtime-data-in-mongodb.md)) | `miniapps.origins` on `GET /app/config` |
| `FIRST_PARTY_MINIAPP_ORIGINS` | The keys of `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN`, in its order | `BRIDGE_ORIGINS`; the manifest pollers |
| `GAME_ID_BY_FIRST_PARTY_ORIGIN` | Each origin of a game we host, `https://<id>.game.skkuverse.com`, mapped to the id of the game that owns it: a trust list of its own (skkuverse-app add-game-factory, design D2) | `games.origins` on `GET /app/config`; the `games` dataset's push checks and `GamesService`; never `BRIDGE_ORIGINS`, the CORS grant or the mini-app owners |
| `MEDIA_ORIGIN` | The `skkuverse-media` R2 bucket behind a custom domain | Image URLs in authored content only |
| `WEB_ORIGIN` | The marketing and launcher site | Share links, home-screen shortcuts, remote logos |
| `BRIDGE_ORIGINS` | `WEBVIEW_ORIGIN` plus the first-party mini apps, except the closed ESKARA 2026 site | Published as `webview.bridgeOrigins` |
| `ORIGIN_TRUST` (the CORS grant) | The browser origins that may read responses, decided by the production implementation, outside this repository's contract; `PERIMETER_MODE=local-dev` trusts loopback origins instead ([ADR 0023](../decisions/0023-perimeter-ports.md)) | `bootstrapHttpApp`, per request |

### The first-party mini apps

Each bridged entry hands every miniapp protocol method to every page its host serves, so each was checked for what it sends and whether it embeds frames (on Android a child frame would inherit the top-level grant). None embeds an iframe.

| Origin | Mini app | Sends | Calls this API |
| --- | --- | --- | --- |
| `eskara.miniapp.skkuverse.com` | `eskara-2026`, the standalone ESKARA site; the festival map's `miniapp` buttons open its pages. Not bridged since the festival closed (see below) | `link.open`, `map.openPlace`, both now dropped by the app | No |
| `mukja.mini.skkuverse.com` | `mukja`, the 음식 룰렛 | `map.openPlace`, `haptic.impact` | No |
| `playlist.mini.skkuverse.com` | `playlist`, the 플리 예습 setlist | `link.open` (with an `appUrl` to try first), `haptic.impact` | No |
| `booth-box.mini.skkuverse.com` | `booth-box`, the 선물상자 gift box, whose message rides in its share link; also opens in a plain browser, where nothing is granted | `share.open`, `haptic.impact` | No |
| `inja.mini.skkuverse.com` | `inja`, the 인자셔틀 timetable; its `/api/*` is Pages Functions on its own origin | `map.openPlace`, `haptic.impact`, `app.ready` | No |
| `timetable.mini.skkuverse.com` | `timetable`, the stage schedule; a static page | Nothing beyond what `MiniappRoot` sends | No |

First-party mini apps are hosted one per Cloudflare Pages project at `<id>.mini.skkuverse.com`. ESKARA keeps `eskara.miniapp.skkuverse.com`, the one exception to that shape, because released builds and share links already name it.

The ESKARA 2026 festival closed on 2026-10-09, so `BRIDGE_ORIGINS` leaves its origin out: no page there may call native code, while nothing addresses it any more. The origin keeps its owner in `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN`, because the `eskara-2026` entry of the `miniapps` dataset still has its `startUrl` there and the registry checks refuse a `skkuverse.com` start URL on no first-party origin. So an old link still opens in the `eskara-2026` shell and the page renders, but the app drops its `link.open` and `map.openPlace` messages. The origin leaves `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN` once `eskara-2026` leaves the dataset.

### The first-party games

A game is hosted like a mini app, one Cloudflare Pages project per game at `<id>.game.skkuverse.com`, but trusted apart. The app grants a page on a game origin only the game methods, checked per message against that game's id, and never opens it in a mini app's shell. So `GAME_ID_BY_FIRST_PARTY_ORIGIN` feeds none of the lists a mini app is trusted through: not the bridge, not CORS, not the manifest pollers. A game serves no manifest and reads no API. Which games are listed, and whether each is enabled, is the `games` dataset ([Games API](../reference/games-api.md)); which origin a game owns stays in code, and a push whose `entryUrl` is off that origin is refused.

## Rationale / trade-offs

### Bridge and CORS are separate lists

`BRIDGE_ORIGINS` answers "may this page call native code?", a trust decision about a device capability: an entry hands `Linking.openURL` and the map-select channel to every page the host serves. So an entry belongs there only for a deployment we own, and only while clients address it. The app re-checks the loaded document's origin against the list on every bridge message, because a web view navigates and an open-time grant would outlive the origin it was granted for. It is a list, not one host, because a host move needs the old and the new granted at once: a released binary carries the host its offline fallback names, and an over-the-air update reaches only binaries at the current runtime version.

The CORS grant answers "may this page read a public GET response?", a far weaker grant over data anyone with curl can read. The web view needs it because the mini-app notification feed must be readable seconds after a push. It stays narrow: `CORS_METHODS` is read-only, so a browser never gets past a preflight to `POST /internal/*`, and there are no credentials, because `Access-Control-Allow-Credentials` with a reflected origin turns a public read surface into an authenticated one. The two lists hold the same web view host today and must still not be merged.

### A web view URL that is wrong does not fail

The web view routes by path, so a fragment never reaches the origin; Cloudflare Pages answers any surviving path with the SPA shell at HTTP 200; and the app shows its error overlay only above status 400. A malformed URL therefore lands the user on the wrong page, with no retry and nothing logged anywhere. There is no signal after the fact, so `toWebviewUrl` is the signal:

- A root-relative path (`/eskara/entry`) is the preferred spelling and is joined onto `WEBVIEW_ORIGIN`, so a hand-authored value never types the host. An absolute URL is still accepted, since the admin console writes one, but it must land on this origin.
- Both spellings are normalized first and validated once, so the same checks answer for both. The raw string meets the https link rule (`isAbsoluteHttpsUrl`) before the origin is compared, because the parser folds `\` into `/`, drops control characters and leaves userinfo out of `origin`: `…webview.skkuverse.com/a\b`, `…webview.skkuverse.com\@evil.com/x` and `https://u@webview.skkuverse.com/x` would otherwise compare equal to the origin and be served as written.
- Comparing `origin` settles the scheme and the near-miss hosts a prefix match waves through: `…skkuverse.com@evil.com`, `…skkuverse.com.evil.com`, a non-default port, a trailing-dot host. It still accepts `:443` and an uppercase host, which are this origin.
- A pathname of `/` covers a bare origin and every `/#/…`. Any fragment is refused as well: `/eskara#/entry` keeps a real pathname yet opens the ESKARA index instead of the entry page, which is the worse failure because the user arrives somewhere plausible. No first-party page uses an anchor, so refusing them costs nothing.
- `ROOT_RELATIVE_PATH_RE` refuses `//evil.com`, a protocol-relative URL, and a `\`, control or format character anywhere (`/\evil.com`), because the URL parser folds `\` into `/` for special schemes and drops or encodes the rest.

It is a predicate, not a validator that throws, because its callers fail differently on purpose: the map data drops one sheet button or chip and keeps the rest (ops can only re-author it), while a push of the mini-app registry (the `miniapps` dataset) is refused, naming the `startUrl`. Fail loud where the value can be fixed, fail soft where it can only be rendered. The strict rule applies only on our own host: a third party routes however it likes, and its choice must not get our push refused.

### Media is one host

Authored content is typed by hand, so without an allowlist any pasted URL (a signed Notion link that expires in an hour, a hotlinked vendor page) would reach every device and fail there silently. `MEDIA_ORIGIN` is the one host an image may name. It never joins `BRIDGE_ORIGINS` or the CORS grant: nothing on it is a page or reads this API. Keys are content-hashed and served `immutable`, so a replaced photo is a new key and a new URL. `isMediaUrl` parses rather than prefix-matches, for the same near-miss hosts as above, and checks userinfo on its own because `origin` ignores it. The importer holds a CommonJS copy in `scripts/lib/map-places-file.js`, and a parity test in `__tests__/nest/map/map-place-detail-import.test.ts` pins both to the same verdicts.

## Related

- [how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md) — adding a first-party origin
- [reference/miniapps-api.md](../reference/miniapps-api.md) — `GET /app/config` `miniapps.origins`
- [reference/games-api.md](../reference/games-api.md) — `GET /games` and the game origins a push checks against
- [reference/map-overlays-api.md](../reference/map-overlays-api.md) — `webview` actions and image blocks
