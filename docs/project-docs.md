---
title: 프로젝트 문서 (통합 인덱스 · 미이관)
type: reference
status: deprecated
owner: spencer0124
last-updated: 2026-10-27
audience: internal
---

# skkuverse-server 프로젝트 문서

> [!WARNING]
> **미이관 레거시 문서 — Express 레이아웃 drift 있음.** 이 문서의 파일 맵·코드 샘플은 2026-05-31 NestJS 이관 이전(`features/*.js`·`lib/*.js`·`index.js`)을 서술한다. 현행 코드는 `src/`. 설계 *의도*는 참고용으로 유효하나 경로는 신뢰하지 말 것. 분해 계획은 [docs/README.md](README.md) "이관 backlog" 참조. bus/building/외부 API의 유일한 문서라 아직 남아 있다.

> 운영 중인 deployment / external API / building data 가이드의 통합 인덱스. 원본은 15개 개별 문서를 2026-03-28에 한 파일로 통합한 것.
>
> **이 문서의 범위 (live)**:
> - **Part 1: Server & Deployment** — the client-IP contract, bus schedule system architecture
> - **Part 2: External APIs** — HSSC / Jongro / Station / SKKU Map API 응답 모양·쿼터
> - **Part 5: Building Data** — moved: `docs/explanation/building-architecture.md`, survey in `docs/archive/building-data-2026-03.md`
>
> **분리된 historical 섹션 (`docs/archive/`)**:
> - `docs/archive/api-v2-migration-2026-03.md` — 2026-03 envelope 통일 + v2 라우트 정리의 마이그레이션 기록
> - `docs/archive/flutter-client-guides-2026-03.md` — 2026-03 당시 Flutter 클라이언트용 통합 가이드 모음 (현재 클라이언트는 `skkuverse-app` = RN + Expo + TS)
>
> **운영 진실의 우선순위**: `CLAUDE.md` > `README.md` > `features/<feature>/README.md` > `docs/notices-api-architecture.md` > `docs/cicd-and-branch-protection.md` > 본 문서. 충돌 시 위쪽이 이긴다.

---

# Part 1: Server & Deployment

## Hosting and deploys

Production configuration, hosting and data are kept outside this repository. This repository keeps only what the app itself relies on.

**Client IP.** `trust proxy 1` in `src/main.ts` takes the rightmost `X-Forwarded-For` entry as `req.ip`, the rate limiter's key, so the reverse proxy in front of the server must send the resolved client address as the only entry.

---

# Bus Schedule System — Server Architecture

## Overview

The bus schedule system serves campus shuttle timetables through a **Server-Driven UI (SDUI)** approach. The client fetches a config describing all bus groups, then fetches weekly schedule data per service. The server resolves schedules through a 3-step engine that combines recurring patterns, date-specific overrides, and static fallback config.

Two types of buses exist in the system:

| Type | Data source | Example |
|------|-------------|---------|
| **realtime** | External API polling (10-15s) | HSSC shuttle, Jongro 02/07 |
| **schedule** | MongoDB collections | Campus INJA/JAIN, Fasttrack |

This document covers the **schedule** type only.

---

## System Diagram

```
Client
  │
  ├── GET /ui/home/buslist     → SDUI card list (derived from getBusGroups, visibility-filtered)
  ├── GET /bus/config          → all groups[] (backward compat)
  ├── GET /bus/config/:groupId → single group config (on-demand)
  │
  ├── GET /bus/schedule/data/:serviceId/smart     ← 메인 (auto-select + status)
  └── GET /bus/schedule/data/:serviceId/week      ← deprecated (raw 7-day)

Server
  │
  ├── bus-config.data.js       → getBusGroups() — SSOT for all bus groups
  │     ├── ui.buslist.js      → reads getBusGroups(), filters visibility, maps to cards
  │     └── bus-config.routes  → serves full group(s) with ETag/304
  ├── service.config.js        → per-service operational defaults + suspend config
  ├── schedule.data.js         → resolveWeek() + resolveSmartSchedule() — resolution engine
  └── schedule.routes.js       → HTTP handler + ETag caching + i18n message injection

MongoDB (bus_campus_dev / bus_campus)
  │
  ├── bus_schedules            → recurring weekly patterns
  └── bus_overrides            → date-specific overrides (holidays, events)
```

---

## File Map

| File | Role |
|------|------|
| `features/bus/bus-config.data.js` | `getBusGroups(lang)` — SSOT for all bus groups (includes stations for realtime); `getGroupById()`, `computeGroupEtag()` |
| `features/bus/bus-config.routes.js` | `GET /bus/config` — all groups; `GET /bus/config/:groupId` — single group with ETag/304 |
| `features/bus/realtime.routes.js` | `GET /bus/realtime/data/:groupId` — live bus positions + stationEtas |
| `features/bus/service.config.js` | Static config: serviceId → `{ nonOperatingDayDisplay, notices, suspend }` |
| `features/bus/schedule.data.js` | `resolveWeek()` + `resolveSmartSchedule()` — resolution engine |
| `features/bus/schedule.routes.js` | `/smart` (main) + `/week` (deprecated) — HTTP handlers |
| `features/bus/schedule-db.js` | `ensureScheduleIndexes()` — creates DB indexes at startup |
| `lib/i18n.js` | Translation keys for group labels, service tabs, badges |

---

## 1. Bus Config (`/bus/config`, `/bus/config/:groupId`)

`getBusGroups()` is the **Single Source of Truth (SSOT)** for all bus groups. Both the SDUI buslist (`/ui/home/buslist`) and the config endpoints read from this function. Adding a new group to `getBusGroups()` automatically makes it appear in the buslist and available via the config endpoint.

### What it returns

**All groups** — `GET /bus/config`:

```
GET /bus/config
Accept-Language: ko

→ 200 OK
{
  "meta": { "lang": "ko" },
  "data": {
    "groups": [
      { id: "hssc",      screenType: "realtime",  ... },
      { id: "campus",    screenType: "schedule",  ... },
      { id: "fasttrack", screenType: "schedule",  ... },
      { id: "commute",   screenType: "schedule",  ... },
      { id: "jongro02",  screenType: "realtime",  ... },
      { id: "jongro07",  screenType: "realtime",  ... },
      { id: "jongro08",  screenType: "realtime",  ... }
    ]
  }
}
```

**Single group** — `GET /bus/config/:groupId`:

```
GET /bus/config/campus
Accept-Language: ko

→ 200 OK
{
  "meta": { "lang": "ko" },
  "data": {
    "id": "campus",
    "screenType": "schedule",
    "label": "인자셔틀",
    "visibility": { "type": "always" },
    "card": { ... },
    "screen": { ... }
  }
}

GET /bus/config/unknown → 404 { meta: { error: "GROUP_NOT_FOUND" }, data: null }
```

### Group shape

```js
{
  id: "campus",                          // unique identifier
  screenType: "schedule",                // "realtime" | "schedule"
  label: "인자셔틀",                       // i18n display name
  visibility: { type: "always" },        // when to show this group
  card: {                                // bus list card appearance
    themeColor: "003626",                // hex color (no #)
    iconType: "shuttle",                 // "shuttle" | "village"
    busTypeText: "성대",                  // badge text on card
  },
  screen: { ... }                        // screen-type-specific data (see below)
}
```

### Screen types

**realtime** — the client polls for live bus positions:
```js
screen: {
  dataEndpoint: "/bus/realtime/data/hssc",  // polled at refreshInterval
  refreshInterval: 10,                      // seconds between polls
  lastStationIndex: 10,                     // last valid station index
  stations: [                               // static station list (fetched once with config)
    { index: 0, name: "농구장", stationNumber: null, isFirstStation: true, ... },
    // ...
  ],
  features: []
}
```

**schedule** — the client renders a weekly timetable:
```js
screen: {
  defaultServiceId: "campus-inja",       // which tab is selected first
  services: [                            // tabs the user can switch between
    {
      serviceId: "campus-inja",
      label: "인사캠 → 자과캠",
      endpoint: "/bus/schedule/data/campus-inja/smart"
    },
    {
      serviceId: "campus-jain",
      label: "자과캠 → 인사캠",
      endpoint: "/bus/schedule/data/campus-jain/smart"
    }
  ],
  heroCard: null,                        // optional ETA card above the schedule; null hides it.
                                         // Campus served { etaEndpoint: "/bus/campus/eta", ... }
                                         // until that endpoint was retired (Naver Directions).
  routeBadges: [                         // color-coded route type labels
    { id: "regular", label: "일반", color: "003626" },
    { id: "hakbu", label: "학부대학", color: "1565C0" }
  ],
  features: [                            // optional action buttons
    { type: "info", url: "https://..." }
  ]
}
```

#### Schedule screen v2 fields

A schedule group may add the fields below. Every one is optional, and **absent means v1 behavior**: a segmented
selector and no stop information. `getBusGroups()` emits a field only when the group uses it, so a group that
uses none serializes byte for byte as before. `__tests__/nest/bus/bus-config-boarding.test.ts` pins `fasttrack`
against a fixture captured before v2, ETags included, and `campus-shuttle.test.ts` checks that `campus` minus its v2
fields (`stops`, `stopSequences`) is its pre-v2 body. The app's parsers copy known fields only, so
builds that predate v2 ignore these keys and render the v1 screen.

```js
screen: {
  defaultServiceId: "commute-jeongja",
  serviceSelector: "chips",              // "segmented" (default when absent) | "chips"
  services: [
    {
      serviceId: "commute-jeongja",
      label: "정자",
      endpoint: "/bus/schedule/data/commute-jeongja/smart",
      stopSequences: {                   // optional: the stops every run of a route type passes, in order
        up: [
          { label: "정자역 3번 출구", note: "정자역 탑승", action: "board", timing: "scheduled", stopId: "jeongja-exit3" },
          { label: "자과캠", note: "자과캠 하차", action: "alight", timing: "estimated", detail: "N센터 인근 → CNS센터 → …" }
        ],
        down: [
          { label: "N센터 맞은편", note: "자과캠 탑승", action: "board", timing: "scheduled", stopId: "nsc-opposite" },
          { label: "정자역 2번 출구 앞", note: "정자역 하차", action: "alight", timing: "estimated" }
        ]
      }
    }
  ],
  stops: [                               // only the catalog stops some sequence references, each once
    {
      id: "jeongja-exit3",
      name: "정자역 3번 출구",
      detail: "파리바게뜨 앞",             // optional
      coords: { lat: 37.365499, lng: 127.107906 },          // optional
      photoUrl: "https://media.skkuverse.com/…",            // optional, chosen for the request language
      streetViewUrl: "https://inapp.map.naver.com/…",      // optional, built by the server
      map: {                                                // optional: a small map of the stop (no commute stop has one)
        markers: [{ id: "exit3", kind: "subwayExit", label: "3번 출구", number: 3, coords: { lat, lng } }],
        paths: [{ kind: "walk", from: "exit3", to: "stop", points: [{ lat, lng }, …] }]
      },
      subwayStation: { id: "jeongja", title: "정자역" }    // optional: the subway station the stop is at, last; `id` is
                                                          // the slug GET /subway/stations/:stationId/arrivals takes,
                                                          // `title` the transit tab's title in the request language
    }
  ],
  // …heroCard, routeBadges, features as in v1
}
```

Text (`name`, `detail`, `label`, `note`) resolves `request language → en → ko`. `note` is the timetable's notes
column at that stop ("강남역 탑승"). It lives in the config rather than in timetable entries because schedule responses
are not localized. The full `label` is for the stops section.

**One row is one bus run.** A timetable entry of such a service carries `stopTimes` (§10): the time at each stop of
the sequence for its route type, index for index. The 강남·양재 bus is one row: 등교 `["07:40", "07:45", "08:45"]`
over 강남 (board), 양재 (board), 자과캠 (alight); 하교 `["17:00", "18:15", "18:20"]` over N센터 맞은편, 양재, 강남 (the 양재 arrival is the 강남 one minus five minutes).
A sequence stop is a catalog stop (`stopId`: photo, street view, map) or a plain `label`. Boarding stops are
catalog stops because riders must find them; a drop-off is a catalog stop when we know where it is, and a label
otherwise. `timing` says whether that stop's time is the published schedule or the school's estimate, and `null`
is a time nobody gave — never derived.

**인자셔틀 (`campus`)** uses `stops` and `stopSequences` but keeps the segmented selector, so it has no
`serviceSelector`. Each service has a sequence per route type, `regular` and the Friday 학부대학 `hakbu`, and the
two are equal. The 관리팀 answer of 2026-10-08 says every department running the shuttle (관리팀, 학생지원팀,
학부대학·사범대학 행정실) uses the same spots, and the school's shuttle page names one set:

| Sequence | Stops (board → drop-off) | Notes |
| --- | --- | --- |
| `campus-inja.regular`, `.hakbu` | 학생회관 버스 주차장 → N센터 앞 | 인사캠 탑승, 자과캠 하차 |
| `campus-jain.regular`, `.hakbu` | N센터 맞은편 → 600주년기념관 앞 | 자과캠 탑승, 인사캠 하차 |

- The `hakbu` route type stays for the badge and the Friday times: the 학부대학 runs are a separate service with
  their own lost-and-found contact. Its notice words the spots differently (학생회관 앞, N센터 앞, CNS센터 앞); the
  server follows the 관리팀 answer (decided 2026-10-09).
- 인→자 drops off once, at N센터 앞. The 관리팀's second drop-off, 복지회관 앞, is left out by choice, so every
  인자셔틀 entry stores two `stopTimes`.
- `nsc-opposite` (N센터 맞은편, the school page's name) is also the stop the commute 하교 runs board at.
- Every 인자셔틀 stop has an empty guide (a pin-only card): none has a subway exit.

**`map`** tells a client to draw a small map card of the stop. It comes from the catalog stop's `guide`
(`places` and `walks`), and the stop itself is always the card's pin:

- `markers`: points around the stop, each with `id`, `kind`, `label` (in the request language) and `coords`.
  The only kind is `subwayExit`, which also carries its exit `number`.
- `paths`: lines between the stop and its markers, each `kind: "walk"` with `from`, `to` and `points` in walking
  order. One end is `"stop"` (the stop itself, a reserved id) and the other a marker id. The first point is the
  `from` position and the last the `to` position.
- Both arrays are always present. `{ markers: [], paths: [] }` is a pin-only card. A stop without a guide has no
  `map`, and a guide needs the stop's `coords`.
- **A group can serve no maps.** `HAS_STOP_MAPS_BY_GROUP` in `src/bus/config/bus-config.config.ts` says per group
  whether its stops carry `map`. The commute group serves none since 2026-10-18 (owner decision), so the app draws no map card there; the catalog keeps every guide, because the campus
  group serves `nsc-n-center` and `nsc-opposite` with theirs.
- **Direction is data.** A boarding stop's walk goes from the exit `to: "stop"`; a drop-off's goes `from: "stop"`.
  The loader checks each walk against every sequence that uses the stop, so a stop used both ways has no walk.
- Clients ignore marker and path kinds they do not know. The loader accepts only the kinds above, so nothing is
  served that a shipped client cannot draw. Reserved for later: a `place` marker (a building) and a `stop` marker
  (a related stop).

Exit names are stored per language in the catalog ("3번 출구", "Exit 3", "3号出口"), because `t()` has no
templating.

**The stop catalog** is the `bus-stops` dataset of the content database, the single source of truth for stops
and the per-service stop sequences, edited with `npm run data` ([edit-bus-stops.md](how-to/edit-bus-stops.md)).
A push is refused, and a stored revision is not served, when any of these holds:

- a sequence names an unknown stop or service; has fewer than two stops, no alighting stop, or a first stop that
  is not a boarding stop; has a stop with both or neither of `stopId` and `label`, or the same catalog stop twice;
  or uses an `action` or `timing` other than board/alight and scheduled/estimated
- a stop id repeats, or a stop has no Korean name
- a photo URL, original or variant, is not on `media.skkuverse.com`; variants exist without an original; or a
  variant is for a language other than ko, en and zh
- coordinates fall outside South Korea (lat 33–39, lng 124–132), which catches a swapped lat/lng
- a panorama id is not 22 characters of `A–Z a–z 0–9 - _`, or pan, tilt or fov is not an integer in −180..180,
  −90..90 and 25..80
- a guide is on a stop without coordinates; a place id is blank, repeated or `"stop"`; a place kind is not
  `subwayExit`, its number not an integer in 1–99, its name has no Korean text or its coordinates are outside
  South Korea
- a walk does not have exactly one `"stop"` end, ends at an unknown place, has fewer than two points, does not
  start at its `from` or end at its `to`, or is longer than 500 m
- a walk to `"stop"` is on a stop some sequence alights at, or a walk from `"stop"` on one some sequence boards at
- a stop still has the retired `exit` or `walkPath` (the error says they moved to `guide`)

Each timetable entry's `stopTimes` must have one time per sequence stop, with `null` only at an estimated stop:
`npm run data -- push bus-stops` checks the sequences against the target's stored `bus_schedules`, and
`npm run schedule` checks a timetable against the target's stored `bus-stops`. Each sequence's route type must
be a badge of the group (the badges live in code), which a jest test checks against the committed timetables.

**`photoUrl`** is the variant whose overlay labels are in the request language, or else the original capture.
It does not fall back through English like text does, because the original has no words.

**`streetViewUrl`** is built by `toStreetViewUrl()` (`src/bus/stops/bus-stops.mapper.ts`) from the stop's
`panorama` (`panoId`, `pan`, `tilt`, `fov`). It is NAVER Map's own app link for a panorama, with the web viewer as
its fallback. The format is unofficial, because the `nmap://` scheme has no panorama action. Building it on the
server means a format change is fixed by one deploy for every installed app. A link built by the client would
need an OTA and would stay broken on builds that never take it. A test pins the exact output for a panorama that
was verified on a phone.

**Photos on R2.** Upload every photo to `skkuverse-media` before the catalog references it, because the server
checks the URL text only:

- Key: `bus/stops/<stopId>/<variant>-<sha256[:8]>.jpg`, where the variant is `original`, `ko`, `en` or `zh`. The
  seven commute stops keep the `commute/stops/` prefix they were first published under.
- Each object is a 1200 px wide JPEG uploaded with `Cache-Control: public, max-age=31536000, immutable`.
- A key is never overwritten. A new photo gets a new key.
- Only the six station stops have language variants (the waiting line and the exit, labeled). The campus stops
  (N센터 맞은편 and the 인자셔틀 boarding stops) serve the capture alone, the same in every language.

**What an updated client does with v2** (the skkuverse-app change):

- Parse `serviceSelector`, `stops`, `services[].stopSequences` and each entry's `stopTimes` as optional, and render
  the v1 screen without them.
- `"chips"`: render a horizontally scrolling chip row that fits five labels on a 375 pt wide screen.
- Remember the last selected service per `groupId` in MMKV. On open, pick the route param, then the remembered
  service if it is still listed, then `defaultServiceId`, then the first service.
- Draw each entry that has `stopTimes` as one row: the first stop on the row line (time, badge, bus count, its `note`
  in the notes column, e.g. "강남역 탑승"), and each further stop as a sub-line with only its time and its `note` ("—" without one).
  Show an `estimated` time differently from a `scheduled` one (muted, with "~" or "예상"), and `null` as "–". The
  row is past once its last boarding time has passed; each sub-line greys out on its own time. Do not show
  `notes` on such a row: it is the fallback for clients without `stopTimes`.
- Show a stops section with the catalog stops the current sequences reference:
  - the stop `name` and `detail`
  - the photo, which opens full screen
  - a "거리뷰로 보기" button that opens `streetViewUrl`. The client never builds this link.
  - a map card when the stop has `coords` and `map`, for boarding and drop-off stops alike: the stop pin, a
    numbered circle per `subwayExit` marker, and each `walk` drawn with `NaverMapArrowheadPathOverlay`, trimmed at
    its `to` end so the arrowhead shows (about 6 pt before the stop pin, about 11 pt before an exit circle). The
    camera fits the stop, every marker and every path point, capped at zoom 15.5. Drop markers and paths of an
    unknown kind or with bad fields; keep a path whose end marker was dropped.
  - a map button from `coords`, using the official `nmap://place` scheme with the app's bundle id as `appname`
- Log a per-service view event each time a service is shown, including the default and the remembered one.

#### Service refresh

A schedule service whose timetable can change while the screen is open carries `refresh`; a service without
it has nothing to refresh, and the client shows no refresh button for it.

```js
services: [
  {
    serviceId: "campus-inja",
    label: "인사캠 → 자과캠",
    endpoint: "/bus/schedule/data/campus-inja/smart",
    refresh: { targets: ["traffic"], intervalSec: 60 }   // optional
  }
]
```

- `targets` names what a refetch of `endpoint` can change. `traffic` is the live arrival estimates merged into
  the entries (`eta`, `stopTimes`, §10), set exactly when the service opts in to them (`eta` in `SERVICE_CONFIG`,
  `src/bus/bus.constants.ts`). `crowding` is planned. The client treats `targets` as an open set and drops a value
  it does not know.
- `intervalSec` is how often the client refetches while the screen is shown. It is the `max-age` of a smart view
  that carries estimates (`ESTIMATES_MAX_AGE_S`, `src/bus/bus.constants.ts`), which follows the live
  estimate poller, so a faster poll only reads the device's HTTP cache.
- Builds that predate the field ignore it, as with the v2 fields.

### Visibility

Controls whether the group appears in the client's bus list:

| Type | Behavior |
|------|----------|
| `{ type: "always" }` | Always visible |
| `{ type: "dateRange", from: "YYYY-MM-DD", until: "YYYY-MM-DD" }` | Visible only within the date range (inclusive, KST) |
| `{ type: "dateRange", from, fromTime: "HH:mm", until }` | The same, but the first day opens at `fromTime` KST |

The server alone decides: `/ui/home` lists only the groups visible now (`isBusGroupVisible` in `src/ui/ui.rules.ts`). Clients get `visibility` in `/bus/config` but do not filter on it, so `fromTime` is additive. Fasttrack uses `dateRange` because it only runs during events (e.g., ESKARA).

The 자과캠 통학셔틀 (`commute`) card opens at 2026-10-12 11:55 KST, and closes after 2026-12-18. Its timetable patterns run from the first run, Monday 2026-10-19, to 2026-12-18 (§3). In the week before the first run the week has no timetable day, so the smart view moves to the next week and opens on 2026-10-19. It looks one week ahead only, so a card that opens more than a week before the first run would show `noData`.

### ETag caching

- **All groups**: `computeEtag(lang)` → MD5 of `JSON.stringify(getBusGroups(lang))`, cached per language
- **Single group**: `computeGroupEtag(id, lang)` → MD5 of `JSON.stringify(group)`, cached per `id:lang`
- Since bus-config.data.js is static (no DB reads), ETags never change unless the server restarts with code changes
- `If-None-Match` → `304 Not Modified` (both endpoints)
- `Cache-Control: public, max-age=300` (5 min)

---

## 2. Service Config (`service.config.js`)

A static JS object that maps every known `serviceId` to its operational defaults. This is the **single source of truth** for which services exist.

```js
module.exports = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [],
    suspend: null,                          // null = 운행 중
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [],
    suspend: null,
  },
  "fasttrack-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "warning", text: "ESKARA 기간 한정 운행" }
    ],
    suspend: null,
  },
};
```

### `nonOperatingDayDisplay`

When the resolution engine finds no pattern and no override for a given day:

| Value | Client behavior |
|-------|----------------|
| `"noService"` | Show the day with a "운행 없음" (no service) message |
| `"hidden"` | Completely hide the day from the schedule view |

All current services use `"hidden"` (Sat/Sun or non-event days are hidden from the schedule chip bar).

### `notices`

Each service's `notices` and `suspend` live in the `bus-service-notices` dataset, edited with `npm run data` and read within a minute with no deploy ([edit-runtime-data.md](how-to/edit-runtime-data.md#edit-a-shuttle-notice-or-suspension)); `SERVICE_CONFIG` keeps the service ids and the behavior flags. A service the dataset does not name has neither.

Array of persistent notices attached to every day that has `display: "schedule"`. Each notice has:
- `style`: `"info"` | `"warning"` | `"ai"` — determines visual styling. Apps on the v2 schedule screen draw `"ai"` with the star mark that also flags an estimated arrival time, and read any unknown style as `"info"`; older builds show `"ai"` as a plain info notice.
- `text`: notice message

The first notice is the banner. 인자셔틀 (`campus-inja`, `campus-jain`) carries one `"ai"` notice: 도착 시간은 실시간 교통 상황을 반영해요.

These get tagged with `source: "service"` in the resolved output (see resolution engine).

### `suspend`

Controls service-wide suspension (e.g., vacation periods). When set, `resolveSmartSchedule` returns immediately with `status: "suspended"` — **zero DB queries**.

| Value | Meaning |
|-------|---------|
| `null` | Normal operation |
| `{ from: "YYYY-MM-DD", until: "YYYY-MM-DD" }` | Suspended during this period (both inclusive) |

Example — summer vacation:
```js
suspend: { from: "2026-06-21", until: "2026-08-31" }
// → resumeDate auto-calculated: "2026-09-01" (until + 1 day)
```

**Validation**: A push refuses a suspension that is not two calendar dates with `from <= until`, and the server parses the dataset again where it reads it, so an invalid one is never served.

**Boundary behavior**: `moment.isBetween(from, until, 'day', '[]')` — both `from` and `until` days are inclusive. On `until` day 23:59 KST the service is still suspended; at `until + 1` day 00:00 KST it becomes active.

---

## 3. MongoDB Schema

### Database

Uses `config.mongo.dbName` from `lib/config.js`:
- Development: `bus_campus_dev`
- Production: `bus_campus`

### `bus_schedules` collection

Stores recurring weekly patterns. Each document is one pattern for one service.

```js
{
  serviceId: "campus-inja",     // which service this belongs to
  patternId: "weekday",         // human-readable pattern name
  days: [1, 2, 3, 4],           // ISO weekday numbers (1=Mon, 7=Sun)
  effectiveFrom: "2026-08-31",  // optional, inclusive YYYY-MM-DD
  effectiveUntil: "2026-12-18", // optional, inclusive YYYY-MM-DD
  entries: [
    { index: 1, time: "08:00", routeType: "regular", busCount: 3, notes: null },
    { index: 2, time: "08:30", routeType: "hakbu",   busCount: 1, notes: null },
    // ...
  ]
}
```

**Index**: `{ serviceId: 1, patternId: 1 }` unique

A service can have multiple patterns (e.g., `weekday` for Mon-Thu, `friday` for Fri). Days without any matching pattern fall through to `nonOperatingDayDisplay`.

`effectiveFrom` and `effectiveUntil` bound the dates a pattern applies to. Both are inclusive, and a missing bound is open, so a pattern with neither applies on every listed weekday. Outside its range a pattern does not match, and the day falls through like any other day without a pattern. That gives a semester timetable an end, and a new shuttle a first day, without a new response field or status. The timetable tool writes both fields from the file (§12).

### `bus_overrides` collection

Date-specific overrides that take priority over patterns. Used for holidays, special events, or temporary schedule changes.

```js
// Holiday — no service
{
  serviceId: "campus-inja",
  date: "2026-03-01",            // YYYY-MM-DD
  type: "noService",
  label: "삼일절",
  notices: [],
  entries: []
}

// Event — replace schedule
{
  serviceId: "fasttrack-inja",
  date: "2026-03-09",
  type: "replace",
  label: "ESKARA 1일차",
  notices: [
    { style: "info", text: "탑승 위치: 학생회관 앞 (인사캠)" }
  ],
  entries: [
    { index: 1, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
    // ...
  ]
}
```

**Index**: `{ serviceId: 1, date: 1 }` unique

**Override types**:

| `type` | Effect |
|--------|--------|
| `"replace"` | Use `entries` from override instead of pattern. `display: "schedule"` |
| `"noService"` | No buses run. `display: "noService"`, empty entries |

---

## 4. Resolution Engine (`resolveWeek`)

The core function in `schedule.data.js`. Given a `serviceId` and optional `from` date, it returns a 7-day resolved schedule.

### Algorithm

For each day (Monday → Sunday):

```
Step 1: Check bus_overrides for { serviceId, date }
  ├── type: "replace"
  │     → display: "schedule"
  │     → schedule = override.entries
  │     → notices = [...service notices, ...override notices]
  │     → label = override.label
  │
  ├── type: "noService"
  │     → display: "noService"
  │     → schedule = [], notices = []
  │     → label = override.label
  │
  └── not found → Step 2

Step 2: Public holiday or SKKU rest day (only when respectsKoreanHolidays)
  ├── yes → display: "noService", schedule = [], notices = [], label = holiday name
  └── no  → Step 3

Step 3: Check bus_schedules for a pattern whose days[] contains dayOfWeek
        and whose effectiveFrom..effectiveUntil covers the date
  ├── found
  │     → display: "schedule"
  │     → schedule = pattern.entries
  │     → notices = [...service notices]
  │     → label = null
  │
  └── not found → Step 4

Step 4: Use serviceConfig.nonOperatingDayDisplay
  ├── "noService" → display: "noService", empty schedule/notices
  └── "hidden"   → display: "hidden", empty schedule/notices
```

**Conflicting patterns.** Two patterns that both apply to a date are a data error, and the timetable tool refuses to write one. If one exists anyway, written by hand for example, the pattern with the latest `effectiveFrom` wins. An absent `effectiveFrom` counts as earliest, and `patternId` breaks a tie, so every replica serves the same timetable. The engine logs `bus.schedule.pattern_conflict` at error level, at most once per service per hour, naming every applying pattern and the one served.

### `from` date normalization

- Any date is normalized to that week's Monday (ISO weekday)
- If omitted, defaults to current Monday (Asia/Seoul timezone)
- Both `requestedFrom` (original client value or null) and `from` (normalized Monday) are in the response

### DB queries

Only **2 queries** per resolution, regardless of how many days have overrides:

1. `bus_overrides.find({ serviceId, date: { $gte: monday, $lte: sunday } })` — batch all 7 days
2. `bus_schedules.find({ serviceId })` — all patterns for this service

Pattern matching (which days[] array contains the day) is done in-memory.

### Notice source tagging

Notices in the response are tagged with their origin:

```js
{ style: "info", text: "...", source: "service" }   // from service.config.js
{ style: "info", text: "...", source: "override" }   // from bus_overrides document
```

Service notices appear on every `display: "schedule"` day. Override notices only appear on override days (type: "replace").

### Response shape

```js
{
  serviceId: "campus-inja",
  requestedFrom: "2026-03-12",    // original client value (null if omitted)
  from: "2026-03-09",             // normalized to Monday
  days: [
    {
      date: "2026-03-09",
      dayOfWeek: 1,               // 1=Mon, 7=Sun (ISO)
      display: "schedule",        // "schedule" | "noService" | "hidden"
      label: null,                // string from override, or null
      notices: [
        { style: "info", text: "...", source: "service" }
      ],
      schedule: [
        { index: 1, time: "08:00", routeType: "regular", busCount: 3, notes: null },
        // ...
      ]
    },
    // ... 7 days total (Mon-Sun)
  ]
}
```

---

## 5. Smart Schedule Engine (`resolveSmartSchedule`)

Wraps `resolveWeek` to provide a client-ready response with auto-selected date and status field.

### Algorithm

```
1. Check suspend config
   ├── svcCfg.suspend exists AND today ∈ [from, until] (inclusive)
   │     → return { status: "suspended", resumeDate: until+1, days: [] }
   │     → 0 DB queries
   └── suspend null or outside range → continue

2. Scan this week (resolveWeek with this Monday)
   └── From today's index to Sunday, find first display:"schedule" day

3. If not found, scan next week (resolveWeek with next Monday)
   └── From Monday to Sunday, find first display:"schedule" day

4. Result:
   ├── selectedDate found → status: "active"
   │     filter out hidden days → return visibleDays
   └── selectedDate null → status: "noData"
         logger.warn, return { days: [] }
```

### Response shapes

**`status: "active"`** — normal operation:
```json
{
  "serviceId": "campus-inja",
  "status": "active",
  "from": "2026-03-16",
  "selectedDate": "2026-03-16",
  "days": [...]
}
```

**`status: "suspended"`** — within suspend period:
```json
{
  "serviceId": "campus-inja",
  "status": "suspended",
  "resumeDate": "2026-09-01",
  "from": null,
  "selectedDate": null,
  "days": []
}
```

**`status: "noData"`** — no schedule found within 2 weeks (data gap):
```json
{
  "serviceId": "campus-inja",
  "status": "noData",
  "from": null,
  "selectedDate": null,
  "days": []
}
```

### Status semantics

| Status | When | DB queries | Logger | Client behavior |
|--------|------|-----------|--------|-----------------|
| `active` | Schedule found | 2-4 (1-2 weeks) | — | Render timetable |
| `suspended` | Today ∈ suspend range | 0 | — | Show empty state + message + resumeDate |
| `noData` | No suspend, no schedule in 2 weeks | 4 | `logger.warn` | Show empty state + message |

### Message injection (route layer)

`resolveSmartSchedule` returns raw status without message. The route handler adds i18n messages:

```js
const data = result.status === "active"
  ? { ...result }
  : { ...result, message: t(`schedule.${result.status}`, req.lang) };
```

| Key | ko | en | zh |
|-----|----|----|-----|
| `schedule.suspended` | 운휴 기간입니다 | Service is suspended | 停运期间 |
| `schedule.noData` | 시간표 정보를 준비 중입니다 | Schedule information is being prepared | 正在准备时刻表信息 |

`active` responses do **not** include a `message` field.

---

## 6. Schedule Routes (`/bus/schedule/data/:serviceId/...`)

### `GET /data/:serviceId/smart` — Main endpoint

Returns the most relevant week with auto-selected date and status field. Hidden days are filtered out.

```
GET /bus/schedule/data/campus-inja/smart
Accept-Language: ko|en|zh
```

**Active response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "serviceId": "campus-inja",
    "status": "active",
    "from": "2026-03-16",
    "selectedDate": "2026-03-16",
    "days": [
      {
        "date": "2026-03-16", "dayOfWeek": 1, "display": "schedule",
        "label": null,
        "notices": [{ "style": "info", "text": "...", "source": "service" }],
        "schedule": [{ "index": 1, "time": "08:00", "routeType": "regular", "busCount": 1, "notes": null }]
      }
    ]
  }
}
```

**Suspended response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "serviceId": "campus-inja",
    "status": "suspended",
    "resumeDate": "2026-09-01",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "운휴 기간입니다"
  }
}
```

**NoData response:**
```json
{
  "meta": { "lang": "en" },
  "data": {
    "serviceId": "campus-inja",
    "status": "noData",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "Schedule information is being prepared"
  }
}
```

### ETag (smart)

Format varies by status:

| Status | ETag format |
|--------|-------------|
| `active` | `"smart-{serviceId}-{from}-{md5}"` |
| `suspended` | `"smart-{serviceId}-suspended-{md5}"` |
| `noData` | `"smart-{serviceId}-noData-{md5}"` |

Implementation: `data.from || data.status` — uses `from` when present, falls back to `status` when `from` is null.

- `If-None-Match` → `304 Not Modified`
- `Cache-Control: public, max-age=300` (5 min), or `max-age=60` for a service opted in to arrival estimates
  (`eta` in `service-config.ts`: the 인자셔틀). The hash is taken after estimates are applied, so the ETag changes
  whenever a served estimate does.

### Arrival estimates (smart only)

For a service and route type opted in with `eta: { routeTypes }`, `getSmart` applies the stored estimates in
`bus_campus.shuttle_eta` (`src/bus/eta/`) to a copy of the resolved schedule. The cached schedule itself is never
changed: `resolveWeek` keeps entry arrays by reference.

- Only the `estimated` slots of an entry's `stopTimes` are filled: the departure plus that stop's travel time,
  rounded to the minute. Scheduled slots are unchanged.
- The entry gains `eta: { source, updatedAt }`. `source` is `frozen` (fixed at departure), `live` (real-time, at
  most 15 minutes old) or `predicted` (a forecast, never older than 24 h), in that order of precedence;
  `updatedAt` is when the value was fetched. An entry without an estimate has no `eta`. The field names no provider.
- A stored estimate whose number of stops no longer fits the sequence is ignored.
- Reads go through `ShuttleEtaService` (`createCachedLoader`: 30 s TTL, 10-minute stale window, `maxTimeMS`). If
  they fail, the response is the stored timetable, with `bus.eta.read_failed` logged at most once an hour per
  service.
- `/week` is deprecated and gets no estimates.

**Where the estimates come from.** Two pollers in the poller process write `shuttle_eta`
(`src/bus/eta/live/bus-eta-live.poller.ts`, `src/bus/eta/baseline/bus-eta-baseline.poller.ts`). They are registered only with `SHUTTLE_ETA=on`, which is the default
in production and off in development. Both enumerate runs through `ScheduleService`, so a run that an override, a
holiday or a suspension removes from the timetable gets no call.

| Poller | Every | Source | Writes |
| --- | --- | --- | --- |
| `shuttle-eta-live` | 60 s | NAVER Directions 5, real-time traffic | For each run from 60 minutes before departure: a `live` value, refreshed every 10 minutes and shared by every run in that window. At departure, a fresh call fixes it (`frozen`). If that fails for 10 minutes, the last live value is fixed instead, as long as it was fetched within 15 minutes before departure. A fixed value never changes and is kept 8 days. |
| `shuttle-eta-baseline` | 5 min | TMAP 타임머신, a forecast for the run's own departure time | A `baseline` (`predicted`) value for every run the smart view shows from now, refreshed once a day after 04:00 KST, 250 ms between calls, 30 minutes of backoff per failed run. It expires 24 h after its fetch: TMAP's terms forbid using its data longer, and a TTL index on `expiresAt` enforces that. |

- **One call per sequence.** Each call sends the whole stop sequence (start, waypoints, goal). The travel time to each
  stop is read from the route's running sums: NAVER `guide` entries of type 87/88, TMAP `B`n/`E` points. A route is
  rejected, never stored, when its stop count is wrong, its sums miss the route total by more than 30 s, a stop lies
  more than 150 m from where the route places it, or the times go backwards.
- **It is a car's travel time.** The bus stops, and it may wait longer at signals than a car would, so an estimate
  is a lower bound rather than a promise. That is why the app shows the time as estimated.
- **External APIs:** NAVER Directions 5 (`NAVER_API_KEY_ID`, `NAVER_API_KEY`) and TMAP (`TMAP_APP_KEY`) each have
  a daily cap, enforced by counters in the poller process that reset at 00:00 KST. A crossed cap rejects the tick.
- Failures are reported by the poller registry (`poller.failing` and so on); see `docs/reference/logging.md`.

### `GET /data/:serviceId/week` — Deprecated

Raw 7-day resolved schedule. Logs `req.log.warn("deprecated: /week endpoint called, use /smart")` on every call.

```
GET /bus/schedule/data/campus-inja/week?from=2026-03-09
```

Still returns the same response shape as before (no `status` field). Maintained for backward compatibility during app update transition.

### Validation (both endpoints)

| Condition | Response |
|-----------|----------|
| `from` provided but not `YYYY-MM-DD` (week only) | `400 { meta: { error: "INVALID_DATE_FORMAT" } }` |
| `serviceId` not in service.config.js | `404 { meta: { error: "SERVICE_NOT_FOUND" } }` |

### Error format

Schedule endpoints use a different error format from the global `res.error()`:

```js
// Schedule errors
{ meta: { error: "CODE", message: "..." }, data: null }

// Global errors (everywhere else)
{ error: { code: "CODE", message: "..." } }
```

---

## 7. Caching

### Schedule data cache (in-memory)

| Property | Value |
|----------|-------|
| Location | `schedule.data.js` — `Map` instance |
| Key | `{serviceId}:{from}` (e.g., `campus-inja:2026-03-09`) |
| TTL | 1 hour |
| Invalidation | `clearCache()` — clear all, `clearCacheForService(serviceId)` — clear one service |

The cache stores the resolved week data. On cache hit, only `requestedFrom` is replaced (since it varies per call but the schedule data is the same).

**When to invalidate**: After inserting/updating documents in `bus_schedules` or `bus_overrides`. No automatic invalidation, and **no endpoint reaches `clearCache()`** — nothing routes to it. The only lever is restarting the processes: every api replica, one at a time, and the poller, whose arrival-estimate pollers resolve schedules through the same cache and would otherwise estimate runs that no longer exist.

### Bus config ETag cache (in-memory)

| Property | Value |
|----------|-------|
| Location | `bus-config.data.js` — `Map` instance |
| Key | language code (`"ko"`, `"en"`, `"zh"`) |
| TTL | Forever (until server restart) |

Since bus config is static code (no DB reads), the ETag only changes on deployment. The client uses `If-None-Match` to avoid re-downloading unchanged config.

### HTTP-level caching

Both schedule/config endpoints set `Cache-Control: public, max-age=300`, allowing CDN/browser caching for 5 minutes. Combined with ETag, clients get fast 304 responses after the cache expires.

### Realtime data caching

| Property | Value |
|----------|-------|
| Location | `realtime.routes.js` — no server cache |
| HTTP | `Cache-Control: no-store` |
| Client | Polls at `refreshInterval` from config (10s for HSSC, 25s for Jongro) |

Realtime data is always fresh — the server reads from in-memory fetcher state (or busCache fallback) on every request.

---

## 8. How to Add a New Schedule-Type Bus

Step-by-step guide to adding a new bus service (e.g., a new shuttle route "nsc-express").

### Step 1: Add service config

**File**: `features/bus/service.config.js`

```js
module.exports = {
  // ... existing services ...
  "nsc-express": {
    nonOperatingDayDisplay: "noService",  // or "hidden" for event-only
    notices: [],                          // persistent notices, or leave empty
    suspend: null,                        // null = operating, or { from, until }
  },
};
```

This is the **minimum requirement** for the resolution engine to recognize the service.

### Step 2: Add schedule data to MongoDB

> **The two campus shuttle services are not maintained this way.** `campus-inja` and `campus-jain` are owned by
> the committed file `scripts/data/campus-schedule.json`, applied with `npm run schedule` — never by a hand-typed
> `insertOne`. Editing them in `mongosh` puts the database out of step with the repo silently, which is how the
> 2026-1 timetable survived into the 2026-2 semester. See §12.
>
> The example below is for adding a *new* service that has no committed file yet.

Insert patterns into `bus_schedules`:

```js
// Runs every weekday
db.bus_schedules.insertOne({
  serviceId: "nsc-express",
  patternId: "weekday",
  days: [1, 2, 3, 4, 5],
  entries: [
    { index: 1, time: "09:00", routeType: "express", busCount: 1, notes: null },
    { index: 2, time: "12:00", routeType: "express", busCount: 1, notes: null },
    { index: 3, time: "18:00", routeType: "express", busCount: 1, notes: null },
  ]
});
```

Optionally add overrides for specific dates:

```js
// Holiday override
db.bus_overrides.insertOne({
  serviceId: "nsc-express",
  date: "2026-05-05",
  type: "noService",
  label: "어린이날",
  notices: [],
  entries: []
});
```

At this point, `GET /bus/schedule/data/nsc-express/smart` already works. The service config + DB data is all the resolution engine needs.

### Step 3: Add i18n keys

**File**: `lib/i18n.js`

```js
"busconfig.label.nsc-express": {
  ko: "자과캠 급행",
  en: "NSC Express",
  zh: "自然校区快速",
},
"busconfig.service.nsc-express": {
  ko: "자과캠 급행",
  en: "NSC Express",
  zh: "自然校区快速",
},
"busconfig.badge.express": {
  ko: "급행",
  en: "Express",
  zh: "快速",
},
```

### Step 4: Add group to bus config (SSOT)

**File**: `features/bus/bus-config.data.js`

Add a new entry to the array inside `getBusGroups()`. This is the **only place** you need to add it — the SDUI buslist (`/ui/home/buslist`) automatically derives its cards from this array, and the per-group config endpoint (`/bus/config/:groupId`) serves the full group data.

```js
{
  id: "nsc-express",
  screenType: "schedule",
  label: t("busconfig.label.nsc-express", lang),
  visibility: { type: "always" },  // or dateRange for event-only
  card: {
    themeColor: "1565C0",
    iconType: "shuttle",
    busTypeText: t("busconfig.badge.express", lang),
  },
  screen: {
    defaultServiceId: "nsc-express",
    services: [
      {
        serviceId: "nsc-express",
        label: t("busconfig.service.nsc-express", lang),
        endpoint: "/bus/schedule/data/nsc-express/smart",
      },
    ],
    heroCard: null,
    routeBadges: [
      { id: "express", label: t("busconfig.badge.express", lang), color: "1565C0" },
    ],
    features: [],
  },
},
```

**Position matters** — the array order is the display order in the client's bus list.

**No separate buslist entry needed** — `ui.buslist.js` reads from `getBusGroups()` and applies visibility filtering automatically.

### Step 5: Add tests

- `__tests__/bus-config.test.js` — update group count assertion, add shape checks for the new group
- `__tests__/service-config.test.js` — add the new serviceId to the known services list

### Summary checklist

| Step | File | Required? |
|------|------|-----------|
| 1. Service config | `service.config.js` | Yes — engine won't recognize the service without it |
| 2. MongoDB data | `bus_schedules` + `bus_overrides` | Yes — without patterns, all days fall to `nonOperatingDayDisplay` |
| 3. i18n keys | `lib/i18n.js` | Yes — labels appear as raw keys without translations |
| 4. Bus config group | `bus-config.data.js` | Yes — client won't show the bus without a group entry |
| 5. Tests | `__tests__/*.test.js` | Recommended |

No route changes needed — `schedule.routes.js` handles any serviceId dynamically.

---

## 9. How to Add Overrides (Holidays, Events)

### Holiday (no service)

Most holidays need no data at all. Services with `respectsKoreanHolidays`
(both 인자셔틀 directions) close on:

- Korean public holidays, computed by `date-holidays` (incl. 대체공휴일).
- SKKU rest days in the `skku-rest-days` dataset, edited with `npm run data`
  ([edit-runtime-data.md](how-to/edit-runtime-data.md#add-a-skku-rest-day)).
  `MM-DD` keys recur every year (`09-25` 건학기념일, `09-28` 공자탄신일);
  `YYYY-MM-DD` keys apply once and win over an `MM-DD` on the same day. A key
  off the calendar is refused at push. Changes reach every replica and the
  pollers within a minute, with no deploy.

Use a `bus_overrides` document instead for a one-off closure that must carry a
notice (the smart view then opens on that day instead of skipping it), or that
must land without a deploy. Insert a `noService` override for each affected
service:

```js
db.bus_overrides.insertMany([
  {
    serviceId: "campus-inja",
    date: "2026-06-06",
    type: "noService",
    label: "현충일",
    notices: [],
    entries: []
  },
  {
    serviceId: "campus-jain",
    date: "2026-06-06",
    type: "noService",
    label: "현충일",
    notices: [],
    entries: []
  }
]);
```

### Temporary event (replace schedule)

Insert a `replace` override with custom entries and notices:

```js
db.bus_overrides.insertOne({
  serviceId: "fasttrack-inja",
  date: "2026-09-11",
  type: "replace",
  label: "ESKARA 1일차",
  notices: [
    { style: "info", text: "탑승 위치: 학생회관 앞 (인사캠)" }
  ],
  entries: [
    { index: 1, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
  ]
});
```

### After inserting overrides

If the server is running, the in-memory cache may still serve stale data (up to 1 hour). Options:

1. **Wait** — cache expires after 1 hour TTL
2. **Restart the API replicas** — one at a time, health-checking each. This is the only
   lever that works on demand. There is no management endpoint: `clearCacheForService()` exists on the service
   but nothing routes to it.

---

## 10. Entry Shape Reference

Every schedule entry (in both `bus_schedules` and `bus_overrides`) has:

```js
{
  index: 1,                    // display order (1-based)
  time: "08:00",               // departure time (HH:mm, 24h, KST)
  routeType: "regular",        // matches a routeBadge.id in bus-config
  busCount: 3,                 // number of buses at this time
  notes: null,                 // optional text (e.g., "비천당 앞 출발")
  stopTimes: ["08:00", "09:10"], // optional: the time at each stop of the service's stop sequence (§1)
  eta: { source: "live", updatedAt: "2026-10-12T00:20:00.000Z" } // smart only, when an estimate filled stopTimes (§6)
}
```

`stopTimes` lists `HH:mm` or `null` (unknown), at least two, the first equal to `time`, known times never going
back. Entries without it are one line at `time`, as before. Every commute and 인자셔틀 entry has it; the 인자셔틀
ones have `null` at each drop-off, because the school publishes no travel time.

`routeType` values are defined per group's `routeBadges` array in bus-config:
- campus: `"regular"`, `"hakbu"`
- fasttrack: `"fasttrack"`
- Custom services can define their own

A `routeType` with no matching badge is not an error anywhere — `BusScheduleDoc.entries` is `unknown[]` and no
server code branches on it, so the entry is served and the client renders a blank chip. For the campus services
`__tests__/nest/bus/campus-schedule-data.test.ts` pins this by importing `routeBadges` rather than hardcoding it.

Two entries may share a `time` with different `routeType` — that is how "regular 1대 + 학부대학 2대 at 08:00" is
expressed. For `campus-inja`/`campus-jain`, `index` is **derived from array position** by
`scripts/set-campus-schedule.js` and must never be hand-written: a hand-maintained 1..N grows a duplicate the
first time somebody inserts a departure in the middle.

---

## 11. Testing

### Running tests

```bash
npm test                                        # all tests with coverage
npx jest __tests__/schedule-data.test.js         # resolution engine only
npx jest __tests__/schedule-routes.test.js       # route handler only
npx jest __tests__/bus-config.test.js            # bus config only
npx jest __tests__/service-config.test.js        # service config only
```

### Test architecture

Tests mock MongoDB via `jest.mock("../../lib/db")` and inject fake data. No real DB connection needed.

Key test files:
- `__tests__/schedule-data.test.js` — 25 tests: resolveWeek (14) + resolveSmartSchedule (10, incl. suspend/noData/boundary) + cache (1)
- `__tests__/schedule-routes.test.js` — 19 tests: /week (8) + /smart (11, incl. status/message/ETag/i18n)
- `__tests__/bus-config.test.js` — 19 tests for group structure, i18n, ETag, per-group lookup
- `__tests__/bus-config-routes.test.js` — 6 tests for per-group HTTP endpoint (200/404/304, ETag)
- `__tests__/service-config.test.js` — 11 tests for config shape validation (incl. suspend field)

### What's mocked in test files that load `index.js`

Any test that `require("../index")` (e.g., `route-responses.test.js`, `app-config.test.js`) must mock:

```js
jest.mock("../features/bus/schedule.data", () => ({
  resolveWeek: jest.fn().mockResolvedValue(null),
  resolveSmartSchedule: jest.fn().mockResolvedValue(null),
  clearCache: jest.fn(),
  clearCacheForService: jest.fn(),
}));
jest.mock("../features/bus/schedule-db", () => ({
  ensureScheduleIndexes: jest.fn().mockResolvedValue(),
}));
jest.mock("../features/bus/campus-eta.data", () => ({
  getEtaData: jest.fn().mockResolvedValue({ inja: null, jain: null }),
  clearCache: jest.fn(),
}));
```

---

## 12. Scripts

### `scripts/archive/`

완료된 1회성 마이그레이션 보존 위치. 운영 코드는 새 스키마를 가정하므로 재실행은 보통 불필요(모두 idempotent하게 작성되어 있어 다시 돌려도 no-op). 어떤 변경이 적용됐는지 추적할 때 참고용으로 남겨둔다. 재실행이 필요해진 경우 git history(특히 첨부된 fix 커밋들)도 같이 확인할 것.

- `migrate-building-two-layer.js` — 빌딩 데이터 raw/enriched 2-layer 분리 (feat `d38e960`)
- `migrate-inja-schedule.js` — INJA/JAIN 스케줄에 `routeType` 추가 (feat `0f7f1c8`)
- `migrate-schedules.js` — 구 per-collection 포맷 → 통합 `bus_schedules` 이전 (feat `944f05b`).
  이 마이그레이션은 복사만 하고 원본을 지우지 않아 `INJA_*`/`JAIN_*` 컬렉션이 5개월간 남아 있었다 —
  2026-08-31에 `scripts/drop-legacy-schedule-collections.js`로 정리됨
- `migrate-source-dept-id.js` — `sourceDeptId` → `sourceId` 필드 rename (refactor `fde31e6`, 후속 fix `c6164b7`)

### `scripts/set-campus-schedule.js`

Applies a committed shuttle timetable to `bus_schedules`. Each timetable is a file:
`scripts/data/campus-schedule.json` (인자셔틀, the default) and `scripts/data/commute-schedule.json`
(자과캠 통학셔틀, passed with `--file`). A committed file means a semester change is a reviewable `git diff`, and a
wrong timetable can be reverted rather than re-typed. `scripts/lib/campus-schedule-file.js` holds the pure
parse/build/diff/overlap logic (no dotenv, no Mongo), which is what `__tests__/nest/bus/campus-schedule-data.test.ts`
requires.

File fields:

- `semester`: a label printed by the tool.
- `effectiveFrom` (required) and `effectiveUntil` (optional), inclusive `YYYY-MM-DD`. Both are written into every
  pattern document (§3), and an `effectiveUntil` earlier than `effectiveFrom` is rejected.
- `routeTypes`: the ordered route types the file may use. An entry with any other route type is rejected, and the
  order is the sort order for entries at the same minute. Each route type also needs a badge in the group that
  lists the service; a jest test checks that for every committed file.
- `patterns[]`: `patternId`, ISO `days`, `serviceIds`, and `entries` of `{ time, routeType, busCount, notes }`, plus
  an optional `stopTimes` (§10), written only when present.
  `busCount` is an integer of 1 or more. `index` is derived from array position, and a hand-written `index` key is
  rejected by name.

Behavior:

- **Writes to**: `bus_campus.bus_schedules` (`_dev` unless `--prod`)
- **Creates only with `--create`**: updates use `replaceOne` with `upsert: false`, and `matchedCount !== 1` aborts.
  A missing document aborts the run before anything is written, unless `--create` is given; then it is inserted.
  A typo'd key therefore cannot silently create a pattern. `--dry-run` lists what `--create` would insert.
- **Refuses overlaps**: before writing, the tool reads every other pattern of the same services. It refuses when
  one shares a weekday with a pattern in the file and their date ranges overlap, and names both. Ranges that only
  meet end to end, such as `effectiveUntil: 2026-12-18` and `effectiveFrom: 2026-12-21`, are accepted. Patterns of
  those services that the file does not describe are listed for information.
- The diff and `--check` compare `days`, the range and the entries.

```bash
npm run schedule -- --dry-run          # print the diff, write nothing
npm run schedule -- --check            # exit 1 if the DB differs from the file
npm run schedule                       # apply to bus_campus_dev
npm run schedule -- --prod             # apply to bus_campus
npm run schedule -- --file scripts/data/commute-schedule.json --create --dry-run   # first load: list inserts
npm run schedule -- --file scripts/data/commute-schedule.json --create             # first load: insert
```

**A write needs no restart.** Every api replica and the poller's estimate pollers serve it within a minute: each
process caches a week for `WEEK_CACHE_TTL_MS` (one minute) and then waits for the reload (ADR 0012, D6).

### `scripts/drop-legacy-schedule-collections.js`

Drops the pre-2026-03 per-day-type schedule collections (`INJA_weekday`, `JAIN_friday`, … and the two stray
`*_friday_sorted`). Run once against production on 2026-08-31; kept because the same eight names may still exist
in another environment. A no-op where they are already absent.

- **Drops from**: `bus_campus` (`_dev` unless `--prod`)
- **Allowlist, never a prefix match** — a regex like `/^(INJA|JAIN)_/` would drop a collection somebody adds next
  year. The script can only ever drop the eight names it lists.
- **Refuses unless the replacement is healthy**: `bus_schedules` must exist with exactly 4 documents. Without that
  guard, running it against a database where the migration never happened would destroy the only timetable.
- **Dumps every collection to `__backups__/` before dropping**, and aborts if a dump comes back short.

```bash
node scripts/drop-legacy-schedule-collections.js --dry-run   # list, no writes
node scripts/drop-legacy-schedule-collections.js --prod      # back up, then drop
```

### `scripts/seed-eskara.js`

Seeds ESKARA fasttrack-inja test data into the dev DB.

- **Writes to**: `bus_campus_dev.bus_overrides`
- **Creates**: 2 override documents (2026-03-09 with 4 entries, 2026-03-10 with 9 entries)

```bash
node scripts/seed-eskara.js
```

---

## 13. Endpoint Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/bus/config` | GET | Bus groups array (SDUI config) |
| `/bus/config/:groupId` | GET | Single group config (on-demand, includes stations for realtime) |
| `/bus/realtime/data/:groupId` | GET | Realtime bus positions + stationEtas (polled) |
| `/bus/schedule/data/:serviceId/smart` | GET | **Main** — Smart schedule with status + auto-selected date |
| `/bus/schedule/data/:serviceId/week` | GET | **Deprecated** — Raw 7-day resolved schedule |
| `/bus/schedule/data/:serviceId/week?from=YYYY-MM-DD` | GET | **Deprecated** — 7-day schedule for specific week |

### Headers

**Request**:
- `Accept-Language: ko|en|zh` — determines i18n language (default: ko)
- `If-None-Match: "etag"` — conditional GET for 304

**Response**:
- `ETag: "..."` — for conditional requests
- `Cache-Control: public, max-age=300` — 5-minute browser/CDN cache
- `X-Response-Time: 1.23ms` — server processing time
- `X-Request-Id: uuid` — request correlation

---

## 14. Dependency Policy

TypeScript 전환을 앞두고 (2026-05-24) 모든 의존성을 정확 버전으로 lock. TS 마이그레이션 중 "에러가 TS 문법 때문인지 패키지 버전 변화 때문인지" 분간 불가능한 사태를 방지하기 위함.

### 규칙

- **`package.json`의 모든 deps/devDeps는 정확 버전** (`^`, `~` 금지). `.npmrc`의 `save-exact=true`가 신규 install을 자동으로 정확 버전으로 저장.
- **`engine-strict=true`**: `npm ci` and `npm install` fail when the running Node is outside `engines.node`. Nothing else checks it: `npm run dev`, `npm test` and `npx jest` run on whatever Node the shell has, so run `nvm use` first. The Dockerfile runs `npm ci` before `.npmrc` is copied, so the image does not check it either; `__tests__/nest/infra/node-version.test.ts` keeps both stages on the `.nvmrc` major.
- **업데이트 절차**:
  1. 단일 PR에 단일 패키지 bump (`npm install foo@X.Y.Z`).
  2. `npm test` + `npm run lint` + `npm run knip` + `npm run depcheck` 모두 통과.
  3. 메이저 bump는 사용처 영향 분석 commit 메시지에 명시.
- **TS 전환 기간 중에는 패키지 추가/변경 동결.** 신규 의존성이 필요하면 별도 PR로 lock 정책에 맞춰 추가.

### Deferred majors (TS 전환 후 처리)

| 패키지 | 현재 | 최신 | 이유 |
|---|---|---|---|
| `dotenv` | 16.6.1 | 17.x | 단순 `require("dotenv").config()` 패턴만 사용하나 보수적으로 16에 머무름. TS 후 평가. |
| `axios` | 1.13.6 | 1.16.x | 이전 maintainer 패턴 따라 의도적으로 정확 핀. 명시적 업데이트 결정 필요. |

### 도구

- `npm run knip` — 미사용 파일/의존성 audit (exports check off; `knip.json` 참고)
- `npm run depcheck` — 미사용 의존성 audit (`pino-pretty`, `node-cron` ignore — 동적/CLI 로드)

### Node runtime

**Node 26 LTS lock.** `engines.node` is `>=26.12.1 <27`, and `.npmrc`'s `engine-strict=true` fails an install on any other Node. `.nvmrc` holds `26`, so `nvm use` picks it, and CI reads the same file (`actions/setup-node` with `node-version-file`). Both Dockerfile stages build from `node:26-alpine`.

Why 26:

- **Node 22 reaches end of life on 2027-04-30.** Node 24 has been in maintenance since 2026-10-20 and ends on 2028-04-30. Node 26 has been LTS since 2026-10-28 and ends on 2029-04-30.
- **The floor is 26.12.1**, the security release that fixed a Brotli decoder out-of-bounds write. The suite was checked on 26.13.0, the version `node:26-alpine` resolved to on 2026-10-30.

---

## Appendix: Realtime vs Schedule Architecture

```
┌──────────────────────────────────────────────────────┐
│                    /bus/config                        │
│            groups[] (5 bus services)                  │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   hssc   │  │  campus  │  │fasttrack │  ...       │
│  │ realtime │  │ schedule │  │ schedule │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │                 │
│       ▼              ▼              ▼                 │
│  /bus/realtime  /bus/schedule   /bus/schedule         │
│  /data/hssc    /data/campus-   /data/fasttrack-      │
│                 inja/smart      inja/smart            │
│       │              │              │                 │
│       │         ┌────┴────┐    ┌────┴────┐           │
│       │         │ suspend │    │ suspend │           │
│       │         │ check   │    │ check   │           │
│       │         └────┬────┘    └────┬────┘           │
│       │              │              │                 │
│       ▼              ▼              ▼                 │
│  External API   MongoDB         MongoDB              │
│  (polling)      bus_schedules   bus_overrides         │
│                 bus_overrides                         │
└──────────────────────────────────────────────────────┘
```

**Realtime buses** (hssc, jongro02, jongro07): Config (stations, refreshInterval) is served via `/bus/config/:groupId` — fetched once and ETag-cached. Dynamic data (bus positions, stationEtas) is served via `/bus/realtime/data/:groupId` — polled at `refreshInterval` (10-40s) with `Cache-Control: no-store`. No MongoDB involvement; data comes from external APIs.

**Schedule buses** (campus, fasttrack): Data comes from MongoDB collections via `/smart` endpoint. The server auto-selects the best week and date, returns a status field (`active`/`suspended`/`noData`), and filters out hidden days. Suspend periods skip DB entirely. Supports offline viewing since the full week is downloaded at once.

---

# Part 2: External APIs

# HSSC (인사캠 셔틀버스) API

> External API → `config.api.hsscNew`
> Polling: 10초 간격 (`hssc.fetcher.js`)

## 정상 작동 패턴

- 응답: JSON 배열 (각 항목에 `stop_name`, `seq`, `get_date`, `line_no`, `stop_no`)
- `get_date` 형식: `"YYYY-MM-DD a h:mm:ss"` (한국어 locale, 예: `"2025-03-03 오후 3:30:00"`)
- 운행 중: `get_date`가 현재 시간 기준 10분 이내 (농구장 정류소는 3분 이내)
- `seq`는 circular route index (0–10) → `toLinearSequence()`로 linear 1–11로 변환

## 비운행 시간 / 휴일 패턴

- **빈 배열을 반환하지 않음** — 항상 6개 항목이 오지만 `get_date`가 마지막 운행 시간으로 고정
- 야간/휴일: `get_date`가 수시간~수일 전 값 → stale data filter가 전부 제거 → 빈 배열 반환
- 매우 오래된 ghost bus 사례 확인 (fixture에서 `get_date`가 2주 전인 데이터 발견)

## 서버 처리

| 상황 | 처리 |
|---|---|
| 정상 응답 (배열) | `stopNameMapping`으로 역명 변환, stale data 필터링, busCache 저장 |
| 비배열 응답 (HTML, 객체 등) | `if (!Array.isArray(apiData)) return;` — early return, 이전 데이터 유지 |
| API 에러 / 타임아웃 | catch 블록 → 로그, 이전 데이터 유지 |
| 전체 stale 데이터 | 시간 필터링 후 빈 배열 → 앱에 빈 목록 전달 |

## Stale 데이터 필터링

- 기본: `eventDate`가 현재 기준 **10분** 초과 시 제거
- 농구장 (터미널): **3분** 초과 시 제거 (회차 지점이라 더 엄격)
- 기준: `STALE_MINUTES_DEFAULT = 10`, `STALE_MINUTES_TURNAROUND = 3`

## 테스트 커버리지

- `edge-cases.test.js`: stale data → empty, API error → 이전 데이터 유지, 비배열 응답 guard
- `hssc-transform.test.js`: stopNameMapping, sequence 변환, 시간 필터링
- `route-responses.test.js`: HTTP 응답 스키마 (meta, data 구조)

## 라우트 (`/bus/realtime/data/hssc`)

- `realtime.routes.js`에서 통합 제공 (buses + stationEtas)
- `mapBuses()`: fetcher의 1-based `sequence` → 0-based `stationIndex` 변환
- stations는 `/bus/config/hssc` 응답에 포함 (config/data 분리)

## 수정 이력

- **2025-03 비배열 응답 guard 추가** (`hssc.fetcher.js` line 43): `if (!Array.isArray(apiData)) return;`
  - 원인: API가 HTML 에러 페이지나 객체를 반환할 경우 `.map()` 크래시 방지
  - 테스트: `edge-cases.test.js` — "non-array response" 2건 추가, 통과 확인
- **2026-03 config/data 분리**: `hssc.routes.js` + `jongro.routes.js` → `realtime.routes.js` 통합. stations는 `bus-config.data.js`로 이동.

---

# Jongro (종로02, 종로07) API

> External API → URLs composed at runtime from `config.api.seoulBusServiceKey` + per-route `busRouteId` in `JONGRO_ROUTES` (`src/bus/bus.constants.ts`) via `toJongroArrivalsUrl` / `toJongroPositionsUrl`
> Polling: 25초 간격 (each route's `pollIntervalMs` in `JONGRO_ROUTES`, `src/bus/bus.constants.ts`; 40초 until 2026-10-18)

## API 종류

| API | 용도 | 응답 구조 |
|---|---|---|
| `jongroXXList` | 각 정류장별 도착 정보 | `msgBody.itemList[]` — stId, staOrd, stNm, plainNo1, mkTm, arsId, arrmsg1 |
| `jongroXXLoc` | 버스 GPS 실시간 위치 | `msgBody.itemList[]` — lastStnId, tmX, tmY, plainNo |

## 정상 작동 패턴

### _list (정류장 도착 정보)
- `headerCd: "0"` — 항상 전체 정류장 목록 반환 (운행 여부 무관)
- `arrmsg1`: 운행 중이면 `"3분12초후[2번째 전]"`, 비운행 시 `"출발대기"` 또는 `"운행종료"`
- `plainNo1`: 운행 중이면 차량 번호 (예: `"서울74사5537"`), 비운행 시 `" "` (공백 1자)

### _loc (GPS 위치)
- 운행 중: `headerCd: "0"`, `itemList`에 현재 위치 데이터
- 비운행 / 휴일: `headerCd: "4"`, `itemList: null` — 버스 없음

## 비운행 시간 / 휴일 패턴

- **종로07**: 마을버스 — 주말/공휴일 미운행. `_loc`은 `itemList: null`, `_list`는 전 정류장 `"출발대기"`
- **종로02**: 일반 시내버스 — 주말/공휴일에도 운행. 휴일에도 정상 데이터 확인
- 심야: 두 노선 모두 `arrmsg1: "운행종료"`, `_loc`은 `itemList: null`
- `firstTm`/`lastTm` 필드: 종로02에서 비정상 값 (`"135900/135900"`) 확인 — 서버에서 사용하지 않으므로 영향 없음

## 서버 처리

| 상황 | _list 처리 | _loc 처리 |
|---|---|---|
| 정상 응답 | 전체 매핑, busCache 저장 | station mapping 후 매핑, busCache 저장 |
| `itemList: null` | early return (`if (!apiData) return;`), 이전 데이터 유지 | 동일 |
| API 에러 | catch → 로그, 이전 데이터 유지 | 동일 |
| 미매핑 정류장 ID | N/A | `logger.debug`로 기록, 해당 항목 null → filter(Boolean) 제거 |

## 차량 번호 (carNumber) 처리

### _list: `plainNo1`
- 정상: `"서울74사5537"` → `.slice(-4)` → `"5537"`
- 비운행: `" "` (공백) 또는 `null` → `(plainNo1 || "").trim().slice(-4) || "----"` → `"----"`

### _loc: `plainNo`
- 정상: `"서울75사2009"` → `.slice(-4)` → `"2009"`
- null/빈값 방어: `(plainNo || "").trim().slice(-4) || "----"` → `"----"`
- 비운행 시에는 `itemList: null` → early return이므로 `plainNo` 처리까지 도달하지 않지만, 일관성을 위해 동일한 guard 적용

## 테스트 커버리지

- `edge-cases.test.js`: 빈 itemList → 빈 배열, API error → 크래시 없음, plainNo1 공백/null → "----", plainNo null → "----"
- `jongro-transform.test.js`: bus list 매핑, carNumber 추출, location 매핑
- `route-responses.test.js`: HTTP 응답 스키마, station/location 라우트

## 수정 이력

- **2025-03 plainNo1 빈 값 처리** (`updateJongroBusList`, line 94): `plainNo1.slice(-4)` → `(plainNo1 || "").trim().slice(-4) || "----"`
  - 원인: 비운행 시 `plainNo1 = " "` → `" ".slice(-4)` = `" "` (공백 반환), null이면 크래시
  - 테스트: `edge-cases.test.js` — plainNo1 공백/null 2건 추가, 통과 확인
- **2025-03 plainNo 빈 값 처리** (`updateJongroBusLocation`, line 63): `plainNo.slice(-4)` → `(plainNo || "").trim().slice(-4) || "----"`
  - 원인: _list의 plainNo1과 동일한 패턴 누락. 일관성 및 방어적 코딩
  - 테스트: `edge-cases.test.js` — plainNo null 1건 추가, 통과 확인
- **2025-03 미매핑 정류장 로깅 추가**: unmapped lastStnId에 `logger.debug` 추가 (line 38)

---

# Station Hyehwa (혜화역 종로07 도착 정보) API

> External API → `config.api.stationHyehwa`
> Polling: 40초 간격 (`station.fetcher.js`)

## 정상 작동 패턴

- 응답: `msgBody.itemList[0].arrmsg1` — 도착 예정 메시지 (예: `"3분후[1번째 전]"`, `"곧 도착"`)
- 빈 `itemList` (길이 0): 버스 없음 → `"정보 없음"` 으로 설정

## 비운행 시간 / 휴일 패턴

- `headerCd: "4"`, `itemList: null` (결과 없음)
- **현재 상태 (2025-02-28 ~ 2025-03-04 수집)**: 198개 fixture 파일 전부 `headerCd: "4"`, `itemList: null`
  - 평일 출퇴근 시간 포함 전 시간대에서 동일
  - API 엔드포인트 또는 정류장 ID 설정 문제로 추정
  - 서버는 graceful하게 처리: `"정보 없음"` 기본값 유지

## 서버 처리

| 상황 | 처리 |
|---|---|
| 정상 응답 (`itemList` 있음) | `arrmsg1` 값 저장, busCache 기록 |
| 빈 `itemList` (길이 0) | `"정보 없음"` 설정 (ghost data 방지) |
| `itemList: null` / `msgBody` 없음 | `response.data?.msgBody?.itemList` → undefined → early return, 이전 데이터 유지 |
| `response.data` 자체가 null | optional chaining → undefined → early return |
| API 에러 / 타임아웃 | catch → 로그, 이전 데이터 유지 |

## Ghost Data 방지

빈 `itemList`가 오면 반드시 `"정보 없음"`으로 리셋:
- 시나리오: 이전 폴링에서 `"3분후 도착"` → 다음 폴링에서 빈 응답 → 오래된 도착 정보를 계속 보여주면 안 됨
- `station.fetcher.js:14`: `arrmsg1 = apiData.length === 0 ? "정보 없음" : apiData[0].arrmsg1;`

## 라우트 (`/bus/station/01592`)

- 종로07 도착 정보 + 인사캠 셔틀(HSSC) ETA를 합쳐서 반환
- HSSC ETA는 `station.data.js`의 `computeAllStationEtas()`로 계산
- 혜화역(승차장) 정류장의 ETA → `hsscEta`로 반환

## ETA 계산 (`station.data.js`)

- `computeEta(station, busData)`: busData가 null/undefined일 때 `"도착 정보 없음"` 반환 (배열 guard 추가)
- `computeAllStationEtas()`: 각 정류장별 ETA 계산, 원본 배열 mutation 없음

## 테스트 커버리지

- `edge-cases.test.js`: API error → `"정보 없음"`, 정상 업데이트, 빈 itemList → 리셋, 네트워크 에러 → 이전 상태 유지, malformed response (missing msgBody), null response.data
- `station-eta.test.js`: `computeEta` 순수 함수 테스트 (stale bus, terminal skip, fallback, null/undefined busData)
- `route-responses.test.js`: `/bus/station/01592` 응답 스키마

## 수정 이력

- **2025-03 optional chaining 추가** (`station.fetcher.js` line 12): `response.data.msgBody.itemList` → `response.data?.msgBody?.itemList`
  - 원인: `msgBody`가 없을 때 TypeError 발생 가능 (jongro fetcher는 이미 `?.` 사용 중이었음)
  - 테스트: `edge-cases.test.js` — malformed response/null data 2건 추가, 통과 확인
- **2025-03 computeEta 배열 guard 추가** (`station.data.js` line 33): `if (!Array.isArray(busData)) return NO_INFO;`
  - 원인: 호출 체인상 항상 배열이 들어오지만, 만약 busData가 null이면 `.filter()` 크래시
  - 테스트: `station-eta.test.js` — null/undefined busData 2건 추가, 통과 확인

## 참고: API 엔드포인트 점검 필요

수집 데이터 기준 (2025-02-28 ~ 2025-03-04) 전 시간대 `headerCd: "4"` 응답.
정류장 ID 또는 노선 설정 확인 필요. 현재 서버는 문제없이 fallback 처리 중.

---

# External API Usage

The server's `ROLE=poller` container is the only caller of the Seoul TOPIS APIs; skkuverse-crawler makes none.

---

## 공공데이터포털 (Seoul Open Data) APIs

### Endpoints We Use

Single shared TOPIS service key drives every Jongro route. Per-route URLs
are composed at runtime from `SEOUL_BUS_SERVICE_KEY` + `busRouteId` in
`JONGRO_ROUTES` in `src/bus/bus.constants.ts` (`toJongroArrivalsUrl` / `toJongroPositionsUrl`
in `src/bus/realtime/jongro/bus-realtime-jongro.mapper.ts`, called by the client at each request). Adding a route = one `JONGRO_ROUTES` entry and its stored `jongro-route-attributes`.

| # | Env Var | Purpose | Interval |
|---|---------|---------|----------|
| 1 | `SEOUL_BUS_SERVICE_KEY` (composes /arrive/getArrInfoByRouteAll per route) | Per-route arrival info (all stops) — jongro02, jongro07, jongro08 | 25s |
| 2 | `SEOUL_BUS_SERVICE_KEY` (composes /buspos/getBusPosByRtid per route) | Per-route bus GPS positions — jongro02, jongro07, jongro08 | 25s |

### Daily Usage and Quota Check

Every metered upstream (the TOPIS operations `getArrInfoByRouteAllList` and `getBusPosByRtidList`, GBIS, NAVER
Directions, TMAP) has a daily quota per API key and per operation, and every caller of the same key, a local
`npm run dev` included, draws on it. What the server may spend is fixed in code: the poll intervals in
`JONGRO_ROUTES` and `REGIONAL_ROUTES` (`src/bus/bus.constants.ts`), the `REGIONAL_BUS` and `GBIS` switches, and the
per-process caps of the shuttle estimate clients. A call refused for quota logs `bus.topis.quota_exceeded` or
`bus.gbis.quota_exceeded` ([logging.md](reference/logging.md)). Development keeps the extra pollers off; stop local
pollers when you are done.

## Non-공공데이터포털 APIs

### Polled (Background)

| # | Source | Env Var | Purpose | Interval |
|---|--------|---------|---------|----------|
| 1 | SKKU shuttle system | `API_HSSC_NEW_PROD` / `_DEV` | HSSC campus shuttle bus positions | 10s |
| 2 | skku.edu | Hardcoded URL | Building/space data sync (3-phase: buildList→buildInfo→spaceList) | 7 days |

> **Building sync** moved from on-demand (per user request) to weekly background sync in `building.sync.js`. Data is stored in MongoDB (`skkubus_building`/`_dev` DB per `MONGO_BUILDING_DB_NAME`) and served via `/building/*` routes. See the Building API section below for endpoint details.

### Internal Services

| # | Service | Purpose |
|---|---------|---------|
| 3 | MongoDB Atlas | Database reads/writes (bus_cache, schedules) |

---

## Notes

- `API_STATION_HEWA` has no PROD/DEV split (single env var). All other polled APIs use `apiUrl()` for environment selection.
- The `skku.edu` building sync URLs are hardcoded (not env-var-configured). Sync runs once per 7 days.

---

# SKKU Campus Map API

> External API: `https://www.skku.edu/skku/about/campusInfo/campusMap.do`
> Public endpoint, no auth required. Hardcoded URLs (not in .env).

SKKU 공식 캠퍼스맵에서 제공하는 건물/시설 데이터 API. `mode` 파라미터로 3가지 기능 구분.

## API Modes

### 1. `buildList` — 건물 목록

```
GET campusMap.do?mode=buildList&mode=list&srSearchValue={query}&campusCd={1|2}
```

- `srSearchValue`: 검색어 (빈 문자열이면 전체 반환)
- `campusCd`: 1=인사캠(HSSC), 2=자과캠(NSC)

**응답**: `{ buildItems: [...] }`

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `id` | int | SKKU 내부 PK (전체 unique) | `27` |
| `buildNo` | string \| null | 건물 코드 (건물만 있음, 시설은 null) | `"248"` |
| `buildNumber` | string \| undefined | 별도 건물 번호 (대부분 undefined) | |
| `campusCd` | string | 캠퍼스 코드 | `"2"` |
| `buildNm` | string | 한글 이름 | `"삼성학술정보관"` |
| `buildNmEng` | string | 영문 이름 | `"Samsung Library"` |
| `latitude` | **string** | 위도 | `"37.293885"` |
| `longtitude` | **string** | 경도 (오타 그대로) | `"126.974906"` |
| `krText` | string | 한글 설명 (장애인 편의정보 포함) | |
| `enText` | string | 영문 설명 | |
| `handicappedElevatorYn` | string | 장애인 엘리베이터 | `"Y"` / `"N"` |
| `handicappedToiletYn` | string | 장애인 화장실 | `"Y"` / `"N"` |
| `filePath` | string | 이미지 경로 | `"/_attach/image/2018/07/"` |
| `encodeNm` | string | 이미지 파일명 | `"LSHRXXTOWcbuUlegcgZV.jpg"` |
| `writerId` | string | 작성자 | `"andwise"` |
| `createDt` | string | 생성일 (ISO 8601) | |
| `updateDt` | string | 수정일 (ISO 8601) | |

이미지 전체 URL: `https://www.skku.edu{filePath}{encodeNm}`

**주의**: 좌표가 **string** 타입. `parseFloat()` 필수.

---

### 2. `buildInfo` — 건물 상세 (층별 공간 + 첨부파일)

```
GET campusMap.do?mode=buildInfo&buildNo={buildNo}&id={id}
```

- `buildNo`: buildList의 buildNo
- `id`: buildList의 id (skkuId)

**응답**: `{ item: {...}, floorItem: [...], attachItem: [...] }`

#### `item` — 건물 메타

필드명이 buildList와 다름 (snake_case):
`build_nm`, `build_nm_eng`, `build_no`, `campus_cd`, `id`, `latitude`, `longtitude`, `kr_text`, `en_text`, `handicapped_elevator_yn`, `handicapped_toilet_yn`, `create_dt`, `update_dt`

#### `floorItem[]` — 층별 공간

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `floor` | string | 층 코드 | `"01"`, `"B1"`, `"B2"` |
| `floor_nm` | string | 한글 층명 | `"1층"`, `"지하1층"` |
| `floor_nm_eng` | string | 영문 층명 | `"1F"`, `"B1"` |
| `space_cd` | string | 공간 코드 | `"480102"` |
| `spcae_nm` | string | 한글 공간명 (오타 주의: spcae) | `"컴넷"` |
| `spcae_nm_eng` | string | 영문 공간명 | `"Computer Zone"` |

- 건물에 따라 0~51+개 (600주년기념관: 0개, 삼성학술정보관: 51개)
- 좌표 없음 (건물 좌표를 상속해서 사용)

#### `attachItem[]` — 첨부 이미지

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | int | 첨부 ID |
| `map_id` | int | 건물 ID (= skkuId) |
| `file_nm` | string | 원본 파일명 |
| `encode_nm` | string | 인코딩 파일명 |
| `file_path` | string | 저장 경로 |
| `file_ty` | string | 파일 타입 (`"I"` = image) |
| `image_alt` | string | alt 텍스트 |

---

### 3. `spaceList` — 시설/공간 목록

```
GET campusMap.do?mode=spaceList&mode=spaceList&srSearchValue={query}&campusCd={1|2}
```

**응답**: `{ items: [...], count: N }`

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `spaceCd` | string | 공간 코드 | `"480102"` |
| `buildNo` | string | 건물 코드 | `"248"` |
| `buildNm` | string | 한글 건물명 | `"삼성학술정보관"` |
| `buildNmEng` | string | 영문 건물명 | `"Samsung Library"` |
| `floorNm` | string | 한글 층명 | `"1층"` |
| `floorNmEng` | string | 영문 층명 | `"1F"` |
| `spcaeNm` | string | 한글 공간명 (오타) | `"컴넷"` |
| `spcaeNmEng` | string | 영문 공간명 | `"Computer Zone"` |
| `latitude` | **number** | 위도 | `37.293885` |
| `longtitude` | **number** | 경도 (오타) | `126.974906` |
| `m` | int | 상태/타입 표시자 | |
| `conspaceCd` | string \| null | 연결 공간 코드 | |

**주의**: 좌표가 **number** 타입 (buildList의 string과 다름).

---

## API 간 필드명 불일치

SKKU API 내부에서 동일 데이터를 다른 네이밍으로 반환:

| 데이터 | buildList | buildInfo | spaceList |
|--------|-----------|-----------|-----------|
| 건물명(한) | `buildNm` | `build_nm` | `buildNm` |
| 건물코드 | `buildNo` | `build_no` | `buildNo` |
| 캠퍼스 | `campusCd` | `campus_cd` | (없음, 요청 파라미터) |
| 좌표 | **string** | string | **number** |
| 공간명 | — | `spcae_nm` | `spcaeNm` |
| casing | camelCase | snake_case | camelCase |

---

## 알려진 이슈

- `longtitude`: longitude의 오타. 3개 API 모두 동일.
- `spcae_nm` / `spcaeNm`: space의 오타. buildInfo와 spaceList 모두.
- 좌표 타입 불일치: buildList는 string, spaceList는 number. 비교 시 `parseFloat()` 필수.
- 일부 `spcae_nm_eng` 값이 `"undefined"` 문자열 (null이 아닌 리터럴 "undefined").

---

# Part 5: Building Data

> [!NOTE]
> Moved. The building module is explained in [explanation/building-architecture.md](explanation/building-architecture.md). The 2026-03 data survey (uniqueness, buildInfo vs spaceList, coordinates) and the connections guide are kept as a snapshot in [archive/building-data-2026-03.md](archive/building-data-2026-03.md).
