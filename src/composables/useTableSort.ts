import { computed, ref, type Ref } from "vue";

export type SortDirection = "asc" | "desc";

export interface SortColumn<T, K extends string> {
  key: K;
  /** 升冪語意的主鍵比較（回傳 <0 表示 a 應排在 b 前） */
  compare: (a: T, b: T) => number;
  /** 首次點擊此欄時採用的方向，未指定則為 "asc" */
  defaultDirection?: SortDirection;
}

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export interface UseTableSortReturn<T, K extends string> {
  sortState: Ref<SortState<K>>;
  toggleSort: (key: K) => void;
  sortedList: Ref<T[]>;
}

/**
 * 通用表格排序：對來源清單就地（複本）排序，並管理二態排序狀態。
 *
 * 關鍵設計：
 * - 方向 factor 只作用於「主鍵比較」；`tieBreak` 為固定次鍵，不受方向反轉影響，
 *   確保降冪時同主鍵值的相對次序仍穩定、可預期。
 * - `source` 以 getter 形式傳入，於 `sortedList` computed 內呼叫，
 *   使來源清單與 comparator 內讀取的響應式值（如 i18n locale）都能被正確追蹤。
 */
export function useTableSort<T, K extends string>(
  source: () => T[],
  columns: SortColumn<T, K>[],
  initial: SortState<K>,
  tieBreak: (a: T, b: T) => number = () => 0,
): UseTableSortReturn<T, K> {
  const columnMap = new Map<K, SortColumn<T, K>>(
    columns.map((column) => [column.key, column]),
  );

  const sortState = ref<SortState<K>>({ ...initial }) as Ref<SortState<K>>;

  function toggleSort(key: K) {
    if (sortState.value.key === key) {
      sortState.value = {
        key,
        direction: sortState.value.direction === "asc" ? "desc" : "asc",
      };
      return;
    }
    sortState.value = {
      key,
      direction: columnMap.get(key)?.defaultDirection ?? "asc",
    };
  }

  const sortedList = computed<T[]>(() => {
    const { key, direction } = sortState.value;
    const list = [...source()];
    const column = columnMap.get(key);
    if (!column) return list;

    const factor = direction === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const primary = column.compare(a, b) * factor;
      if (primary !== 0) return primary;
      return tieBreak(a, b);
    });
  });

  return { sortState, toggleSort, sortedList };
}
