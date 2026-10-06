/**
 * Turns the ai's positional citations into notices the app can open.
 * Pure / no I/O.
 *
 * The ai cites by position in the candidate list the server sent (1..K). Those
 * numbers are internal to this request, so the app gets its own numbering:
 * 1..M in the order the answer first cites a notice, reading the lead and then
 * the points. A chip labelled [1] is then always the first source the reader
 * meets.
 *
 * Cite numbers become navigation links, so they are checked here even though
 * the ai validates them too: a number outside 1..K is dropped, a sentence left
 * with no valid number is dropped, and an answer left with no sentence at all
 * is a contract violation.
 */
import type {
  AiOverviewResponse,
  AiOverviewSentence,
  OverviewCandidate,
  OverviewDto,
  OverviewSentence,
  OverviewSource,
} from "./overview.contract";

/** Upper bound on bullets, matching the ai contract. */
const MAX_POINTS = 5;

export type MapOverviewResult =
  | { ok: true; overview: OverviewDto }
  | { ok: false; reason: string };

export function mapOverview(
  candidates: readonly OverviewCandidate[],
  ai: AiOverviewResponse,
  generatedAt: Date,
): MapOverviewResult {
  const k = candidates.length;
  // ai position → app number, in first-cited order (Map keeps insertion order).
  const appNumberOf = new Map<number, number>();

  const remap = (sentence: AiOverviewSentence): OverviewSentence | null => {
    const cites: number[] = [];
    for (const position of sentence.cites) {
      if (!Number.isInteger(position) || position < 1 || position > k) continue;
      let appNumber = appNumberOf.get(position);
      if (appNumber === undefined) {
        appNumber = appNumberOf.size + 1;
        appNumberOf.set(position, appNumber);
      }
      if (!cites.includes(appNumber)) cites.push(appNumber);
    }
    return cites.length > 0 ? { text: sentence.text, cites } : null;
  };

  const lead = ai.lead ? remap(ai.lead) : null;
  // Stop at the cap before remapping, so a bullet that is not shown cannot
  // number a source that no shown sentence cites.
  const points: OverviewSentence[] = [];
  for (const point of ai.points) {
    if (points.length >= MAX_POINTS) break;
    const mapped = remap(point);
    if (mapped) points.push(mapped);
  }

  if (!lead && points.length === 0) {
    return { ok: false, reason: "no_cited_sentences" };
  }

  const sources: OverviewSource[] = [];
  for (const [position, appNumber] of appNumberOf) {
    const candidate = candidates[position - 1]!;
    const aiSource = ai.sources.find((s) => s.n === position);
    sources.push({
      n: appNumber,
      sourceId: candidate.sourceId,
      articleNo: candidate.articleNo,
      title: candidate.title,
      date: candidate.date,
      contentMissing: aiSource?.contentMissing === true,
    });
  }

  return {
    ok: true,
    overview: {
      lead,
      points,
      sources,
      lang: ai.lang,
      generatedAt: generatedAt.toISOString(),
    },
  };
}
