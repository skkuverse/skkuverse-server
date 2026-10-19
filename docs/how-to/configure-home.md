---
title: Configure the Home Screen
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-19
audience: internal
---

# Configure the Home Screen

> How to change what `GET /ui/home` serves: the banner carousel at the top of the app's home screen and the mini-app sections under it. The same carousel also runs on the campus tab's sheet ([Campus sheet banners](#campus-sheet-banners)). A home layout change is a push of the `home-layout` dataset with `npm run data`, served within a minute and with no deploy; a campus banner change is still a file edit plus a deploy.

## Overview

The layout is the `home-layout` dataset in the content database ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)), edited only with `npm run data` ([edit-runtime-data.md](edit-runtime-data.md)). A push is validated with the server's own code before anything is written, so a bad layout is refused at your terminal instead of served. The structure rules are in `src/ui/home/ui-home.schema.ts` (the carousel's in `src/ui/ui.schema.ts`), the checks against the mini-app registry in `src/ui/home/ui-home.rules.ts`, and the served shape in `src/ui/home/ui-home.wire.ts`. Every api replica serves a push within 60 seconds; the app may keep the old response for its 5-minute `Cache-Control` on top of that.

The layout has two kinds of section, drawn in the order they are listed:

- **`banner_carousel`**: pages that rotate automatically.
  - `aspectRatio` is width ÷ height and applies to every page (1–6).
  - `autoRotateSec` is the number of seconds each page stays up. Use `0` for no rotation, otherwise a whole number from 2 to 30.
  - `items` is the list of pages:
    - `{ "type": "image", ... }` is an uploaded picture. It can have an action and an optional `startAt`/`endAt` window.
    - `{ "type": "default" }` is where the app's own built-in banner goes. Leave it out to hide that banner, and move it to change its position. It may appear at most once.
- **`tile_grid`**: an optional `title` plus `tiles`, drawn four to a row. Each tile has a `kind` that says where its name and icon come from:

  | `kind` | Fields | Name and icon from | Tap |
  | --- | --- | --- | --- |
  | `miniapp` | `id` | The mini-app registry (`src/miniapps/index.json`) | Opens the mini app |
  | `game` | `id` | The app's bundled games (skkuverse-app `features/games`) | Opens the native game |
  | `link` | `id`, `title`, `icon`, `actionType`, `actionValue` | The tile itself | Runs the action |

  - A `miniapp` id must be registered. A `game` id is checked for shape only, because only the app knows which games a build ships; a build without the game drops the tile.
  - A `link` tile is for anything that is neither, such as an app screen. `icon` is `{ "kind": "emoji", "emoji": "…" }` or `{ "kind": "media", "url": "…" }`, and the action follows the banner rules below.
  - A tile id may appear only once on the screen, whatever its kind.
  - The app drops a tile whose `kind` it does not know, so a new kind never breaks a released build.

Text (`alt`, `title`) is written as `{ "ko": ..., "en"?: ..., "zh"?: ... }`, and `ko` is required. The server picks one language per request, and `Vary: Accept-Language` is already set.

**App releases that predate this endpoint never call it.** They still draw a single flat grid from the registry's `order` and `hidden`. So when you move a mini app between sections, keep `hidden` in `index.json` meaningful for those older releases.

## Prerequisites

- What [edit-runtime-data.md](edit-runtime-data.md) lists for `npm run data`: a `.env` from `npm run env:pull`, and your `git config user.email`.
- `wrangler` logged in to the Cloudflare account that owns the `skkuverse-media` R2 bucket (only needed to add an image).

## Steps

### Edit the layout

Every change below is an edit to the `data` of a working file, made the same way:

```bash
npm run data -- pull home-layout            # writes .data/dev/home-layout.json
# edit its "data"
npm run data -- push home-layout --dry-run  # the diff, nothing written
npm run data -- push home-layout --note "<why>"
```

Try it on `_dev` first, then make the same edit in production with `--prod` on each command; the production push prints the diff and asks you to confirm. A push that is refused names each path and writes nothing ([Troubleshooting](#troubleshooting)). `history home-layout` and `rollback home-layout <revision>` undo a change the same way.

### Add a banner image

1. **Prepare the image** at the slot's aspect ratio, because the app crops with `cover`. About 2160 px wide is enough; the slot is roughly 1030 px wide on a 3x phone.
2. **Upload it first.** Nothing fetches the URL at push, so a key with no object behind it becomes a blank page on every phone. The key includes a content hash, and the object is never overwritten (same rules as [event-places.md §5](../reference/event-places.md)):

   ```bash
   KEY=home/banners/<slug>-$(shasum -a 256 banner.jpg | cut -c1-8).jpg
   npx wrangler@4 r2 object put skkuverse-media/$KEY --file banner.jpg --remote \
     --content-type image/jpeg --cache-control "public, max-age=31536000, immutable"
   curl -sI https://media.skkuverse.com/$KEY   # 200, image/jpeg
   ```

3. **Add the item** to the carousel's `items` in the working file:

   ```json
   {
     "type": "image",
     "id": "<slug>",
     "imageUrl": "https://media.skkuverse.com/home/banners/<slug>-<hash>.jpg",
     "alt": { "ko": "…", "en": "…" },
     "actionType": "miniapp",
     "actionValue": "eskara-2026",
     "endAt": "2026-10-03T00:00:00+09:00"
   }
   ```

   - `actionType` is `miniapp` (a registered mini-app target), `external` (an https URL), `webview` (a page on our web view), or `route` (an in-app path). Omit both fields for a banner that does nothing when tapped.
   - `startAt` is inclusive and `endAt` is exclusive. Both need an explicit offset. Filtering happens on every request, so a banner ends on time without a deploy. The only lag is the response's 5-minute `Cache-Control`.

4. Push it ([Edit the layout](#edit-the-layout)).

### Campus sheet banners

`GET /ui/home/campus` serves a second carousel as the only section of the campus tab's sheet. It lives in [`src/ui/campus/campus-banners.json`](../../src/ui/campus/campus-banners.json) and is a single `banner_carousel` object, not a layout. The rules are the home carousel's, with two differences:

- **Images only.** `{ "type": "default" }` is refused, because the campus sheet has no built-in banner for it to stand for.
- **No empty slot.** When every image is outside its window, the section is left out of the response, and the sheet has no section at all.

Add a banner the way the steps above describe, with keys under `campus/banners/`, but in the file, then `npm test` and deploy. The slot is 6:1. The ESKARA 2026 student banners are 2400 × 400 WebP, about 110 KB each: the app also opens a banner full screen, turned sideways, where its long edge spans the phone's height (about 2400 px on a 3x phone). Errors at boot start with `campus banners:`. The response also sends a 5-minute `Cache-Control`.

The 28 ESKARA 2026 banners stay in the file with `endAt` set to the festival's end (`2026-10-03T00:00:00+09:00`), so the section is left out today. That is how to take a banner set down: an empty `items` is refused at boot, a closed window is not. To show them again for a UI test, move `endAt` on a local server only.

The app only draws this section while its festival gate is open (`isFestivalUnlocked()` in skkuverse-app). A store build shows the campus sheet empty until the festival-day flip.

### Rearrange the grids

Edit the `tile_grid` sections: reorder tiles, move a tile to another grid, add a grid, or add or remove a `title`. To add a new mini app, register it in `src/miniapps/` first and deploy (see [register-a-miniapp.md](register-a-miniapp.md)), since a push refuses an id the registry does not have.

The `home_tiles` grid starts with the map's four permanent chips (건물지도, 건물코드, 분실물, 문의하기) from `BASE_CHIPS` in [`src/map/layer-set/map-layer-set.constants.ts`](../../src/map/layer-set/map-layer-set.constants.ts), with the same ids, titles and served actions. This is a convention, not a check: no push refuses a layout where the two differ, so when you change one, change the other. App builds that drop a `link` chip still reach the four links here. The games follow in the same grid, because the app puts a 24 pt gap after every grid: a second grid reads as a new section, while tiles in one grid wrap at the normal row spacing. The Hall of Fame card stays under the first grid that holds a game.

### Add a link to an app screen

Add a `link` tile:

```json
{
  "kind": "link",
  "id": "campus-map",
  "title": { "ko": "…", "en": "Campus map" },
  "icon": { "kind": "emoji", "emoji": "🗺️" },
  "actionType": "route",
  "actionValue": "/(tabs)/campus"
}
```

A `route` to a screen that an installed build does not have lands that build on its not-found screen. Link to a new screen only once the release carrying it is out.

### Show a mini app's live feed

Add a `miniapp_feed` section where the card should sit. This is the section ESKARA 2026 ran during the festival; it was removed from the live layout on 2026-10-05:

```json
{
  "type": "miniapp_feed",
  "id": "eskara_feed",
  "miniAppId": "eskara-2026",
  "title": { "ko": "에스카라 실시간 소식", "en": "ESKARA live updates" },
  "limit": 3
}
```

The app fetches the entries itself from `GET /miniapps/:id/notifications` (cached per replica, see [miniapps-api.md](../reference/miniapps-api.md) §5.1). It always draws the card: an empty feed shows a placeholder line, and for a mini app with push, a device that would not receive it sees the card ask for notifications instead. `miniAppId` must be registered; `title` is optional; `limit` is 1–10 and defaults to 3. Builds that predate the section type drop it, so it is safe to place before every device has the release that draws it. Remove the section to take the card down; no release is needed.

## Troubleshooting

- **A push prints `REFUSED`**: each line names a path and what failed. Common causes are a misspelt key (unknown keys are refused), a mini-app id missing from the registry, an id placed in two grids, or an emoji icon that is not exactly one emoji. Nothing was written.
- **A tile or section is missing, and the log has `ui.home_layout.item_left_out`**: the stored layout names something the running code cannot serve, usually a mini app a deploy removed. The server leaves that item out (and a grid it empties), serves the rest, and logs each item once per revision with its `path`. Push a layout without it; before removing a mini app, run `npm run data -- check --prod` ([register-a-miniapp.md](register-a-miniapp.md)).
- **`/ui/home` answers 503 `HOME_LAYOUT_UNAVAILABLE`**: the replica has never read a good layout. `ui.home_layout.missing` means no `home-layout` dataset exists in that database (create it with `push --create`); `ui.home_layout.invalid` names the stored revision and each issue, which happens when a deploy's schema rejects stored data (run `check --prod` before such a deploy). A replica that had a good layout keeps serving it for 24 hours instead, logging `cache.reload_failed`. Each line repeats at most once a minute, with `suppressed` counting the ones held back, and a replica with no good layout reads again only once a minute, so a fixing push is served within 60 s.
- **A banner shows in dev but not in production**: its `startAt`/`endAt` window is evaluated on the server's clock. Remember the offset in the window.
- **Production crashes on boot with `ENOENT … campus-banners.json`**: the file is missing from `scripts/copy-build-assets.js`.

## Related

- [edit-runtime-data.md](edit-runtime-data.md): every `npm run data` command, conflicts and rollback.
- [`src/miniapps/index.json`](../../src/miniapps/index.json): the registry the grids reference.
- skkuverse-app `packages/shared/src/home/`: the client parser, which skips section, item and tile types it does not know.
