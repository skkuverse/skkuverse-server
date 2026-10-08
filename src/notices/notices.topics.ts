/**
 * (An operations detail is left out of the public history.)
 *
 *
 */
import { categories } from "./tabConfig";
import type { CategoryConfig } from "./types";

// (An operations detail is left out of the public history.)
//
//
const TOPIC_CAP = 30;

// Minimal shape — buildTopics only reads sourceId. Compatible with the
// fully-typed NoticeDoc as well as test fixtures that pass arbitrary
// partial docs.
interface NoticeForTopic {
  sourceId?: string;
}

function buildTopics(noticeDoc: NoticeForTopic | null | undefined): string[] {
  const sourceId = noticeDoc && noticeDoc.sourceId;
  if (!sourceId || typeof sourceId !== "string") return [];

  const out = new Set<string>();
  // Redundant cast: tabConfig.ts already exports `categories` typed.
  for (const cat of categories as ReadonlyArray<CategoryConfig>) {
    if (cat.tabMode === "fixed") {
      if (cat.sourceId === sourceId) {
        out.add(`category:${cat.id}`);
      }
    } else if (cat.tabMode === "picker") {
      if (Array.isArray(cat.sourceIds) && cat.sourceIds.includes(sourceId)) {
        out.add(`${cat.id}:${sourceId}`);
      }
    }
    if (out.size >= TOPIC_CAP) break;
  }
  return Array.from(out);
}

export { buildTopics, TOPIC_CAP };
