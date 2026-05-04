/**
 * (An operations detail is left out of the public history.)
 *
 *
 */

const { categories } = require("./tabConfig");

const TOPIC_CAP = 10; // sendNotification function rejects > 10.

function buildTopics(noticeDoc) {
  const sourceId = noticeDoc && noticeDoc.sourceId;
  if (!sourceId || typeof sourceId !== "string") return [];

  const out = new Set();
  for (const cat of categories) {
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

module.exports = { buildTopics, TOPIC_CAP };
