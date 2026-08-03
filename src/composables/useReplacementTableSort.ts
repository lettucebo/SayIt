import { computed } from "vue";
import {
  useTableSort,
  type SortColumn,
  type UseTableSortReturn,
} from "./useTableSort";
import type { ReplacementRule, ReplacementTiming } from "../types/replacement";

export type ReplacementSortKey =
  | "patterns"
  | "replacement"
  | "timing"
  | "isRegex"
  | "enabled"
  | "createdAt";

/**
 * 依「套用流程先後」而非翻譯文字排序，確保各語系結果一致。
 * 比照 DictionaryView 的 SOURCE_RANK 作法。
 */
export const TIMING_RANK: Record<ReplacementTiming, number> = {
  beforeAI: 0,
  afterAI: 1,
  both: 2,
};

/**
 * 安全時間解析：無法解析時回 null 而非 NaN。
 * 直接對 NaN／Infinity 相減會得到 NaN，讓 comparator 回傳非數值而破壞排序，
 * 因此缺漏值改以明確分支處理（一律視為最舊）。
 */
function parseCreatedAt(rule: ReplacementRule): number | null {
  const ms = Date.parse(rule.createdAt);
  return Number.isFinite(ms) ? ms : null;
}

export function compareCreatedAt(
  a: ReplacementRule,
  b: ReplacementRule,
): number {
  const left = parseCreatedAt(a);
  const right = parseCreatedAt(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left - right;
}

export function createReplacementSortColumns(
  getLocale: () => string,
): SortColumn<ReplacementRule, ReplacementSortKey>[] {
  return [
    {
      key: "patterns",
      compare: (a, b) =>
        a.patterns.join(", ").localeCompare(b.patterns.join(", "), getLocale()),
      defaultDirection: "asc",
    },
    {
      key: "replacement",
      compare: (a, b) => a.replacement.localeCompare(b.replacement, getLocale()),
      defaultDirection: "asc",
    },
    {
      key: "timing",
      compare: (a, b) => TIMING_RANK[a.timing] - TIMING_RANK[b.timing],
      defaultDirection: "asc",
    },
    {
      key: "isRegex",
      compare: (a, b) => Number(a.isRegex) - Number(b.isRegex),
      defaultDirection: "asc",
    },
    {
      key: "enabled",
      compare: (a, b) => Number(a.enabled) - Number(b.enabled),
      defaultDirection: "desc",
    },
    {
      key: "createdAt",
      compare: compareCreatedAt,
      defaultDirection: "desc",
    },
  ];
}

/**
 * 取代規則表格排序。
 *
 * tie-break 刻意採「來源陣列的原始索引」而非 `id`：
 * 本功能推出前建立的規則會被遷移成**同一個** `createdAt`，若用 UUID 當全序鍵，
 * 使用者升級後看到的順序會被打亂成隨機序。原始索引即新增順序（addRule append、
 * updateRule 原位取代、removeRule filter），故能維持既有畫面順序且仍為全序。
 *
 * `getLocale` 必須是 getter：comparator 在 computed 內執行時才讀取，
 * 才能在切換語系後正確重新排序。
 */
export function useReplacementTableSort(
  source: () => ReplacementRule[],
  getLocale: () => string,
): UseTableSortReturn<ReplacementRule, ReplacementSortKey> {
  const orderMap = computed(
    () => new Map(source().map((rule, index) => [rule.id, index])),
  );

  return useTableSort<ReplacementRule, ReplacementSortKey>(
    source,
    createReplacementSortColumns(getLocale),
    { key: "createdAt", direction: "desc" },
    (a, b) =>
      (orderMap.value.get(a.id) ?? 0) - (orderMap.value.get(b.id) ?? 0),
  );
}
