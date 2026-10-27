import { noticesConfig } from "./notices.config";
import type { CategoryConfig } from "./notices.types";

// WHY: Firestore's `array-contains-any` limit; the push Cloud Function queries subscribers with it and rejects more.
const TOPIC_CAP = 30;

interface NoticeForTopic {
  sourceId?: string;
}

// WHY: each string must equal a topic the push Cloud Function derives from a device's preferences,
// or no device matches.
function topicOf(category: CategoryConfig, sourceId: string): string | undefined {
  if (category.tabMode === "fixed") return category.sourceId === sourceId ? `category:${category.id}` : undefined;
  if (category.tabMode === "picker" && Array.isArray(category.sourceIds) && category.sourceIds.includes(sourceId)) {
    return `${category.id}:${sourceId}`;
  }
  return undefined;
}

function buildTopics(noticeDoc: NoticeForTopic | null | undefined): string[] {
  const sourceId = noticeDoc?.sourceId;
  if (!sourceId || typeof sourceId !== "string") return [];

  const out = new Set<string>();
  for (const category of noticesConfig.categories) {
    const topic = topicOf(category, sourceId);
    if (topic !== undefined) out.add(topic);
    if (out.size >= TOPIC_CAP) break;
  }
  return Array.from(out);
}

export { buildTopics, TOPIC_CAP };
