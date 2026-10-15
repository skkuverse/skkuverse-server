import { MAX_POINTS } from "./notices-overview.constants";
import type { AiOverviewResponse, AiOverviewSentence } from "./notices-overview.schema";
import type { OverviewCandidate } from "./notices-overview.document";
import type { AiOverviewNotice, MapOverviewResult } from "./notices-overview.types";
import type { OverviewSentence, OverviewSource } from "./notices-overview.wire";

const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

/** WHY: sourceId, articleNo and _id stay here; contentText goes untrimmed, the ai caps it per notice. */
export function toAiNotice(candidate: OverviewCandidate): AiOverviewNotice {
  return {
    title: candidate.title,
    department: orNull(candidate.department),
    date: orNull(candidate.date),
    category: orNull(candidate.category),
    summary: orNull(candidate.summary),
    summaryOneLiner: orNull(candidate.summaryOneLiner),
    summaryType: orNull(candidate.summaryType),
    summaryPeriods: orNull(candidate.summaryPeriods),
    summaryLocations: orNull(candidate.summaryLocations),
    summaryDetails: orNull(candidate.summaryDetails),
    contentText: orNull(candidate.contentText),
    contentHash: orNull(candidate.contentHash),
    summaryContentHash: orNull(candidate.summaryContentHash),
    summaryApplication: orNull(candidate.summaryApplication),
  };
}

function toSources(candidates: readonly OverviewCandidate[], ai: AiOverviewResponse, appNumberOf: Map<number, number>): OverviewSource[] {
  return [...appNumberOf].flatMap(([position, appNumber]) => {
    const candidate = candidates[position - 1];
    if (!candidate) return [];
    const aiSource = ai.sources.find((s) => s.n === position);
    const { sourceId, articleNo, title, date } = candidate;
    return [{ n: appNumber, sourceId, articleNo, title, date, contentMissing: aiSource?.contentMissing === true }];
  });
}

/**
 * WHY: the ai cites by position (1..K) in this request's candidates; the app numbers sources 1..M in first-cited
 * order (lead, then points), so chip [1] is the first source a reader meets. A cite outside 1..K is dropped, a
 * sentence left with none is dropped, and an answer left with no sentence is a contract violation.
 */
export function mapOverview(candidates: readonly OverviewCandidate[], ai: AiOverviewResponse, generatedAt: Date): MapOverviewResult {
  const appNumberOf = new Map<number, number>();
  const remap = (sentence: AiOverviewSentence): OverviewSentence | null => {
    const cites: number[] = [];
    for (const position of sentence.cites.filter((p) => Number.isInteger(p) && p >= 1 && p <= candidates.length)) {
      const appNumber = appNumberOf.get(position) ?? appNumberOf.size + 1;
      appNumberOf.set(position, appNumber);
      if (!cites.includes(appNumber)) cites.push(appNumber);
    }
    return cites.length > 0 ? { text: sentence.text, cites } : null;
  };
  const lead = ai.lead ? remap(ai.lead) : null;
  const points: OverviewSentence[] = [];
  for (const point of ai.points) {
    if (points.length >= MAX_POINTS) break;
    const mapped = remap(point);
    if (mapped) points.push(mapped);
  }
  if (!lead && points.length === 0) return { ok: false, reason: "no_cited_sentences" };
  const sources = toSources(candidates, ai, appNumberOf);
  return { ok: true, overview: { lead, points, sources, lang: ai.lang, generatedAt: generatedAt.toISOString() } };
}
