import { hasBuildNo, toDisplayNo } from "../building.rules";
import type { AccessibilityDetail, BarrierFreeSection, BuildingRawDoc, ElevatorStatus } from "../building.document";
import type { EnrichedBuilding } from "./building-sync.types";

// Bump this when enrichment logic changes to trigger re-enrichment of all buildings
const ENRICH_VERSION = 1;

const ELEVATOR_STATUS_MAP: Readonly<Record<string, ElevatorStatus>> = {
  "층에 설 때만 음성 안내": "arrival",
  "층에 설 때, 버튼 누를 때 음성 안내": "arrival_button",
  "음성 안내 없음": "none",
  "운영X": "not_operating",
};

// Matches the start of a BF block in description text.
// Handles: "* 배리어프리", "*배리어프리", "*학생회관\n배리어프리"
const BARRIER_FREE_START_RE = /\n\n\*\s*(?:[^\n]*\n)?배리어프리 편의시설 안내/;

// Matches section headers within BF text, with optional label like (A동)
const BARRIER_FREE_SECTION_RE =
  /\*\s*(?:[^\n]*\n)?배리어프리 편의시설 안내(?:\(([^)]+)\))?/g;

function parseRamp(
  text: string,
): { available: boolean; note: string | null } | null {
  const match = text.match(/경사로\s*[:：]\s*(.+)/);
  if (!match) return null;
  const raw = match[1]!.trim();
  const available = !raw.toUpperCase().startsWith("X");
  const noteMatch = raw.match(/\((.+)\)/);
  return { available, note: noteMatch ? noteMatch[1]! : null };
}

function parseToilet(text: string): { raw: string; count: number | null } | null {
  // Handle typo "승장애인" prefix (_id:2 has it on elevator, but be safe)
  const match = text.match(/장애인 화장실\s*[:：]\s*(.+)/);
  if (!match) return null;
  const raw = match[1]!.trim();
  const countMatch = raw.match(/총\s*(\d+)\s*개/);
  return { raw, count: countMatch ? parseInt(countMatch[1]!, 10) : null };
}

function parseElevator(text: string): {
  raw: string;
  total: number | null;
  accessible: number | null;
} | null {
  // Handle typo "승장애인 표시 승강기" (_id:2)
  const match = text.match(/(?:승)?장애인 표시 승강기\s*[:：]\s*(.+)/);
  if (!match) return null;
  const raw = match[1]!.trim();
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
  const match = text.match(/승강기 기능 상태\s*[:：]\s*(.+)/);
  if (!match) return null;
  const raw = match[1]!.trim();
  // An unknown value is passed through raw, which is why ElevatorStatus
  // includes string.
  return ELEVATOR_STATUS_MAP[raw] || raw;
}

function parseParking(text: string): number | null {
  const match = text.match(/장애인 주차장\s*[:：]\s*(.+)/);
  if (!match) return null;
  const countMatch = match[1]!.trim().match(/(\d+)/);
  return countMatch ? parseInt(countMatch[1]!, 10) : null;
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
  const startMatch = text.match(BARRIER_FREE_START_RE);
  if (!startMatch) return null;

  // A successful non-global regex match always has .index (MDN); TS types it
  // number|undefined, so `!` asserts it.
  const matchIndex = startMatch.index!;
  const cleanDescription = text.slice(0, matchIndex).trim();
  const barrierFreeText = text.slice(matchIndex);

  // Find all section headers within BF text
  interface BarrierFreeHeader {
    label: string | null;
    index: number;
    endIndex: number;
  }
  const headers: BarrierFreeHeader[] = [];
  let headerMatch: RegExpExecArray | null;
  const sectionPattern = new RegExp(BARRIER_FREE_SECTION_RE.source, "g");
  while ((headerMatch = sectionPattern.exec(barrierFreeText)) !== null) {
    headers.push({
      label: headerMatch[1] || null,
      index: headerMatch.index,
      endIndex: headerMatch.index + headerMatch[0].length,
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
      i + 1 < headers.length ? headers[i + 1]!.index : barrierFreeText.length;
    const sectionText = barrierFreeText.slice(start, end);
    sections.push({ label: headers[i]!.label, ...parseSection(sectionText) });
  }

  return { cleanDescription, detail: { sections } };
}

/** The fields derived from a raw building: display number, type, barrier-free detail. */
function enrichBuilding(rawDoc: BuildingRawDoc): EnrichedBuilding {
  const parsed = parseBarrierFree(rawDoc.description?.ko);

  const descriptionKo = parsed
    ? parsed.cleanDescription
    : rawDoc.description?.ko || "";
  const accessibilityDetail = parsed ? parsed.detail : null;

  return {
    buildNo: rawDoc.buildNo,
    displayNo: toDisplayNo(rawDoc.buildNo, rawDoc.campus),
    type: hasBuildNo(rawDoc) ? "building" : "facility",
    campus: rawDoc.campus,
    name: { ko: rawDoc.name?.ko || "", en: rawDoc.name?.en || "" },
    description: { ko: descriptionKo, en: rawDoc.description?.en || "" },
    location: rawDoc.location,
    image: rawDoc.image,
    attachments: rawDoc.attachments || [],
    accessibility: {
      elevator: rawDoc.accessibility?.elevator || false,
      toilet: rawDoc.accessibility?.toilet || false,
      detail: accessibilityDetail,
    },
    enrichVersion: ENRICH_VERSION,
    skkuCreatedAt: rawDoc.skkuCreatedAt,
    skkuUpdatedAt: rawDoc.skkuUpdatedAt,
  };
}


export { ENRICH_VERSION, enrichBuilding };
