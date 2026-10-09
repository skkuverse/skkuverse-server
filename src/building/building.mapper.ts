import { floorSortKey, toDisplayNo } from "./building.rules";
import type {
  AccessibilityDetail,
  BarrierFreeSection,
  BuildingDoc,
  BuildingRawDoc,
  ConnectionDoc,
  ElevatorStatus,
  SpaceDoc,
} from "./building.document";
import type { AnyBulkWriteOperation } from "mongodb";
import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import type {
  BilingualText,
  Campus,
  ConnectionResponseItem,
  FloorGroup,
  SpaceGroup,
  SpaceSource,
  SyncedSpace,
  WithCampusLabel,
} from "./building.types";

// Bump this when enrichment logic changes to trigger re-enrichment of all buildings
const ENRICH_VERSION = 1;

// --- Elevator status enum mapping ---

const ELEVATOR_STATUS_MAP: Record<string, ElevatorStatus> = {
  "층에 설 때만 음성 안내": "arrival",
  "층에 설 때, 버튼 누를 때 음성 안내": "arrival_button",
  "음성 안내 없음": "none",
  "운영X": "not_operating",
};

// --- Regex patterns ---

// Matches the start of a BF block in description text.
// Handles: "* 배리어프리", "*배리어프리", "*학생회관\n배리어프리"
const BF_START_RE = /\n\n\*\s*(?:[^\n]*\n)?배리어프리 편의시설 안내/;

// Matches section headers within BF text, with optional label like (A동)
const BF_SECTION_RE =
  /\*\s*(?:[^\n]*\n)?배리어프리 편의시설 안내(?:\(([^)]+)\))?/g;

// --- Section field parsers ---

function parseRamp(
  text: string,
): { available: boolean; note: string | null } | null {
  const m = text.match(/경사로\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1]!.trim();
  const available = !raw.toUpperCase().startsWith("X");
  const noteMatch = raw.match(/\((.+)\)/);
  return { available, note: noteMatch ? noteMatch[1]! : null };
}

function parseToilet(text: string): { raw: string; count: number | null } | null {
  // Handle typo "승장애인" prefix (_id:2 has it on elevator, but be safe)
  const m = text.match(/장애인 화장실\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1]!.trim();
  const countMatch = raw.match(/총\s*(\d+)\s*개/);
  return { raw, count: countMatch ? parseInt(countMatch[1]!, 10) : null };
}

function parseElevator(text: string): {
  raw: string;
  total: number | null;
  accessible: number | null;
} | null {
  // Handle typo "승장애인 표시 승강기" (_id:2)
  const m = text.match(/(?:승)?장애인 표시 승강기\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1]!.trim();
  // "N대 중 M대" pattern (standard)
  const fullMatch = raw.match(/(\d+)\s*대\s*중\s*(\d+)\s*대/);
  if (fullMatch) {
    return {
      raw,
      total: parseInt(fullMatch[1]!, 10),
      accessible: parseInt(fullMatch[2]!, 10),
    };
  }
  // "N대" alone — accessible count only, total unknown
  const singleMatch = raw.match(/(\d+)\s*대/);
  if (singleMatch) {
    return { raw, total: null, accessible: parseInt(singleMatch[1]!, 10) };
  }
  return { raw, total: null, accessible: null };
}

function parseElevatorStatus(text: string): ElevatorStatus | null {
  const m = text.match(/승강기 기능 상태\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1]!.trim();
  // An unknown value is passed through raw, which is why ElevatorStatus
  // includes string.
  return ELEVATOR_STATUS_MAP[raw] || raw;
}

function parseParking(text: string): number | null {
  const m = text.match(/장애인 주차장\s*[:：]\s*(.+)/);
  if (!m) return null;
  const num = m[1]!.trim().match(/(\d+)/);
  return num ? parseInt(num[1]!, 10) : null;
}

function parseSection(text: string): Omit<BarrierFreeSection, "label"> {
  return {
    ramp: parseRamp(text),
    toilet: parseToilet(text),
    elevator: parseElevator(text),
    elevatorStatus: parseElevatorStatus(text),
    parking: parseParking(text),
  };
}

// --- Main parser ---

/**
 * Parse barrier-free accessibility info from building description.
 *   - null: no BF text found
 *   - { cleanDescription, detail: { sections: [...] } }: parsed successfully
 *   - { cleanDescription: original, detail: { sections: [], parseError } }: BF detected but parse failed
 */
function parseBarrierFree(
  descriptionKo: string | null | undefined,
): { cleanDescription: string; detail: AccessibilityDetail } | null {
  if (!descriptionKo) return null;

  // Normalize line endings
  const text = descriptionKo.replace(/\r\n/g, "\n");

  // Find BF block start
  const startMatch = text.match(BF_START_RE);
  if (!startMatch) return null;

  // A successful non-global regex match always has .index (MDN); TS types it
  // number|undefined, so `!` asserts it.
  const matchIndex = startMatch.index!;
  const cleanDescription = text.slice(0, matchIndex).trim();
  const bfText = text.slice(matchIndex);

  // Find all section headers within BF text
  interface BFHeader {
    label: string | null;
    index: number;
    endIndex: number;
  }
  const headers: BFHeader[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(BF_SECTION_RE.source, "g");
  while ((m = re.exec(bfText)) !== null) {
    headers.push({
      label: m[1] || null,
      index: m.index,
      endIndex: m.index + m[0].length,
    });
  }

  if (headers.length === 0) {
    return {
      cleanDescription: text,
      detail: {
        sections: [],
        parseError: "BF block detected but no section headers parsed",
      },
    };
  }

  const sections: BarrierFreeSection[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i]!.endIndex;
    const end =
      i + 1 < headers.length ? headers[i + 1]!.index : bfText.length;
    const sectionText = bfText.slice(start, end);
    sections.push({ label: headers[i]!.label, ...parseSection(sectionText) });
  }

  return { cleanDescription, detail: { sections } };
}

// --- Enrichment pipeline ---

// enrichBuilding returns a $set of dot paths ("accessibility.detail") mixed
// with whole fields, which matches no document type; the driver merges the
// dot paths into the nested document, so the type is a loose record.
export type EnrichmentSetUpdate = Record<string, unknown>;

/**
 * Derive enriched fields from a raw building document.
 * Pure function — no side effects, no DB calls.
 */
function enrichBuilding(rawDoc: BuildingRawDoc): EnrichmentSetUpdate {
  const parsed = parseBarrierFree(rawDoc.description?.ko);

  const descriptionKo = parsed
    ? parsed.cleanDescription
    : rawDoc.description?.ko || "";
  const accessibilityDetail = parsed ? parsed.detail : null;

  return {
    buildNo: rawDoc.buildNo,
    displayNo: toDisplayNo(rawDoc.buildNo, rawDoc.campus),
    type: rawDoc.buildNo ? "building" : "facility",
    campus: rawDoc.campus,
    "name.ko": rawDoc.name?.ko || "",
    "name.en": rawDoc.name?.en || "",
    "description.ko": descriptionKo,
    "description.en": rawDoc.description?.en || "",
    location: rawDoc.location,
    image: rawDoc.image,
    attachments: rawDoc.attachments || [],
    "accessibility.elevator": rawDoc.accessibility?.elevator || false,
    "accessibility.toilet": rawDoc.accessibility?.toilet || false,
    "accessibility.detail": accessibilityDetail,
    enrichVersion: ENRICH_VERSION,
    skkuCreatedAt: rawDoc.skkuCreatedAt,
    skkuUpdatedAt: rawDoc.skkuUpdatedAt,
  };
}

/** A building's spaces grouped by floor, lowest floor first (floorSortKey). */
function groupByFloor(
  spaces: ReadonlyArray<Pick<SpaceDoc, "spaceCd" | "name" | "floor" | "conspaceCd">>,
): FloorGroup[] {
  const floorMap = new Map<string, FloorGroup>();
  for (const s of spaces) {
    const key = s.floor?.ko || "unknown";
    if (!floorMap.has(key)) {
      floorMap.set(key, { floor: s.floor, spaces: [] });
    }
    floorMap.get(key)!.spaces.push({
      spaceCd: s.spaceCd,
      name: s.name,
      conspaceCd: s.conspaceCd,
    });
  }
  return Array.from(floorMap.values()).sort(
    (a, b) => floorSortKey(a.floor?.ko) - floorSortKey(b.floor?.ko),
  );
}

/**
 * Connections as seen from `skkuId`. A connection doc is undirected (a/b), so
 * the side matching `skkuId` is "from" and the other is the target, named from
 * `targets` (the other buildings' docs).
 */
function toConnectionItems(
  skkuId: number,
  docs: readonly ConnectionDoc[],
  targets: ReadonlyArray<Pick<BuildingDoc, "_id" | "buildNo" | "displayNo" | "name">>,
): ConnectionResponseItem[] {
  const buildingMap = new Map(targets.map((b) => [b._id, b]));
  return docs.map((doc) => {
    const isA = doc.a.skkuId === skkuId;
    const self = isA ? doc.a : doc.b;
    const other = isA ? doc.b : doc.a;
    const target = buildingMap.get(other.skkuId);
    return {
      targetSkkuId: other.skkuId,
      targetBuildNo: target?.buildNo || null,
      targetDisplayNo: target?.displayNo || null,
      targetName: target?.name || { ko: "", en: "" },
      fromFloor: self.floor,
      toFloor: other.floor,
    };
  });
}

/**
 * The upsert for one space reported by either listing. Both write the same
 * names; spaceList also owns `conspaceCd`, which a buildInfo insert starts as
 * null. `sources` accumulates which listings reported the space.
 */
function toSpaceUpsert(
  space: SyncedSpace,
  source: SpaceSource,
  syncTime: Date,
): AnyBulkWriteOperation<SpaceDoc> {
  const filter = { spaceCd: space.spaceCd, buildNo: space.buildNo, campus: space.campus };
  const names = { floor: space.floor, name: space.name, buildingName: space.buildingName };
  if (source === "buildInfo") {
    return {
      updateOne: {
        filter,
        update: {
          $set: { ...names, syncedAt: syncTime },
          $addToSet: { sources: source },
          $setOnInsert: { conspaceCd: null },
        },
        upsert: true,
      },
    };
  }
  return {
    updateOne: {
      filter,
      update: {
        $set: { ...names, conspaceCd: space.conspaceCd, syncedAt: syncTime },
        $addToSet: { sources: source },
      },
      upsert: true,
    },
  };
}

// --- Responses ---

function campusLabel(campus: Campus, lang: SupportedLang): string {
  return t(`map.campus.${campus}.label`, lang);
}

function withCampusLabel<T extends { campus: Campus }>(item: T, lang: SupportedLang): WithCampusLabel<T> {
  return { ...item, campusLabel: campusLabel(item.campus, lang) };
}

/** An empty English side shows the Korean one. */
function withEnFallback<T extends Partial<BilingualText> | undefined>(text: T): T {
  if (text && !text.en && text.ko) return { ...text, en: text.ko };
  return text;
}

/**
 * Search rooms grouped by building, in row order so the relevance ranking
 * survives grouping. `skkuIdByBuildNo` joins each group to its building.
 */
function groupSpacesByBuilding(
  spaces: readonly SpaceDoc[],
  skkuIdByBuildNo: ReadonlyMap<string, number>,
  lang: SupportedLang,
): SpaceGroup[] {
  const groups = new Map<string, SpaceGroup>();
  for (const space of spaces) {
    const s = {
      ...space,
      name: withEnFallback(space.name),
      buildingName: withEnFallback(space.buildingName),
      floor: withEnFallback(space.floor),
    };
    let group = groups.get(s.buildNo);
    if (!group) {
      group = {
        skkuId: skkuIdByBuildNo.get(s.buildNo) || null,
        buildNo: s.buildNo,
        displayNo: toDisplayNo(s.buildNo, s.campus),
        campus: s.campus,
        campusLabel: campusLabel(s.campus, lang),
        buildingName: s.buildingName,
        items: [],
      };
      groups.set(s.buildNo, group);
    }
    group.items.push({ spaceCd: s.spaceCd, name: s.name, floor: s.floor });
  }
  return [...groups.values()];
}

/** A building's floors with the English fallback applied to floor and space names. */
function withFloorEnFallback(floors: readonly FloorGroup[]): FloorGroup[] {
  return floors.map((f) => ({
    ...f,
    floor: withEnFallback(f.floor),
    spaces: f.spaces.map((s) => ({ ...s, name: withEnFallback(s.name) })),
  }));
}

export {
  ENRICH_VERSION,
  ELEVATOR_STATUS_MAP,
  enrichBuilding,
  groupByFloor,
  groupSpacesByBuilding,
  parseBarrierFree,
  toConnectionItems,
  toSpaceUpsert,
  withCampusLabel,
  withFloorEnFallback,
};
