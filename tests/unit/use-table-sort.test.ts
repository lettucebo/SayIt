import { describe, expect, it } from "vitest";
import { ref } from "vue";
import {
  useTableSort,
  type SortColumn,
} from "../../src/composables/useTableSort";
import { createVocabularyEntry } from "../support/factories/vocabulary-factory";
import type {
  VocabularyEntry,
  VocabularySource,
} from "../../src/types/vocabulary";

const SOURCE_RANK: Record<VocabularySource, number> = { manual: 0, ai: 1 };

const tsOf = (e: VocabularyEntry) => new Date(e.createdAt + "Z").getTime();

function buildColumns(): SortColumn<VocabularyEntry, string>[] {
  return [
    {
      key: "term",
      compare: (a, b) => a.term.localeCompare(b.term),
      defaultDirection: "asc",
    },
    {
      key: "weight",
      compare: (a, b) => a.weight - b.weight,
      defaultDirection: "desc",
    },
    {
      key: "createdAt",
      compare: (a, b) => tsOf(a) - tsOf(b),
      defaultDirection: "desc",
    },
    {
      key: "source",
      compare: (a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
      defaultDirection: "asc",
    },
  ];
}

// 固定 tieBreak：weight desc → createdAt desc → id asc（全序，保證決定性）
const tieBreak = (a: VocabularyEntry, b: VocabularyEntry) =>
  b.weight - a.weight || tsOf(b) - tsOf(a) || a.id.localeCompare(b.id);

const ids = (list: VocabularyEntry[]) => list.map((e) => e.id);

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

describe("useTableSort", () => {
  it("[P1] initial state sorts by the given key/direction (weight desc)", () => {
    const entries = ref(sampleEntries());
    const { sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );
    // b(30) first; tie between a & c (weight 10) -> createdAt desc -> c before a
    expect(ids(sortedList.value)).toEqual(["b", "c", "a"]);
  });

  it("[P1] toggleSort flips direction on the same column", () => {
    const entries = ref(sampleEntries());
    const { sortState, toggleSort, sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );

    toggleSort("weight");
    expect(sortState.value).toEqual({ key: "weight", direction: "asc" });
    // weight asc: 10s first (c before a via tieBreak), then b(30)
    expect(ids(sortedList.value)).toEqual(["c", "a", "b"]);

    toggleSort("weight");
    expect(sortState.value).toEqual({ key: "weight", direction: "desc" });
    expect(ids(sortedList.value)).toEqual(["b", "c", "a"]);
  });

  it("[P1] switching column applies that column's defaultDirection", () => {
    const entries = ref(sampleEntries());
    const { sortState, toggleSort } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );

    toggleSort("term"); // term defaultDirection = asc
    expect(sortState.value).toEqual({ key: "term", direction: "asc" });

    toggleSort("createdAt"); // createdAt defaultDirection = desc
    expect(sortState.value).toEqual({ key: "createdAt", direction: "desc" });

    toggleSort("source"); // source defaultDirection = asc
    expect(sortState.value).toEqual({ key: "source", direction: "asc" });
  });

  it("[P2] sorts by term ascending and descending", () => {
    const entries = ref(sampleEntries());
    const { toggleSort, sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "term", direction: "asc" },
      tieBreak,
    );
    expect(ids(sortedList.value)).toEqual(["a", "b", "c"]);

    toggleSort("term");
    expect(ids(sortedList.value)).toEqual(["c", "b", "a"]);
  });

  it("[P2] sorts by source with manual-first precedence", () => {
    const entries = ref(sampleEntries());
    const { toggleSort, sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "source", direction: "asc" },
      tieBreak,
    );
    // asc: manual (a,c) before ai (b); within manual -> tieBreak c before a
    expect(ids(sortedList.value)).toEqual(["c", "a", "b"]);

    toggleSort("source"); // desc: ai first
    expect(ids(sortedList.value)).toEqual(["b", "c", "a"]);
  });

  it("[P2] sorts by createdAt ascending and descending", () => {
    const entries = ref(sampleEntries());
    const { toggleSort, sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "createdAt", direction: "desc" },
      tieBreak,
    );
    expect(ids(sortedList.value)).toEqual(["c", "b", "a"]);

    toggleSort("createdAt");
    expect(ids(sortedList.value)).toEqual(["a", "b", "c"]);
  });

  it("[P1] tieBreak is stable and NOT reversed by descending direction", () => {
    // 兩筆同 weight、同 createdAt，只差 id -> 必定以 id asc 收尾，方向不影響 tie
    const entries = ref([
      createVocabularyEntry({
        id: "y2",
        weight: 5,
        source: "manual",
        createdAt: "2026-05-05 00:00:00",
      }),
      createVocabularyEntry({
        id: "x1",
        weight: 5,
        source: "manual",
        createdAt: "2026-05-05 00:00:00",
      }),
    ]);
    const { toggleSort, sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );
    expect(ids(sortedList.value)).toEqual(["x1", "y2"]);

    toggleSort("weight"); // asc - tieBreak must still yield id asc
    expect(ids(sortedList.value)).toEqual(["x1", "y2"]);
  });

  it("[P1] re-sorts when a reactive value read inside the comparator changes", () => {
    // 模擬 i18n locale 響應式：comparator 讀外部 ref，改變後 sortedList 應重排
    const flip = ref(false);
    const entries = ref([
      createVocabularyEntry({ id: "1", weight: 1 }),
      createVocabularyEntry({ id: "2", weight: 2 }),
    ]);
    const columns: SortColumn<VocabularyEntry, string>[] = [
      {
        key: "reactive",
        compare: (a, b) => (a.weight - b.weight) * (flip.value ? -1 : 1),
        defaultDirection: "asc",
      },
    ];
    const { sortedList } = useTableSort(
      () => entries.value,
      columns,
      { key: "reactive", direction: "asc" },
      tieBreak,
    );
    expect(ids(sortedList.value)).toEqual(["1", "2"]);

    flip.value = true;
    expect(ids(sortedList.value)).toEqual(["2", "1"]);
  });

  it("[P2] re-sorts when the source list changes", () => {
    const entries = ref([
      createVocabularyEntry({ id: "1", weight: 1 }),
      createVocabularyEntry({ id: "2", weight: 2 }),
    ]);
    const { sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );
    expect(ids(sortedList.value)).toEqual(["2", "1"]);

    entries.value = [
      ...entries.value,
      createVocabularyEntry({ id: "3", weight: 3 }),
    ];
    expect(ids(sortedList.value)).toEqual(["3", "2", "1"]);
  });

  it("[P2] does not mutate the source list", () => {
    const original = sampleEntries();
    const entries = ref(original);
    const { sortedList } = useTableSort(
      () => entries.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );
    void sortedList.value;
    expect(ids(entries.value)).toEqual(["a", "b", "c"]);
  });

  it("[P3] handles empty and single-item lists", () => {
    const empty = ref<VocabularyEntry[]>([]);
    const emptySort = useTableSort(
      () => empty.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );
    expect(emptySort.sortedList.value).toEqual([]);

    const one = ref([createVocabularyEntry({ id: "only", weight: 7 })]);
    const { sortedList } = useTableSort(
      () => one.value,
      buildColumns(),
      { key: "weight", direction: "desc" },
      tieBreak,
    );
    expect(ids(sortedList.value)).toEqual(["only"]);
  });
});
