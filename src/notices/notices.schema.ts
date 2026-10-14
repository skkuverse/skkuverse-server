import { z } from "zod";
import type { CategoryConfig, ExcludeReasonMap, SourceConfig } from "./notices.types";

const sourceConfig = z.object({
  id: z.string(),
  name: z.string(),
  campus: z.string(),
  college: z.string().nullable(),
  appCategory: z.string().nullable(),
  crawlAvailable: z.boolean(),
  excludeReason: z.string().nullable(),
  hasCategory: z.boolean(),
  hasAuthor: z.boolean(),
}) satisfies z.ZodType<SourceConfig>;

export const sourcesFile = z.array(sourceConfig, { error: "sources.json must be a JSON array" });

const label = z.object({ ko: z.string().min(1), en: z.string().min(1), zh: z.string().optional() }, {
  error: 'label must have "ko" and "en" keys',
});

const fixedCategory = z.object({ id: z.string().min(1), label, tabMode: z.literal("fixed"), sourceId: z.string().min(1) });

const ids = z.array(z.string());

const pickerCategory = z.object({
  id: z.string().min(1),
  label,
  tabMode: z.literal("picker"),
  sourceIds: ids.min(1, { error: 'picker tab must have non-empty "sourceIds" array' }),
  maxSelection: z.number().min(1, { error: 'picker tab must have "maxSelection" >= 1' }),
  defaultIds: ids.nullish(),
  campusDefaultIds: z.partialRecord(z.enum(["hssc", "nsc"]), ids).nullish(),
});

export const categoriesFile = z.array(z.discriminatedUnion("tabMode", [fixedCategory, pickerCategory]), {
  error: "categories.json must be a JSON array",
}) satisfies z.ZodType<CategoryConfig[]>;

const reasonCopy = z.object({ ko: z.string(), en: z.string().optional() });

export const excludeReasonsFile = z.record(z.string(), reasonCopy, {
  error: "exclude-reasons.json must be a JSON object (key → label map)",
}) satisfies z.ZodType<ExcludeReasonMap>;
