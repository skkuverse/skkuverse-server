import { Injectable } from "@nestjs/common";
import type { Document } from "mongodb";
import config from "../../infra/config";
import { getNoticesCollection } from "../notices.data";
import type { OverviewCandidate } from "./overview.contract";

/**
 * Hybrid retrieval for the search overview: one $rankFusion over the Atlas
 * lexical index (notices_search, nori) and the autoEmbed vector index
 * (notices_vector). The pipeline shape was run read-only against prod on
 * 2026-10-06 (design D2).
 *
 * Scope matches the search list exactly — requested sources, not deleted, on
 * or after the service start date — and is applied inside each sub-pipeline,
 * before fusion, so an out-of-scope notice cannot take a rank position.
 *
 * $vectorSearch passes the query text and no `model`: the index definition
 * supplies the embedding model, so this server never names one (crawler
 * ADR-007). `exact: true` because the embedded corpus is ~2k documents.
 */

/** Ranked results fetched before dedup; leaves room for cross-post families. */
export const RETRIEVAL_LIMIT = 20;

/**
 * Server-side cap. Tighter than HOT_READ_MAX_TIME_MS because the ai call that
 * follows needs 22 s of the 24 s response budget (design D9). Includes Atlas's
 * query-time embedding.
 */
export const RETRIEVAL_MAX_TIME_MS = 1_500;

const TEXT_PATHS = ["title", "summaryOneLiner", "summary", "contentText"];

const CANDIDATE_PROJECTION = Object.freeze({
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
});

export interface OverviewPipelineInput {
  q: string;
  sourceIds: readonly string[];
  serviceStartDate: string;
}

export function buildOverviewPipeline({
  q,
  sourceIds,
  serviceStartDate,
}: OverviewPipelineInput): Document[] {
  const inScopeDate = { $match: { date: { $gte: serviceStartDate } } };
  return [
    {
      $rankFusion: {
        input: {
          pipelines: {
            text: [
              {
                $search: {
                  index: "notices_search",
                  compound: {
                    must: [{ text: { query: q, path: TEXT_PATHS } }],
                    filter: [{ in: { path: "sourceId", value: [...sourceIds] } }],
                    // mustNot rather than equals:false — documents may lack the field.
                    mustNot: [{ equals: { path: "isDeleted", value: true } }],
                  },
                },
              },
              inScopeDate,
              { $limit: RETRIEVAL_LIMIT },
            ],
            vector: [
              {
                $vectorSearch: {
                  index: "notices_vector",
                  path: "embeddingInput",
                  query: { text: q },
                  filter: {
                    sourceId: { $in: [...sourceIds] },
                    isDeleted: { $ne: true },
                  },
                  exact: true,
                  limit: RETRIEVAL_LIMIT,
                },
              },
              inScopeDate,
            ],
          },
        },
      },
    },
    { $limit: RETRIEVAL_LIMIT },
    { $project: CANDIDATE_PROJECTION },
  ];
}

@Injectable()
export class OverviewRetriever {
  /** Relevance-ranked in-scope notices, best first. Rejects on any DB error. */
  async retrieve(
    q: string,
    sourceIds: readonly string[],
  ): Promise<OverviewCandidate[]> {
    const pipeline = buildOverviewPipeline({
      q,
      sourceIds,
      serviceStartDate: config.notices.serviceStartDate!,
    });
    return getNoticesCollection()
      .aggregate<OverviewCandidate>(pipeline, {
        maxTimeMS: RETRIEVAL_MAX_TIME_MS,
      })
      .toArray();
  }
}
