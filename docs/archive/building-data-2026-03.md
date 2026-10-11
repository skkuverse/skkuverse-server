---
title: Building Data Survey and Connections Guide (2026-03)
type: reference
status: superseded
owner: zoyoong124@gmail.com
last-updated: 2026-10-11
audience: internal
---

# Building Data Survey and Connections Guide (2026-03)

> Snapshot of the building part of `docs/project-docs.md`, moved here on 2026-10-11: the 2026-03-15 data survey behind the building schema, and the 2026-03-16 connections guide written for the Flutter client. The current explanation is [explanation/building-architecture.md](../explanation/building-architecture.md); trust `src/building/` over anything below.

# Building Connections (건물 연결통로)

> **Date**: 2026-03-16
> **Status**: Server-side complete. Flutter integration pending.
> **Context**: 인사캠 건물 간 연결통로 데이터를 `connections` 컬렉션에 저장하고, `GET /building/:skkuId` 응답에 포함.

---

## 개요

인사캠(hssc) 건물들 사이에는 특정 층끼리 연결통로가 있다 (예: 법학관 2층 ↔ 수선관 3층). 이 데이터는 기존에 웹뷰 `AvailableLines.js`에 하드코딩되어 있었으나, 이제 서버 DB에 저장되고 API로 제공된다.

**핵심 설계:**
- 연결은 **양방향** — DB에는 한 번만 저장하고, 쿼리 시 방향을 정규화해서 반환
- 건물 이름/번호는 connections에 저장하지 않음 — 쿼리 시 `buildings` 컬렉션에서 lookup
- 연결 없는 건물은 `connections: []` (빈 배열)

---

## API 응답

### `GET /building/:skkuId`

기존 `building`, `floors`에 더해 `connections` 배열이 추가되었다.

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "building": { "_id": 12, "name": { "ko": "경영관", "en": "Business School" }, "..." : "..." },
    "floors": [ "..." ],
    "connections": [
      {
        "targetSkkuId": 11,
        "targetBuildNo": "132",
        "targetDisplayNo": "32",
        "targetName": { "ko": "다산경제관", "en": "Dasan Hall of Economics" },
        "fromFloor": { "ko": "4층", "en": "4F" },
        "toFloor": { "ko": "2층", "en": "2F" }
      },
      {
        "targetSkkuId": 11,
        "targetBuildNo": "132",
        "targetDisplayNo": "32",
        "targetName": { "ko": "다산경제관", "en": "Dasan Hall of Economics" },
        "fromFloor": { "ko": "3층", "en": "3F" },
        "toFloor": { "ko": "1층", "en": "1F" }
      }
    ]
  }
}
```

### Connection 객체 필드

| Field | Type | 설명 |
|-------|------|------|
| `targetSkkuId` | `number` | 연결 대상 건물의 skkuId (`_id`) |
| `targetBuildNo` | `string?` | 대상 건물의 buildNo (SKKU 내부 코드) |
| `targetDisplayNo` | `string?` | 대상 건물의 표시 번호 (지도 마커용) |
| `targetName` | `{ ko, en }` | 대상 건물 이름 |
| `fromFloor` | `{ ko, en }` | **현재 건물** 쪽 연결 층 |
| `toFloor` | `{ ko, en }` | **대상 건물** 쪽 연결 층 |

### 방향 정규화

DB에 `법학관(A) 2층 ↔ 수선관(B) 3층` 한 건만 저장되어 있어도:

- `GET /building/3` (법학관) → `fromFloor: 2층, toFloor: 3층, target: 수선관`
- `GET /building/13` (수선관) → `fromFloor: 3층, toFloor: 2층, target: 법학관`

항상 **"내 건물 층 → 상대 건물 층"** 방향으로 반환된다.

---

## 현재 연결 데이터 (11개)

| # | 건물 A | 층 | 건물 B | 층 |
|---|--------|-----|--------|-----|
| 1 | 법학관 | 2층 | 수선관 | 3층 |
| 2 | 수선관 | 1층 | 수선관(별관) | 1층 |
| 3 | 수선관 | 5층 | 수선관(별관) | 5층 |
| 4 | 수선관 | 8층 | 수선관(별관) | 8층 |
| 5 | 퇴계인문관 | 2층 | 다산경제관 | 2층 |
| 6 | 퇴계인문관 | 3층 | 다산경제관 | 3층 |
| 7 | 퇴계인문관 | 4층 | 다산경제관 | 4층 |
| 8 | 퇴계인문관 | 5층 | 다산경제관 | 5층 |
| 9 | 다산경제관 | 2층 | 경영관 | 4층 |
| 10 | 다산경제관 | 1층 | 경영관 | 3층 |
| 11 | 600주년기념관 | 지하2층 | 국제관 | 1층 |

---

## Flutter 활용 가이드

### 1. 모델

```dart
class BuildingConnection {
  final int targetSkkuId;
  final String? targetBuildNo;
  final String? targetDisplayNo;
  final LocalizedString targetName;  // { ko, en }
  final LocalizedString fromFloor;
  final LocalizedString toFloor;
}
```

`GET /building/:skkuId` 응답의 `data.connections` 배열을 파싱하면 된다. 배열이 비어있으면 연결통로 UI를 숨기면 된다.

### 2. 건물 상세 화면에서 연결통로 표시

```
if (connections.isNotEmpty) {
  // "연결통로" 섹션 렌더링
  for (conn in connections) {
    // "2층 → 다산경제관 2층" 같은 형태로 표시
    // fromFloor.ko = 현재 건물의 연결 층
    // toFloor.ko = 대상 건물의 연결 층
    // targetName.ko = 대상 건물 이름
  }
}
```

### 3. 층별 연결 매칭

건물 상세의 `floors` 데이터와 `connections`의 `fromFloor`를 매칭하면 특정 층에 연결통로가 있는지 판단할 수 있다.

```
// 현재 보고 있는 층이 floorInfo.floor.ko == "2층"일 때
// connections에서 fromFloor.ko == "2층"인 항목을 찾으면
// → 그 층에 연결통로가 있다는 뜻
matchingConns = connections.where((c) => c.fromFloor.ko == currentFloor.ko)
```

**주의:** `fromFloor.ko`의 포맷은 서버 spaces 데이터의 `floor.ko`와 동일한 형식을 사용한다 (`"1층"`, `"지하1층"`, `"지하2층"` 등). 문자열 비교로 직접 매칭 가능.

### 4. 연결 건물로 이동

`targetSkkuId`를 사용하면 대상 건물 상세 화면으로 바로 이동할 수 있다.

```
// 연결통로 탭 시 → 대상 건물 상세로 이동
onTap: () => navigateTo('/building/${conn.targetSkkuId}')
```

### 5. 같은 대상 건물에 여러 연결이 있는 경우

다산경제관에서 경영관으로의 연결처럼 같은 `targetSkkuId`에 대해 여러 connection이 올 수 있다 (1층→3층, 2층→4층). `targetSkkuId`로 그룹핑해서 보여줄지, 각각 나열할지는 UI 판단.

---

## DB 스키마 (참고)

### `connections` 컬렉션

```javascript
{
  _id: ObjectId,
  campus: "hssc",
  a: { skkuId: 3, floor: { ko: "2층", en: "2F" } },
  b: { skkuId: 13, floor: { ko: "3층", en: "3F" } }
}
```

- 건물 이름/번호는 저장하지 않음 (buildings 컬렉션에서 join)
- 인덱스: `a.skkuId`, `b.skkuId`

### Seed 스크립트

```bash
node scripts/seed-connections.js
```

- `buildings` 컬렉션에서 `name.ko`로 `skkuId`를 조회해서 연결 문서 생성
- `bulkWrite` upsert — 멱등성 보장 (여러 번 실행해도 안전)

---

# Building Data Investigation Report

> 조사일: 2026-03-15
> 목적: SKKU 캠퍼스맵 데이터를 자체 MongoDB에 저장하기 위한 스키마 설계 사전 검증

## 배경

기존 상태:
- `features/search/` — 매 요청마다 SKKU API 직접 호출 (캐싱 없음)
- `features/map/map-markers.data.js` — HSSC 11개 + NSC 1개 건물 좌표 하드코딩
- `features/map/map-overlays.data.js` — 동일하게 하드코딩, 불완전

목표: SKKU API → 자체 DB 주기적 sync → 서버/앱은 자체 DB에서 읽기

---

## Phase 0: 데이터 교차검증 결과

### 건물 목록 (`buildList`)

| 항목 | 수치 |
|------|------|
| HSSC 건물 | 25 |
| NSC 건물 | 53 |
| **총 항목** | **78** |
| buildNo 있음 (실제 건물) | **59** (HSSC 18 + NSC 41) |
| buildNo null (시설/장소) | **19** (HSSC 7 + NSC 12) |

#### buildNo null 항목 (19개)

건물이 아닌 시설/장소. buildInfo 호출 불가 (층별 정보 없음).

**HSSC (7)**: 정문, 대운동장, 금잔디광장, 옥류정, 유림회관, 농구코트, 후문
**NSC (12)**: 정문, 대운동장, 축구장, 야구장, 테니스장, 북문, 북서문, 모듈러, 킹고광장, 글로벌광장, 공자로, 해오름길

---

### 고유키 검증

#### skkuId (`id` 필드)

| 항목 | 결과 |
|------|------|
| 전체 78개 중 unique | **78개 — 100% unique ✓** |
| 타입 | integer |
| 범위 | 1~88 (연속은 아님) |

**SKKU DB의 PK로 확실. `_id`로 사용 가능.**

#### buildNo

| 항목 | 결과 |
|------|------|
| buildNo 있는 59개 중 unique | **59개 — 100% unique ✓** |
| cross-campus 중복 | **0개** |
| same-campus 중복 | **0개** |
| null buildNo | 19개 |

**실제 건물끼리는 unique. 다만 null 19개 때문에 단독 `_id`로 사용 불가.**

#### spaceCd

| 항목 | 결과 |
|------|------|
| 전체 7,134개 중 unique spaceCd | **6,997개** |
| 중복 spaceCd | **137개** |
| 중복 원인 | 캠퍼스 간 독립 코드 체계 |

중복 예시: `10101`이 600주년기념관(HSSC)과 파워플랜트(NSC) 양쪽에 할당.

**→ spaceCd 단독 `_id` 불가. `{ spaceCd, buildNo, campus }` 복합 unique 인덱스 필요.**

---

### buildInfo vs spaceList 교차검증

> 핵심 질문: spaceList가 buildInfo floorItem의 superset인가?

| 항목 | 수치 |
|------|------|
| buildInfo의 unique space_cd | 7,123 |
| spaceList의 unique spaceCd | 6,997 |
| 양쪽 모두 존재 | 6,748 |
| **buildInfo에만 존재** | **375 ⚠** |
| spaceList에만 존재 | 249 |
| 필드값 차이 (spaceCd 중복 때문) | 14 |

#### 결론: **spaceList는 superset이 아님**

375개 공간이 buildInfo에만 존재. 주로 `buildNo=116` (인터내셔널하우스) 등 특정 건물에 집중.

**→ buildInfo floorItem과 spaceList 양쪽에서 데이터를 수집하여 spaces에 병합 필요.**

#### buildInfo 세부 통계

| 항목 | 수치 |
|------|------|
| buildInfo 성공 호출 | 61/78 (buildNo null 17개 + 추가 미호출 제외) |
| 층별 데이터 있는 건물 | **55** / 61 |
| 층별 데이터 없는 건물 | 6 / 61 |
| 첨부파일 있는 건물 | **59** / 61 |
| 총 floor spaces | 7,319 |

---

### 좌표 비교: 공간 좌표 vs 건물 좌표

> 핵심 질문: spaceList의 공간별 좌표가 건물 좌표와 다른가?

**주의**: buildList는 좌표를 **string**으로, spaceList는 **number**로 반환. 비교 시 `parseFloat()` 필수. (초기 string 비교에서 96% differ로 오진 → 숫자 비교로 수정)

| 항목 | 수치 | 비율 |
|------|------|------|
| 건물 좌표와 동일 | 6,591 | **92.4%** |
| 건물 좌표와 다름 | 281 | 3.9% |
| 건물 참조 없음 | 262 | 3.7% |

#### 다른 좌표가 발생하는 건물 (23개)

차이는 소수점 3~4자리 — 같은 건물 내 동(wing)/관별 위치 차이.

예시:
```
경영관(133): 건물좌표 37.5886, 126.9927
  2층 pc실:         37.5889, 126.9926  (≈30m 차이)
  지하2층 학생식당:  37.5885, 126.9927  (≈10m 차이)
```

#### 결론

- 92%는 건물 좌표와 동일 → 대부분 건물 좌표를 상속
- 3.9%는 건물 내 미세 차이 (동/관 수준, 10~30m)
- **spaces에 좌표 저장은 하되, 앱에서는 건물 좌표 우선 사용 권장**
- buildInfo의 floorItem에는 좌표 없음 (spaceList에만 있음)

---

## 스키마 설계 결정사항

### `_id` 전략

| 컬렉션 | `_id` | 이유 |
|---------|-------|------|
| buildings | `skkuId` (integer) | 78개 전부 unique. buildNo는 null 19개라 불가. |
| spaces | `ObjectId` (자동) | spaceCd 중복 137개. 복합 unique 인덱스로 대체. |

### floors 전략

| 옵션 | 채택 |
|------|------|
| ~~spaceList만 SSOT~~ | ✗ — 375개 누락 |
| ~~buildInfo만 임베딩~~ | ✗ — 좌표 없음, 검색 불편 |
| **양쪽 병합 → spaces 컬렉션** | **✓** |

### 병합 sync 흐름

```
Phase 1: buildList → buildings upsert (78개, null buildNo 포함)
Phase 2: buildInfo → buildings에 attachments 저장
                    + spaces에 floorItem upsert (좌표 없이, source="buildInfo")
Phase 3: spaceList → spaces upsert (좌표 포함, 기존 있으면 merge, source 업데이트)
```

- Phase 2에서 먼저 넣은 space + Phase 3에서 좌표 추가 → `source: "both"`
- Phase 2에만 있는 375개 → `source: "buildInfo"` (좌표 null)
- Phase 3에만 있는 249개 → `source: "spaceList"`

### 삭제 정책

sync 시 SKKU에 없는데 DB에 있는 space → **삭제** (데이터 정확성 유지).

### null buildNo 항목

**저장함.** 정문, 광장, 운동장 등은 지도 마커로 표시할 가치 있음.
buildings에 `type: "building" | "facility"`로 구분.

---

## 미결정 사항

- [ ] sync 주기 (현재 안: 주 1회 + DB 비었으면 즉시)
- [ ] 검색 초성 지원 여부 (이번 스코프 밖)
- [ ] map-overlays.data.js DB 전환 시점
- [ ] extensions 필드 구체적 스키마 (실내지도, 운영시간 등)

---

## 검증 스크립트

- `scripts/verify-campus-data.js` — buildInfo vs spaceList 교차검증
- `scripts/investigate-duplicates.js` — buildNo/skkuId uniqueness 분석
- `scripts/investigate-coords.js` — 공간 좌표 vs 건물 좌표 비교
