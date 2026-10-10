import { hasBuildNo, toDisplayNo } from "../building.rules";
import type { AccessibilityDetail, BarrierFreeSection, BuildingRawDoc, ElevatorStatus } from "../building.document";
import type { EnrichedBuilding } from "./building-sync.types";

// Bump it when enrichBuilding changes: the next sync then re-enriches every building.
const ENRICH_VERSION = 1;

const ELEVATOR_STATUS_BY_TEXT: Readonly<Record<string, ElevatorStatus>> = {
  "층에 설 때만 음성 안내": "arrival",
  "층에 설 때, 버튼 누를 때 음성 안내": "arrival_button",
  "음성 안내 없음": "none",
  "운영X": "not_operating",
};

// SKKU starts the block as "* 배리어프리", "*배리어프리" or "*학생회관\n배리어프리".
const BARRIER_FREE_START_RE = /\n\n\*\s*(?:[^\n]*\n)?배리어프리 편의시설 안내/;

// A section header, with an optional wing label such as (A동).
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
  // Unanchored, so SKKU's stray "승" prefix (building 2's elevator line) still matches.
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
  // SKKU's building 2 writes "승장애인 표시 승강기".
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
  return ELEVATOR_STATUS_BY_TEXT[raw] || raw;
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

interface BarrierFreeHeader {
  label: string | null;
  index: number;
  endIndex: number;
}

function findSectionHeaders(barrierFreeText: string): BarrierFreeHeader[] {
  return [...barrierFreeText.matchAll(BARRIER_FREE_SECTION_RE)].map((headerMatch) => ({
    label: headerMatch[1] || null,
    index: headerMatch.index,
    endIndex: headerMatch.index + headerMatch[0].length,
  }));
}

function toSections(barrierFreeText: string, headers: readonly BarrierFreeHeader[]): BarrierFreeSection[] {
  return headers.map((header, i) => {
    const end = headers[i + 1]?.index ?? barrierFreeText.length;
    return { label: header.label, ...parseSection(barrierFreeText.slice(header.endIndex, end)) };
  });
}

/** null when the description has no barrier-free block. */
function parseBarrierFree(descriptionKo: string): { cleanDescription: string; detail: AccessibilityDetail } | null {
  const text = descriptionKo.replace(/\r\n/g, "\n");

  const startMatch = text.match(BARRIER_FREE_START_RE);
  if (!startMatch) return null;

  // A successful non-global match always has .index; TypeScript types it optional.
  const matchIndex = startMatch.index!;
  const cleanDescription = text.slice(0, matchIndex).trim();
  const barrierFreeText = text.slice(matchIndex);

  const headers = findSectionHeaders(barrierFreeText);
  if (headers.length === 0) {
    return {
      cleanDescription: text,
      detail: {
        sections: [],
        parseError: "BF block detected but no section headers parsed",
      },
    };
  }

  return { cleanDescription, detail: { sections: toSections(barrierFreeText, headers) } };
}

function enrichBuilding(rawDoc: BuildingRawDoc): EnrichedBuilding {
  const parsed = parseBarrierFree(rawDoc.description.ko);

  return {
    buildNo: rawDoc.buildNo,
    displayNo: toDisplayNo(rawDoc.buildNo, rawDoc.campus),
    type: hasBuildNo(rawDoc) ? "building" : "facility",
    campus: rawDoc.campus,
    name: { ko: rawDoc.name.ko, en: rawDoc.name.en },
    description: { ko: parsed ? parsed.cleanDescription : rawDoc.description.ko, en: rawDoc.description.en },
    location: rawDoc.location,
    image: rawDoc.image,
    attachments: rawDoc.attachments || [],
    accessibility: {
      elevator: rawDoc.accessibility.elevator,
      toilet: rawDoc.accessibility.toilet,
      detail: parsed ? parsed.detail : null,
    },
    enrichVersion: ENRICH_VERSION,
    skkuCreatedAt: rawDoc.skkuCreatedAt,
    skkuUpdatedAt: rawDoc.skkuUpdatedAt,
  };
}

export { ENRICH_VERSION, enrichBuilding };
