import type { CategoryConfig, CategoryPicker, ExcludeReasonMap, SourceConfig } from "../notices.types";
import type { NoticeTab, NoticeTabs } from "./notices-tabs.wire";

type TabsLang = "ko" | "en";

interface TabsInput {
  categories: readonly CategoryConfig[];
  sourceById: ReadonlyMap<string, SourceConfig>;
  excludeReasons: ExcludeReasonMap;
}

const labelIn = (label: { ko: string; en?: string }, lang: TabsLang): string => label[lang] || label.en || label.ko;

function toPickerTab(cat: CategoryPicker, { sourceById, excludeReasons }: TabsInput, lang: TabsLang): NoticeTab {
  const sources = cat.sourceIds.flatMap((id) => {
    const source = sourceById.get(id);
    if (!source) return [];
    const reason = source.excludeReason;
    const reasonCopy = reason ? excludeReasons[reason] : undefined;
    return [
      {
        id: source.id,
        name: source.name,
        campus: source.campus,
        college: source.college,
        noticeAvailable: source.crawlAvailable,
        excludeReason: reason,
        excludeReasonText: reasonCopy ? labelIn(reasonCopy, lang) : null,
      },
    ];
  });
  return {
    key: cat.id,
    label: labelIn(cat.label, lang),
    tabMode: "picker",
    picker: {
      sources,
      maxSelection: Math.min(cat.maxSelection, sources.length),
      defaultIds: cat.defaultIds ?? [],
      campusDefaultIds: cat.campusDefaultIds ?? {},
    },
  };
}

export function toTabsResponse(input: TabsInput, lang: TabsLang): NoticeTabs {
  const tabs = input.categories.map((cat): NoticeTab => {
    if (cat.tabMode === "picker") return toPickerTab(cat, input, lang);
    const source = input.sourceById.get(cat.sourceId);
    if (!source) throw new Error(`notices tab "${cat.id}" names unknown source "${cat.sourceId}"`);
    return { key: cat.id, label: labelIn(cat.label, lang), tabMode: "fixed", fixed: { sourceId: cat.sourceId, name: source.name, campus: source.campus } };
  });
  return { schemaVersion: 1, tabs };
}
