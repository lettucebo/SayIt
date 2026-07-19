import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import DictionaryView from "../../src/views/DictionaryView.vue";
import { createVocabularyEntry } from "../support/factories/vocabulary-factory";
import type { VocabularyEntry } from "../../src/types/vocabulary";

vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));

let vocabState: Record<string, unknown>;
let settingsState: Record<string, unknown>;

vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => vocabState,
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
}));

function makeVocab(entries: VocabularyEntry[]): Record<string, unknown> {
  return {
    termList: entries,
    termCount: entries.length,
    aiSuggestedTermList: entries.filter((e) => e.source === "ai"),
    isLoading: false,
    isDuplicateTerm: vi.fn().mockReturnValue(false),
    fetchTermList: vi.fn().mockResolvedValue(undefined),
    addTerm: vi.fn().mockResolvedValue(undefined),
    removeTerm: vi.fn().mockResolvedValue(undefined),
  };
}

/** a: manual/10/01-01, b: ai/30/01-02, c: manual/10/01-03 */
function sampleEntries(): VocabularyEntry[] {
  return [
    createVocabularyEntry({
      id: "a",
      term: "apple",
      weight: 10,
      source: "manual",
      createdAt: "2026-01-01 00:00:00",
    }),
    createVocabularyEntry({
      id: "b",
      term: "banana",
      weight: 30,
      source: "ai",
      createdAt: "2026-01-02 00:00:00",
    }),
    createVocabularyEntry({
      id: "c",
      term: "cherry",
      weight: 10,
      source: "manual",
      createdAt: "2026-01-03 00:00:00",
    }),
  ];
}

function mountView() {
  return mount(DictionaryView, {
    global: {
      plugins: [i18n],
    },
  });
}

/** 依渲染順序取出各列的 vocab id */
function rowIds(wrapper: ReturnType<typeof mountView>): string[] {
  return wrapper
    .findAll('[data-testid^="vocab-row-"]')
    .map((row) =>
      (row.attributes("data-testid") ?? "").replace("vocab-row-", ""),
    );
}

function ariaSortOf(
  wrapper: ReturnType<typeof mountView>,
  testid: string,
): string | null | undefined {
  const th = wrapper.get(`[data-testid="${testid}"]`).element.closest("th");
  return th?.getAttribute("aria-sort");
}

beforeEach(() => {
  vocabState = makeVocab(sampleEntries());
  settingsState = { isSmartDictionaryEnabled: false };
});

describe("DictionaryView", () => {
  it("[P1] renders a single table with all terms (initial weight desc)", () => {
    const wrapper = mountView();
    // 單一表格：只有一個 <table>
    expect(wrapper.findAll("table")).toHaveLength(1);
    // 初始 weight desc: b(30), then c & a (10) tie -> createdAt desc -> c, a
    expect(rowIds(wrapper)).toEqual(["b", "c", "a"]);
  });

  it("[P1] toggles weight ascending when clicking the weight header", async () => {
    const wrapper = mountView();
    await wrapper.get('[data-testid="sort-weight"]').trigger("click");
    // weight asc: 10s first (c before a via tieBreak), then b(30)
    expect(rowIds(wrapper)).toEqual(["c", "a", "b"]);
  });

  it("[P2] sorts by source with manual-first precedence", async () => {
    const wrapper = mountView();
    await wrapper.get('[data-testid="sort-source"]').trigger("click");
    // asc manual-first: manual (c,a via tieBreak) then ai (b)
    expect(rowIds(wrapper)).toEqual(["c", "a", "b"]);

    await wrapper.get('[data-testid="sort-source"]').trigger("click");
    // desc: ai first
    expect(rowIds(wrapper)).toEqual(["b", "c", "a"]);
  });

  it("[P2] sorts by term alphabetically", async () => {
    const wrapper = mountView();
    await wrapper.get('[data-testid="sort-term"]').trigger("click");
    expect(rowIds(wrapper)).toEqual(["a", "b", "c"]);

    await wrapper.get('[data-testid="sort-term"]').trigger("click");
    expect(rowIds(wrapper)).toEqual(["c", "b", "a"]);
  });

  it("[P2] renders localized source labels with badges", () => {
    const wrapper = mountView();
    const text = wrapper.text();
    expect(text).toContain(i18n.global.t("dictionary.sourceManual"));
    expect(text).toContain(i18n.global.t("dictionary.sourceAi"));
    // 每列都有來源 badge
    expect(wrapper.findAll('[data-testid="vocab-source"]')).toHaveLength(3);
  });

  it("[P1] reflects aria-sort only on the active column", async () => {
    const wrapper = mountView();
    // 初始：weight 欄為 descending，其餘 none
    expect(ariaSortOf(wrapper, "sort-weight")).toBe("descending");
    expect(ariaSortOf(wrapper, "sort-term")).toBe("none");
    expect(ariaSortOf(wrapper, "sort-source")).toBe("none");
    expect(ariaSortOf(wrapper, "sort-date")).toBe("none");

    await wrapper.get('[data-testid="sort-term"]').trigger("click");
    // 切到 term asc；weight 回 none
    expect(ariaSortOf(wrapper, "sort-term")).toBe("ascending");
    expect(ariaSortOf(wrapper, "sort-weight")).toBe("none");
  });

  it("[P2] keeps deterministic order for equal weight and timestamp", () => {
    vocabState = makeVocab([
      createVocabularyEntry({
        id: "y2",
        term: "same-two",
        weight: 5,
        source: "manual",
        createdAt: "2026-05-05 00:00:00",
      }),
      createVocabularyEntry({
        id: "x1",
        term: "same-one",
        weight: 5,
        source: "manual",
        createdAt: "2026-05-05 00:00:00",
      }),
    ]);
    const wrapper = mountView();
    // tieBreak 最終以 id asc 收尾 -> x1 before y2
    expect(rowIds(wrapper)).toEqual(["x1", "y2"]);
  });

  it("[P2] does not show the 'no AI suggestions' hint when AI terms exist", () => {
    // b 為 ai 來源 → 已有 AI 詞，即使智慧學習關閉也不應顯示「尚無 AI 推薦詞彙」（避免與表格矛盾）
    settingsState = { isSmartDictionaryEnabled: false };
    const wrapper = mountView();
    expect(wrapper.text()).not.toContain(
      i18n.global.t("dictionary.noAiSuggestions"),
    );
  });

  it("[P2] renders empty state when there are no terms", () => {
    vocabState = makeVocab([]);
    const wrapper = mountView();
    expect(wrapper.findAll("table")).toHaveLength(0);
    expect(wrapper.text()).toContain(i18n.global.t("dictionary.emptyState"));
  });
});
