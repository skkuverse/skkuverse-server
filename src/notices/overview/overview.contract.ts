/**
 * Shapes on both sides of GET /notices/overview, plus the pure parser for the
 * skkuverse-ai response.
 *
 * The server→ai contract is owned by skkuverse-ai
 * (docs/notice-overview-api.md, openspec/changes/add-notice-overview). This
 * file mirrors only what the server reads and sends; it does not redefine the
 * contract. Pure / no I/O.
 */
import type { NoticeDoc } from "../types";

/** What the overview reads from a notice: the ai's inputs plus the app's link target. */
export type OverviewCandidate = Pick<
  NoticeDoc,
  | "_id"
  | "sourceId"
  | "articleNo"
  | "title"
  | "date"
  | "department"
  | "category"
  | "summary"
  | "summaryOneLiner"
  | "summaryType"
  | "summaryPeriods"
  | "summaryLocations"
  | "summaryDetails"
  | "contentText"
  | "contentHash"
  | "summaryContentHash"
  | "summaryApplication"
>;

// --- skkuverse-ai request ---

/** One element of `notices`. DB field names, as the ai contract asks. */
export interface AiOverviewNotice {
  title: string;
  department: string | null;
  date: string | null;
  category: string | null;
  summary: string | null;
  summaryOneLiner: string | null;
  summaryType: string | null;
  summaryPeriods: unknown;
  summaryLocations: unknown;
  summaryDetails: unknown;
  contentText: string | null;
  contentHash: string | null;
  summaryContentHash: string | null;
  /** v2 application windows; the ai writes the notice's "신청: …" status line from it. */
  summaryApplication: unknown;
}

export interface AiOverviewRequest {
  query: string;
  /** Array position is the citation number: notices[0] is 1. */
  notices: AiOverviewNotice[];
  /** Reference time for deadline status, ISO 8601. */
  now: string;
  lang: string;
}

/**
 * The ai input for one candidate. sourceId / articleNo / _id stay on the
 * server: the ai cites by position, and the server maps positions back.
 * contentText goes untrimmed — the ai applies its own per-notice cap.
 */
export function toAiNotice(c: OverviewCandidate): AiOverviewNotice {
  return {
    title: c.title,
    department: c.department ?? null,
    date: c.date ?? null,
    category: c.category ?? null,
    summary: c.summary ?? null,
    summaryOneLiner: c.summaryOneLiner ?? null,
    summaryType: c.summaryType ?? null,
    summaryPeriods: c.summaryPeriods ?? null,
    summaryLocations: c.summaryLocations ?? null,
    summaryDetails: c.summaryDetails ?? null,
    contentText: c.contentText ?? null,
    contentHash: c.contentHash ?? null,
    summaryContentHash: c.summaryContentHash ?? null,
    summaryApplication: c.summaryApplication ?? null,
  };
}

// --- skkuverse-ai 200 response ---

export interface AiOverviewSentence {
  text: string;
  cites: number[];
}

export interface AiOverviewSource {
  n: number;
  contentMissing: boolean;
}

export type AiOverviewStatus = "answered" | "partial" | "no_answer";

export interface AiOverviewResponse {
  status: AiOverviewStatus;
  lead: AiOverviewSentence | null;
  points: AiOverviewSentence[];
  sources: AiOverviewSource[];
  lang: "ko" | "en";
  model: string;
}

const STATUSES: ReadonlySet<string> = new Set(["answered", "partial", "no_answer"]);
const LANGS: ReadonlySet<string> = new Set(["ko", "en"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSentence(v: unknown): AiOverviewSentence | null {
  if (!isRecord(v)) return null;
  const { text, cites } = v;
  if (typeof text !== "string" || text.trim() === "") return null;
  if (!Array.isArray(cites) || !cites.every((c) => typeof c === "number")) {
    return null;
  }
  return { text, cites: cites as number[] };
}

/**
 * Returns the response when it has the contract's shape, else null.
 *
 * Checks shape only. Whether cite numbers fall inside the candidate range is
 * the citation mapper's job, because only it knows how many candidates were
 * sent.
 */
export function parseAiOverviewResponse(body: unknown): AiOverviewResponse | null {
  if (!isRecord(body)) return null;
  const { status, lead, points, sources, lang, model } = body;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  if (typeof lang !== "string" || !LANGS.has(lang)) return null;
  if (typeof model !== "string") return null;
  if (!Array.isArray(points) || !Array.isArray(sources)) return null;

  let parsedLead: AiOverviewSentence | null = null;
  if (lead !== null) {
    parsedLead = parseSentence(lead);
    if (!parsedLead) return null;
  }

  const parsedPoints: AiOverviewSentence[] = [];
  for (const p of points) {
    const sentence = parseSentence(p);
    if (!sentence) return null;
    parsedPoints.push(sentence);
  }

  const parsedSources: AiOverviewSource[] = [];
  for (const s of sources) {
    if (!isRecord(s) || typeof s.n !== "number") return null;
    parsedSources.push({ n: s.n, contentMissing: s.contentMissing === true });
  }

  return {
    status: status as AiOverviewStatus,
    lead: parsedLead,
    points: parsedPoints,
    sources: parsedSources,
    lang: lang as "ko" | "en",
    model,
  };
}

// --- app-facing DTO ---

export interface OverviewSentence {
  text: string;
  cites: number[];
}

export interface OverviewSource {
  n: number;
  sourceId: string;
  articleNo: NoticeDoc["articleNo"];
  title: string;
  date: string;
  contentMissing: boolean;
}

export interface OverviewDto {
  lead: OverviewSentence | null;
  points: OverviewSentence[];
  sources: OverviewSource[];
  lang: "ko" | "en";
  generatedAt: string;
}

/** Why `data.overview` is null. */
export type OverviewReason = "no_results" | "no_answer" | "unavailable";
