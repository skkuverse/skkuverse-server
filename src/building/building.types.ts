/** The SKKU campusMap.do payloads, the campus literal and the response shapes. */

// --- 외부 SKKU campusMap.do 응답 (3 modes: buildList / buildInfo / spaceList) ---
//
// "사용 필드만 + index sig" 패턴 (PR2 src/bus/types.ts:55-64 JongroListItem
// 답습). 실제 응답은 25+ 필드; 우리가 읽는 것만 typed.
//
// SKKU 응답의 typo는 그대로 type에 보존 (longtitude, spcaeNm, spcae_nm, spcae_nm_eng).
// 만약 SKKU가 typo를 silent fix하면 building.sync가 빈 string으로 떨어지므로 사전
// 알림 효과 — type 단계에서도 사실관계를 명시한다.

export interface SkkuBuildListItem {
  id: string;                    // 숫자 문자열, parseInt로 사용 (building.sync.ts)
  buildNo: string | null;        // facility는 null/없음
  buildNm?: string;
  buildNmEng?: string;
  krText?: string;
  enText?: string;
  latitude?: string;             // parseFloat로 변환 (building.sync.ts)
  longtitude?: string;           // SKKU typo, parseFloat로 변환 (building.sync.ts)
  filePath?: string;
  encodeNm?: string;
  handicappedElevatorYn?: string; // "Y" 비교만 (building.sync.ts)
  handicappedToiletYn?: string;
  createDt?: string;
  updateDt?: string;
  [k: string]: unknown;
}

export interface SkkuBuildListResponse {
  buildItems?: SkkuBuildListItem[];
  [k: string]: unknown;
}

export interface SkkuBuildInfoAttachment {
  id: string;
  file_path?: string;
  encode_nm?: string;
  file_nm?: string;
  image_alt?: string;
  [k: string]: unknown;
}

export interface SkkuBuildInfoFloor {
  space_cd: string;
  floor_nm?: string;
  floor_nm_eng?: string;
  spcae_nm?: string;             // SKKU typo (spcae instead of space)
  // "undefined" 문자열로 오는 경우 있음 (building.sync.ts 명시 처리).
  spcae_nm_eng?: string;
  [k: string]: unknown;
}

export interface SkkuBuildInfoResponse {
  attachItem?: SkkuBuildInfoAttachment[];
  floorItem?: SkkuBuildInfoFloor[];
  [k: string]: unknown;
}

export interface SkkuSpaceListItem {
  spaceCd: string;
  buildNo: string;
  campus: string;
  floorNm?: string;
  floorNmEng?: string;
  spcaeNm?: string;              // SKKU typo
  // "undefined" 문자열로 오는 경우 있음 (building.sync.ts 명시 처리).
  spcaeNmEng?: string;
  buildNm?: string;
  buildNmEng?: string;
  conspaceCd?: string | null;
  [k: string]: unknown;
}

export interface SkkuSpaceListResponse {
  items?: SkkuSpaceListItem[];
  [k: string]: unknown;
}

// --- Campus literal ---
// hssc = 인사캠, nsc = 자과캠. campusMap.do는 "1"|"2" 코드를 받지만 내부는 이
// 이름 union으로 통일.
export type Campus = "hssc" | "nsc";

// 양방향 lookup 후 정규화된 응답 shape (building.data.ts getConnectionsForBuilding).
export interface ConnectionResponseItem {
  targetSkkuId: number;
  targetBuildNo: string | null;
  targetDisplayNo: string | null;
  targetName: { ko: string; en: string };
  fromFloor: { ko: string; en: string };
  toFloor: { ko: string; en: string };
}

// --- Routes helper shapes ---
// getFloorsByBuildNo 반환 + route fillEnFallback 후의 shape.
export interface FloorSpace {
  spaceCd: string;
  name: { ko: string; en: string };
  conspaceCd?: string | null;
}
export interface FloorGroup {
  floor: { ko: string; en: string };
  spaces: FloorSpace[];
}
