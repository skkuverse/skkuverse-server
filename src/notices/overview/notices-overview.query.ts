import type { Document } from "mongodb";
import { RETRIEVAL_LIMIT } from "./notices-overview.constants";
import type { OverviewPipelineInput } from "./notices-overview.types";

const TEXT_PATHS = ["title", "summaryOneLiner", "summary", "contentText"];

export const CANDIDATE_PROJECTION = {
  _id: 1,
  sourceId: 1,
  articleNo: 1,
  title: 1,
  date: 1,
  department: 1,
  category: 1,
  summary: 1,
  summaryOneLiner: 1,
  summaryType: 1,
  summaryPeriods: 1,
  summaryLocations: 1,
  summaryDetails: 1,
  contentText: 1,
  contentHash: 1,
  summaryContentHash: 1,
  summaryApplication: 1,
} as const;

/**
 * QUIRK(atlas): one $rankFusion over the lexical index notices_search (nori) and the autoEmbed vector index
 * notices_vector, which supplies its own embedding model. The scope is applied inside each sub-pipeline, before
 * fusion, so an out-of-scope notice cannot take a rank; `mustNot` because a document may lack `isDeleted`.
 */
export function toOverviewPipeline({ q: searchText, sourceIds, serviceStartDate }: OverviewPipelineInput): Document[] {
  const inScopeDate = { $match: { date: { $gte: serviceStartDate } } };
  const text = {
    $search: {
      index: "notices_search",
      compound: {
        must: [{ text: { query: searchText, path: TEXT_PATHS } }],
        filter: [{ in: { path: "sourceId", value: [...sourceIds] } }],
        mustNot: [{ equals: { path: "isDeleted", value: true } }],
      },
    },
  };
  // EVIDENCE: `exact: true` because the embedded corpus is about 2k documents (2026-10-06).
  const vector = {
    $vectorSearch: {
      index: "notices_vector",
      path: "embeddingInput",
      query: { text: searchText },
      filter: { sourceId: { $in: [...sourceIds] }, isDeleted: { $ne: true } },
      exact: true,
      limit: RETRIEVAL_LIMIT,
    },
  };
  return [
    { $rankFusion: { input: { pipelines: { text: [text, inScopeDate, { $limit: RETRIEVAL_LIMIT }], vector: [vector, inScopeDate] } } } },
    { $limit: RETRIEVAL_LIMIT },
    { $project: CANDIDATE_PROJECTION },
  ];
}
