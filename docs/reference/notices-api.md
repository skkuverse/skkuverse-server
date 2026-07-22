---
title: Notices API 계약
type: reference
status: accepted
owner: spencer0124
last-updated: 2026-10-29
audience: internal
---

# Notices API 계약

> `/notices/*` 읽기 전용 엔드포인트 + `/internal/notices/*` dispatch 트리거의 요청·응답 계약. 설계 근거는 [explanation/notices-architecture.md](../explanation/notices-architecture.md), FCM dispatch 결정은 [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) 참조.

> [!NOTE]
> 응답 envelope은 서버 공통 `{ meta, data }` 형태 (`src/http/response.interceptor.ts`). 모든 엔드포인트가 이 형태를 공유한다.

## 요약

| Method | Path | 인증 | 용도 |
| --- | --- | --- | --- |
| GET | `/notices/tabs` | optional | 서버 주도 탭 구성 |
| GET | `/notices/source/:sourceId` | optional | 단일 소스 공지 리스트 (커서 페이지네이션) |
| GET | `/notices` | optional | Several sources merged into one list, each article once (`?sourceIds=`) |
| GET | `/notices/proxy/attachment` | optional | 첨부파일 프록시 |
| GET | `/notices/:sourceId/:articleNo` | optional | 공지 상세 |
| GET | `/notices/overview` | optional | AI answer card for a search (`?q=&sourceIds=`) |
| POST | `/internal/notices/dispatch-pending` | internal | 크롤러 ping → FCM dispatch sweep |

The controllers are the source of truth for the routes: one per flow under `src/notices/` (`tabs/`, `list/`, `detail/`, `overview/`, `attachment/`, `dispatch/`), each `notices-<flow>.controller.ts`; the dispatch one is `@Controller("internal/notices")`.

## 공통 규칙

- **Authentication:** optional. A request without a bearer token passes; one with a token is verified, and only a rejected token answers 401 `AUTH_INVALID`. `src/http/request-authentication.middleware.ts` asks `REQUEST_AUTHENTICATOR` (ADR 0023) and sets `req.principal`, bound on `/notices` before the rate limit (the explanation says why). `/internal/notices` has neither authentication nor a rate limit.
- **Rate limit:** `/notices` is limited by the `notices` rate-limit class, which `RATE_LIMIT_POLICY` decides ([ADR 0023](../decisions/0023-perimeter-ports.md)). A refused request answers 429 `RATE_LIMIT` with `Retry-After`, and may carry `RateLimit-*` headers. The limits and how requests are counted belong to the production implementation, outside this repository's contract.
- **로컬라이즈:** `Accept-Language`로 `label` 등 로컬라이즈 (ko/en, zh → en fallback).

## GET /notices/tabs

서버 기반 탭 구성. 앱의 공지 탭 UI를 이 응답으로 렌더링. `categories.json` + `sources.json`(둘 다 `src/notices/`)을 조합.

- `Cache-Control: private, max-age=3600`
- 배열 순서 = 탭 표시 순서
- Tagged payload: `tabMode: "fixed"` → `fixed: { sourceId, name, campus }`, `tabMode: "picker"` → `picker: { sources, maxSelection, defaultIds, campusDefaultIds }`
- 앱이 모르는 `tabMode` → 해당 탭 skip (forward compat)
- `schemaVersion`으로 클라이언트가 스키마 호환성 판단

```jsonc
{
  "meta": { "lang": "ko" },
  "data": {
    "schemaVersion": 1,
    "tabs": [
      {
        "key": "dept", "label": "학과", "tabMode": "picker",
        "picker": {
          "sources": [
            { "id": "arch", "name": "건축학과", "campus": "nsc", "college": "공과대학",
              "noticeAvailable": true, "excludeReason": null }
            // ... ~125개
          ],
          "maxSelection": 5,
          "defaultIds": [],
          "campusDefaultIds": {}
        }
      },
      {
        "key": "academic", "label": "학사", "tabMode": "fixed",
        "fixed": { "sourceId": "skku-notice02", "name": "성균관대_통합(학사)", "campus": "both" }
      }
      // ... 9개 탭 (categories.json: dept, academic, scholarship, career, recruitment, event, library, dorm, general)
    ]
  }
}
```

> [!NOTE]
> 구 `GET /notices/sources`는 2026-04-15 삭제. 학과 목록은 `/notices/tabs`의 picker 탭 `sources` 배열에 포함된다.

## GET /notices/source/:sourceId

쿼리: `cursor` (base64url), `limit` (1~50, default 20), `type` (optional: `action_required | event | informational`), `q` (optional 검색어).

```jsonc
{
  "meta": { "lang": "ko", "count": 2 },
  "data": {
    "notices": [
      {
        "id": "69d2024f8e7a44b79c89f936",
        "sourceId": "skku-main",
        "articleNo": 136023,
        "title": "[모집] 2026 학생 창업유망팀 ...",
        "category": "행사/세미나",
        "author": "안찬웅",
        "department": "학부통합(학사)",
        "date": "2026-04-10",
        "views": 7865,
        "sourceUrl": "https://www.skku.edu/...",
        "hasContent": true,
        "hasAttachments": true,
        "isEdited": true,
        "summary": {
          "oneLiner": "2026-04-09까지 학생 창업유망팀 신청",
          "type": "action_required",
          "endAt": { "date": "2026-04-09", "time": null }
        }
      }
    ],
    "nextCursor": "eyJkIjoi...",
    "hasMore": true
  }
}
```

- **리스트 summary는 brief** (4필드: `oneLiner`, `type`, `startAt`, `endAt`). full summary는 상세에서만. 앱 `formatDeadlineBadge`가 `type`별로 배지를 그린다.
- **`startAt`·`endAt` 파생(요청 시각 기준):**
  - v1 공지(`summaryVersion` 없음): `selectEffectivePeriod`. `action_required`는 `summaryPeriods` 중 다가오는 가장 이른 마감(같은 날 시간 박스 일정 제외, 모두 지났으면 가장 최근 마감), 그 밖은 `periods[0]`.
  - v2 공지(`summaryVersion >= 2`, `summaryDates` 있음): `selectRoleBadge`. 신청 기간(`summaryApplication.windows`) → `due` 마감 → `happens` 행사 → 모두 지난 신청·마감("마감") → 여러 날 `runs` 범위 순으로 고른다. 저장된 `summaryType`은 보지 않고, 고른 일정에 맞춰 `type`을 정한다(시작 전 신청 기간은 `informational` 범위로 "D-n · 시작까지"). 근거: skkuverse-ai `openspec/changes/refine-notice-summary-v2` design D11.
- **Derived `summary`.** A notice with facts and no stored summary (`summaryAt` unset) gets a rough `summary` from its row so an installed app still shows a one-liner and a D-day: `oneLiner` is line 2 of the row, then its qualifier in full (the whole text, never the short form the row's 26 characters may take), led by the token word for a cancelled, stopped, postponed, extended or changed notice; `endAt` is the shown window's end; `type` is `action_required` for a window, `event` for a session and `informational` otherwise. A notice that carries a stored summary is served as before. `type=` and `q=` match a derived notice by its derived type and by `facts.shortTitle`; a typed page can hold fewer than `limit` notices, and `hasMore` and `nextCursor` still follow the read.
- **`row` (the facts row).** Next to `summary`, an item carries `row`: finished Korean text from the crawler's `facts` record, rendered at the request's KST now (umbrella ADR 0009). It is `null` when the notice has no facts or its facts fail the record schema, and the item then reads as before. `summary` and every other field are unchanged. The fields follow the app sketch's `SketchRow`, and a part the notice lacks is `null`, not left out:

  | Field | Meaning |
  | --- | --- |
  | `token` | `{ text, tone }`, the one status word that leads line 1 (취소, 오늘, 내일 마감, 마감, 중단, 연기, 연장, 변경), or `null` |
  | `title` | Line 1, the short title. When the record's short title is unusable, the original title, which over 20 characters drops its bracket groups (one naming a restricted audience stays) and keeps its whole words with `…` |
  | `when` | Line 2, when and what to do (the facts row's `line2`), with no track tag; a thing's name stays in brackets |
  | `urgent` | `true` only for a deadline today or tomorrow |
  | `dateMark` | `"warning"` when the date is shown as written, `"abstain"` when the date could not be read, else `null` |
  | `qualifier` | The one fact that matters most, at the end of line 2 after ` · `, whitespace collapsed, or `null`. A fact the crawler read from a table reads `label · quote`, and the 26 characters count that whole text. When `when`, ` · ` and the whole text would pass 26 characters, the crawler's short form of it (`compact`, under the same `label`; for a place its own `compact`) shows if that fits, and a short form never shows without its `label`. It is `null` when no form fits, or when no rule applies, and the count of conditions and the online word have no short form |
  | `board` | The source's display name on `GET /notices` with two or more `sourceIds`, `null` on one source and on `GET /notices/source/:sourceId` |
  | `dimmed` | `true` for a closed, ended, cancelled or staff-only notice |
  | `day` | `today`, `yesterday`, `thisWeek` or `earlier`, by the notice's posting date `date`, the list's sort key, read as a KST calendar day (the first ten characters, so a stored minute is ignored); a week starts on Monday. A posting date after today reads `today`, and one that is no calendar day reads `earlier`. The list order is unchanged, so each group is contiguous |

  The text is Korean for every `Accept-Language`. The facts row's `status` and `itemId` stay on the server.
- **커서는 filter-agnostic** — `(date, _id)` 페어로 페이징한다. `type`을 바꿔도 accept (일부 skip 가능 → 클라이언트가 필터 변경 시 리스트 리셋).
- **커서 payload는 여전히 `{d, c, i}` 3필드** — `c`(구 `crawledAt`)는 더 이상 읽지 않지만 롤백 호환을 위해 계속 실어 보낸다. 클라이언트는 커서를 opaque 문자열로만 다루면 되고, 필드가 하나 줄어드는 후속 릴리스에도 영향받지 않는다. 배경은 [decisions/0007-notice-ordering-key.md](../decisions/0007-notice-ordering-key.md).

## GET /notices (several sources)

`?sourceIds=a,b,c` with the same `limit`, `type`, `cursor` and `q` as above. The ids go in one `sourceIds`, comma-separated; a repeated `sourceIds` key is `400 INVALID_PARAMS`, as on `GET /notices/overview`. The named sources are merged into one list, newest first. `src/notices/list/notices-list.schema.ts` and `src/notices/list/notices-list.wire.ts` are the source of truth for the parameters and the response shape.

- **Each article once.** When `sourceIds` names two or more distinct sources, an article posted on several of them is one row (umbrella ADR 0009 D8). Copies are the notices with the same `dupOf`, which the crawler writes; a notice without `dupOf` is an article of its own. Copies on one source collapse too.
- **The copy served.** The row is the first copy in list order: the latest `date`, then the highest `id`. It keeps its own `id`, `sourceId`, `articleNo` and `row.board`, and sits at that copy's place in the list. A copy is hidden only when another copy in the read sorts before it, and the crawler never moves either key, so a refresh of `crawledAt` or `views` between two page reads changes no row.
- **Paging.** `limit`, `hasMore` and `nextCursor` count served rows. The cursor is the last row served, so an article never appears on two pages. A page can hold fewer than `limit` rows while `hasMore` is `true`, when a long run of copies uses up its scans; only `hasMore` says the list ended.
- **One source.** `GET /notices/source/:sourceId`, or a `sourceIds` that names one source, serves every copy.

## GET /notices/proxy/attachment

`?url=&referer=&mode=&name=` — proxies an original attachment. The canonical contract is the `@Get("proxy/attachment")` handler in `src/notices/attachment/notices-attachment.controller.ts` and its query schema `attachmentRequest` in `src/notices/attachment/notices-attachment.schema.ts`.

Outbound policy (`OUTBOUND_POLICY`, purpose `notice-attachment`, [ADR 0023](../decisions/0023-perimeter-ports.md)): the policy checks `url`, `referer` and every redirect hop. A disallowed `url` (or a hop the policy refuses) returns `403 FORBIDDEN`; a disallowed `referer` returns `400 INVALID_PARAMS` before any outbound request. Bodies over 100 MB are refused (`502 UPSTREAM_TOO_LARGE`) or cut off; a transfer stops after 30 s without data or 10 min in total. Inline responses other than PDF, raster images, audio and video are served with `Content-Security-Policy: sandbox; default-src 'none'`, and every response carries `X-Content-Type-Options: nosniff`.

## GET /notices/:sourceId/:articleNo

```jsonc
{
  "meta": { "lang": "ko" },
  "data": {
    "id": "...",
    "sourceId": "skku-main",
    "articleNo": 136023,
    "title": "...",
    "contentMarkdown": "**[모집] 2026 학생 창업유망팀 300+ ...**\n\n성균인 여러분 ...",
    "attachments": [{ "name": "...", "url": "..." }],
    "sourceUrl": "...",
    "editInfo": { "count": 2, "history": [] },
    "summary": {
      "text": "성균관대학교 창업지원단에서 ...",
      "oneLiner": "...",
      "type": "action_required",
      "periods": [
        { "label": null, "startDate": "2026-04-03", "startTime": "09:00", "endDate": "2026-04-09", "endTime": "18:00" }
      ],
      "locations": [
        { "label": null, "detail": "경영관 33101호" }
      ],
      "details": { "target": "...", "action": "...", "host": "...", "impact": null },
      "model": "gpt-4.1-mini-2025-04-14",
      "generatedAt": "2026-04-09T11:52:02.769Z"
    }
  }
}
```

- **본문은 `contentMarkdown` 단일 경로.** `content`/`contentText`/`cleanHtml` 미노출. `contentMarkdown == null`이면 클라이언트는 `sourceUrl` 외부 링크로 fallback (빈 문자열 아님, `null`).
- **Derived full summary.** The detail serves the same derived `type` and `oneLiner` as a full summary with `text` null, empty `periods` and `locations`, null `details` and `model`, and `generatedAt` set to `crawledAt`, so the summary card hides.
- **full summary는 9필드**: brief 3개 + `text`, `periods`, `locations`, `details`, `model`, `generatedAt`.
- **`screen` (the detail screen).** Next to `summary`, the detail carries `screen`: the header, status line, blocks, action bar and original of umbrella ADR 0009 D11 to D16 as finished Korean, rendered from the crawler's `facts` record at the request's KST now. It is `null` when the notice has no facts or its facts fail the record schema, and every other field is unchanged. The fields follow the app sketch's `SketchDetail`, grouped under one key because they are present together, and a part the notice lacks is `null` or empty, not left out:

  | Field | Meaning |
  | --- | --- |
  | `header` | `{ firstSeen, change }`: the day the notice was first seen (오늘, 어제 or `M/D(요일)`, then 처음 올라옴), and `{ what, before, after }` for the first date (`날짜`) or place (`장소`) that moved against the last extraction, else `null` |
  | `status` | `{ word, detail, tone }` or `null`. `word` is one of the D12 words, `tone` one of `open`, `soon` (a deadline today or tomorrow), `neutral`, `stopped`, `closed`, and `detail` the date part or `null`. No status for an event still ahead, a notice with no date, an abstained date or a notice for staff. A closed sign-up whose event is still on reads `마감됨` with the event part as `detail` |
  | `blocks` | `{ label, lines, numbered, foldedCount, footerLink }` in the D13 order for the board's category (the change first when the notice states one), and none for a notice for staff. A block with no lines is left out. A tagged line that repeats an untagged line of its block is left out. Every line is sent; 언제·어디 lists its sessions by start day, the ended ones after the ones still ahead (newest first), and `foldedCount` counts the trailing lines after the first three, which start hidden, so the fold hides the least relevant tail; 이후 일정 carries the `footerLink` |
  | `blocks[].lines` | `{ text, sub, source, actions, quote }`. A condition, an exclusion, a benefit and a cost of missing that the crawler read from a table put its label before it in `text`, as `label · quote`, whatever short form the crawler stored for the list row. `quote` is the record's evidence sentence for the app to highlight in the original, with no label, and `source` (`body`, `title` or `poster`) says where it was read. A body quote is located in the crawler's `contentText`, which can differ from `contentMarkdown` in characters such as `~` and `～`. `actions` are `{ kind: "map", target: "skku_building:<skkuId>", space }` (the building sheet, `space` the room's code or `null`), `{ kind: "search", target }` (a place off campus, by its words, for the phone's map app), `{ kind: "call", target }`, `{ kind: "email", target, subject }` or `{ kind: "link", target }` |
  | `action` | The pinned bar, `{ label, kind: "link", target }` or `{ label, kind: "email", target, subject }`, when exactly one action is open now, else `null`. `subject` is a mailto link's own subject, else `null`: the record's subject rule is a sentence with placeholders, never a subject to copy |
  | `collapsed` | `cancelled`, `closed` or `null`; the app collapses the blocks of a cancelled call or one closed with no event still on |
  | `staffOnly`, `posterOnly` | Booleans |
  | `original` | `{ posterCount, attachments: [{ role, name, url }], links: [{ role, domain, url }] }`. An attachment's `url` is the one in the detail's `attachments` for that file, `null` when the list no longer holds it |

  The text is Korean for every `Accept-Language`. A place building cannot name, or one no building sheet holds, shows its quote with no action, and a fact the verifier disputed is left out. Renamed from `SketchDetail`: the fields sit under `screen`; `change.what` is `날짜` or `장소`; `posters` is `posterCount`; `action` also carries its `target`; `englishOnly` is dropped (umbrella ADR 0009, 2026-10-28), and the body is the existing `contentMarkdown`.
- **ETag/304:** `If-None-Match` 지원. 서버는 `ETag` 세팅 후 조건부 요청에 304.
- `isDeleted` 문서는 404.

## GET /notices/overview

An AI answer for a notice search, in the style of an AI Overview, with numbered sources the app can open. It is a **separate request from the list**: the list never waits for it, and its absence never affects the list. Why it retrieves, caches and times out as it does: [ADR 0016](../decisions/0016-notice-search-overview.md).

**Off in production.** The runtime switch `NOTICE_OVERVIEW` (`src/infra/runtime-switches.ts`) defaults to `off` in production. With it off, every valid request answers `200` with `data.overview: null` and `meta.reason: "unavailable"`, and the server runs no retrieval and no skkuverse-ai call. Development defaults it to `on`.

**Parameters**

| Name | Required | Rule |
| --- | --- | --- |
| `q` | yes | Same rule as the list search: trimmed, 1–100 Unicode codepoints, no control characters |
| `sourceIds` | yes | 1–20 comma-separated known source ids — the search screen's current scope |

**How it is produced.** The server ranks in-scope notices with a hybrid `$rankFusion` over the Atlas indexes `notices_search` and `notices_vector`. The scope is the requested sources, not deleted, and on or after the service start date, exactly like the list. Cross-posted copies are collapsed on the crawler's `dupOf`, as in the list, so each article takes one candidate slot. The top candidates go to skkuverse-ai `POST /api/notices/overview`, and its positional citations are mapped back to notices. That contract is owned by skkuverse-ai (`docs/notice-overview-api.md` in that repo) and is not repeated here.

**Response (overview present)**

```json
{
  "meta": { "lang": "ko", "cached": false },
  "data": {
    "overview": {
      "lead": { "text": "…", "cites": [1] },
      "points": [{ "text": "…", "cites": [1, 2] }],
      "sources": [
        { "n": 1, "sourceId": "skku-main", "articleNo": 140112, "title": "…", "date": "2026-09-24", "contentMissing": false }
      ],
      "lang": "ko",
      "generatedAt": "2026-10-06T08:00:02.512Z"
    }
  }
}
```

- `lead` is one sentence or `null`. Render it only when present; never promote the first point into its place.
- `points` holds at most 5 entries.
- `cites` numbers refer to `sources[].n`. Sources are numbered 1..M in the order the answer first cites them, so `[1]` is always the first source the reader meets.
- `sources[]` carries the detail route key (`sourceId`, `articleNo`), in the same representation as list items. `contentMissing: true` marks an image-only notice; show "원문 확인 필요".
- `lang` is `ko` or `en`. The ai answers in English for any non-`ko` client language, including `zh`.
- `meta.cached` is `true` when the overview was reused from this replica's cache. Reuse requires the same query, sources, language, KST date and unchanged candidate notices.

**Response (no overview)**: always `200`, with `data.overview: null` and `meta.reason`:

| `reason` | Meaning |
| --- | --- |
| `no_results` | No in-scope notice matches the query; the ai was not called |
| `no_answer` | The matching notices do not answer the query |
| `unavailable` | `NOTICE_OVERVIEW` is off, retrieval failed, the ai failed or timed out, or the ai's daily budget is exhausted |

Every response carries `Cache-Control: no-store`.

**Errors**: `400 INVALID_PARAMS` (bad `q` or `sourceIds`), `400 INVALID_SOURCE_ID`, `429 RATE_LIMIT`. Besides the `notices` class, the overview passes the `notices-overview` class (`src/http/notices-overview-rate-limit.middleware.ts` binds it), refused the same way.

**Client obligations**

- Send the overview request alongside the list request, and render the list without waiting for it.
- Use a timeout of about **25 s** with **no automatic retry**. The server answers within 24 s; a retry repeats the whole answer. The app's default (6 s, one retry) must not be used for this call.
- Hide the card when `data.overview` is `null`, including on `429`.
- A source chip opens `/notices/[sourceId]/[articleNo]`. Build any schedule UI from the cited notices' own `summaryPeriods`, not from the answer text.

## POST /internal/notices/dispatch-pending

크롤러가 크롤 cycle 끝에 호출하는 내부 엔드포인트, not callable by clients: `INTERNAL_AUTHORIZER` authorizes it under the `notices.dispatch` scope ([ADR 0023](../decisions/0023-perimeter-ports.md)).

- **동작:** pending 공지를 sweep → claim-lease → FCM Cloud Function 호출로 fan-out. dispatch는 비동기 진행이라 응답이 빠르다.
- **응답:** sweep 결과 카운트 (`swept`/`dispatched`/`skipped` 계열). The response is `SweepSummary` (`src/notices/dispatch/notices-dispatch.wire.ts`): `status`, `source`, `processed`, `sent`, `failed`, `skippedNoTopics`, `cfCalls`, `dedupedDocs`, `durationMs`.
- dispatch 메커니즘(claim-lease, safety-net poller, retry/abandon)은 [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md).
- **No topic, no push.** A claimed group whose boards have no push topic (today only `skku-main`, which no tab lists) gets no Cloud Function call. It is recorded as a skip: `pushedAt` is set, so no later claim takes it, `pushSkippedReason` is `"no-topic"`, and `pushAttempts` is not incremented. Count skips with `pushSkippedReason: "no-topic"`, not with `pushedAt`. The response counts them in `skippedNoTopics`.
- **Push gate.** A notice is claimable once the crawler's live facts job has written `factsAt` (`toClaimFilter` in `src/notices/dispatch/notices-dispatch.query.ts`, [ADR 0024](../decisions/0024-dispatch-gate-on-facts.md)). `factsGate` `ok`, `failed` and `timeout` are all claimable. A notice the job never gated, such as a backfilled one, is never pushed.
- **Claim order.** Each claim takes the newest claimable notice, `date` descending then `_id` descending (`CLAIM_SORT` in `src/notices/dispatch/notices-dispatch.query.ts`), so a backlog larger than `sweepBatchCap` sends the newest notices first.

## 에러 코드

| HTTP | code | 상황 |
| --- | --- | --- |
| 400 | `INVALID_SOURCE_ID` | `sources.json`에 없는 sourceId |
| 400 | `INVALID_PARAMS` | articleNo 숫자 아님, limit 범위 초과, 알 수 없는 type |
| 400 | `INVALID_CURSOR` | base64url 디코딩·JSON 파싱·shape 검증 실패 |
| 401 | `AUTH_INVALID` | 토큰 검증 실패 (optional auth — 토큰 없으면 401 아님) |
| 404 | `NOT_FOUND` | 존재하지 않거나 isDeleted |
| 429 | `RATE_LIMIT` | rate limit 초과 |

## Source of truth (file map)

The code is the source of truth for file names; `docs/explanation/notices-architecture.md` describes the module. The flows of `src/notices/`:

| Concern | Where |
| --- | --- |
| Tab files (`categories.json`, `sources.json`, `exclude-reasons.json`), loaded and checked at import | `notices.config.ts`, `notices.schema.ts`, `notices.rules.ts` |
| The notice document type | `notices.document.ts` |
| `GET /notices/tabs` | `tabs/` |
| `GET /notices/source/:sourceId`, `GET /notices`: reads, index, projection, cursor, list item, badge | `list/` |
| `GET /notices/:sourceId/:articleNo` | `detail/` |
| The detail's `screen`, rendered from `row/`'s reading of the notice | `screen/`, and the published shape in `notices.wire.ts` |
| `GET /notices/overview`: retrieval, the ai call, citation mapping, cache | `overview/` |
| `GET /notices/proxy/attachment` | `attachment/`, with the outbound policy behind `OUTBOUND_POLICY` (`src/perimeter/perimeter.ports.ts`) |
| `POST /internal/notices/dispatch-pending` and the safety-net poller | `dispatch/` |
| Push topics | `notices.topics.ts` |
| Auth and limiter binding | `notices.module.ts`, the bindings in `src/http/`, the decisions behind `REQUEST_AUTHENTICATOR` and `RATE_LIMIT_POLICY` (`src/perimeter/perimeter.ports.ts`) |

## Design notes

The choices behind the routes above, kept out of the module doc.

- **Envelope.** The notices routes share the common `{ meta, data }` envelope; a second shape would make every client know two.
- **Cursor `(date, _id)`.** `date` is a day (`YYYY-MM-DD`), or a day and a minute (`YYYY-MM-DD HH:mm`) on boards crawled before 2026-08-06, so a tiebreak is required. The cursor carries `date` as stored and `decodeCursor` accepts both shapes; both sides compare it as a string, so the filter and the sort agree across the two shapes; `_id` is unique even inside one crawler batch, never rewritten, and its embedded time orders a day's notices. The cursor wire keeps `{d, c, i}`, and `c` is still emitted and accepted but never read, so a rollback can decode it (ADR 0007). The cursor filter is a two-branch `$or` (earlier date, or the same date and a lower `_id`), and the start-date floor and the cursor sit in separate `$and` clauses so the two `date` bounds never collide.
- **A cursor ignores the filter.** It positions on `(date, _id)` only, so a cursor from another `type` is accepted and may skip rows; the app resets the list when the filter changes.
- **Inclusion projections.** Lists and the detail name every field they read, so a field the crawler adds later is never served by accident.
- **`summaryType` normalization.** An unknown type from the ai is served as `informational`, so a prompt change cannot break an installed app; supporting a new type is a one-line server change.
- **One body path.** The detail serves only `contentMarkdown` (the crawler's `cleanMarkdown`), `null` rather than an empty string when there is none, so the app falls back to `sourceUrl`; conversion quality is the crawler's. The list keeps `hasContent` as a flag.
- **Brief and full summaries.** A list cell gets the one-liner and badge dates; the detail gets the full summary with the ai's arrays passed through.
- **Auth before the limiter, as middleware.** Nest runs middleware before guards, and the limiter may read `req.principal`, so a guard would set it too late ([ADR 0010](../decisions/0010-server-architecture.md), D7).
- **`sources.json` is the server's copy.** It adds the UX metadata (campus, category, availability) the crawler's selector config lacks, so editing it needs no app release.
- **A deleted notice is a 404.** The crawler soft-deletes; lists hide it and the detail answers 404, which clears the app's cache entry.
- **One row per article by scanning past the page.** A read of several sources scans `CLUSTER_SCAN_FACTOR × (limit + 1)` rows after the cursor, reading only `_id`, `dupOf`, `date` and `crawledAt` (`SCAN_PROJECTION`), and keeps a scanned row only when no copy of its article sorts before it. Copies before it in the batch are in hand; for the others it looks up the copies of the scanned articles in the same scope at or before the cursor, which an earlier page served. Page 1 has no cursor and needs no lookup. It scans again after the last row scanned until it holds `limit + 1` rows or the list ends, at most `MAX_SCANS_PER_PAGE` times. A page that runs out of scans is served short, with `hasMore` true and a cursor after its last scanned row, so the next page resumes there. It then reads the `limit` rows it serves in full with one `_id: { $in }` read. Rejected: a `$group` of the whole scope by `dupOf`, which reads every notice of the scope before it can serve page 1.
- **The read indexes are the server's.** The crawler owns the unique `articleNo_1_sourceId_1`; the poller creates `sourceId_1_date_-1__id_-1` and `dupOf_1_sourceId_1__id_1` at boot (three attempts, an error-level log on failure). Every list read and scan is hinted to `sourceId_1_date_-1__id_-1`, and the lookup of a scanned batch's earlier copies to `dupOf_1_sourceId_1__id_1`; the read of the served rows by `_id` takes the `_id` index.

## 관련 문서

- [explanation/notices-architecture.md](../explanation/notices-architecture.md) — 설계 근거·아키텍처
- [decisions/0002](../decisions/0002-notices-read-only-ownership.md) — 읽기전용 소유권
- [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) — FCM dispatch
- [how-to/verify-notices-changes.md](../how-to/verify-notices-changes.md) — 변경 검증 체크리스트
