import { describe, expect, it } from "vitest";
import { ref } from "vue";
import {
  TIMING_RANK,
  compareCreatedAt,
  createReplacementSortColumns,
  useReplacementTableSort,
} from "../../src/composables/useReplacementTableSort";
import { createReplacementRule } from "../support/factories";
import type { ReplacementRule } from "../../src/types/replacement";

const at = (iso: string) => ({ createdAt: iso });

function columnCompare(
  key: string,
  a: ReplacementRule,
  b: ReplacementRule,
  locale = "zh-TW",
): number {
  const column = createReplacementSortColumns(() => locale).find(
    (c) => c.key === key,
  );
  if (!column) throw new Error(`column ${key} not found`);
  return column.compare(a, b);
}

describe("useReplacementTableSort", () => {
  describe("comparator", () => {
    it("[P1] 時機依套用流程 rank 排序，不依翻譯文字", () => {
      expect(TIMING_RANK).toEqual({ beforeAI: 0, afterAI: 1, both: 2 });
      const before = createReplacementRule({ timing: "beforeAI" });
      const after = createReplacementRule({ timing: "afterAI" });
      const both = createReplacementRule({ timing: "both" });

      expect(columnCompare("timing", before, after)).toBeLessThan(0);
      expect(columnCompare("timing", after, both)).toBeLessThan(0);
      expect(columnCompare("timing", both, before)).toBeGreaterThan(0);
    });

    it("[P1] 類型與啟用以布林轉數字比較", () => {
      const literal = createReplacementRule({ isRegex: false });
      const regex = createReplacementRule({ isRegex: true });
      expect(columnCompare("isRegex", literal, regex)).toBeLessThan(0);

      const off = createReplacementRule({ enabled: false });
      const on = createReplacementRule({ enabled: true });
      expect(columnCompare("enabled", off, on)).toBeLessThan(0);
    });

    it("[P1] 來源寫法以合併字串比較，正確寫法以字面比較", () => {
      const a = createReplacementRule({ patterns: ["apple", "zebra"] });
      const b = createReplacementRule({ patterns: ["banana"] });
      expect(columnCompare("patterns", a, b)).toBeLessThan(0);

      const x = createReplacementRule({ replacement: "alpha" });
      const y = createReplacementRule({ replacement: "beta" });
      expect(columnCompare("replacement", x, y)).toBeLessThan(0);
    });

    it("[P1] 建立時間無法解析時視為最舊，且不會回傳 NaN", () => {
      const good = createReplacementRule(at("2026-01-02T00:00:00.000Z"));
      const bad = createReplacementRule({ createdAt: "not-a-date" });
      const alsoBad = createReplacementRule({ createdAt: "" });

      expect(compareCreatedAt(bad, good)).toBeLessThan(0);
      expect(compareCreatedAt(good, bad)).toBeGreaterThan(0);
      expect(compareCreatedAt(bad, alsoBad)).toBe(0);
      expect(Number.isNaN(compareCreatedAt(bad, alsoBad))).toBe(false);
    });

    it("[P1] 首次點擊方向：建立時間與啟用為降冪，其餘為升冪", () => {
      const byKey = new Map(
        createReplacementSortColumns(() => "zh-TW").map((c) => [
          c.key,
          c.defaultDirection,
        ]),
      );
      expect(byKey.get("createdAt")).toBe("desc");
      expect(byKey.get("enabled")).toBe("desc");
      expect(byKey.get("patterns")).toBe("asc");
      expect(byKey.get("replacement")).toBe("asc");
      expect(byKey.get("timing")).toBe("asc");
      expect(byKey.get("isRegex")).toBe("asc");
    });
  });

  describe("排序狀態", () => {
    it("[P1] 預設以建立時間降冪排序（最新在上）", () => {
      const older = createReplacementRule({
        id: "older",
        ...at("2026-01-01T00:00:00.000Z"),
      });
      const newer = createReplacementRule({
        id: "newer",
        ...at("2026-06-01T00:00:00.000Z"),
      });
      const rules = ref<ReplacementRule[]>([older, newer]);

      const { sortState, sortedList } = useReplacementTableSort(
        () => rules.value,
        () => "zh-TW",
      );

      expect(sortState.value).toEqual({ key: "createdAt", direction: "desc" });
      expect(sortedList.value.map((r) => r.id)).toEqual(["newer", "older"]);
    });

    it("[P1] 相同建立時間時以原始新增順序（陣列索引）為次鍵，降冪也不反轉", () => {
      const iso = "2026-03-03T03:03:03.000Z";
      // id 刻意逆字母序，證明 tie-break 不是用 id 排
      const rules = ref<ReplacementRule[]>([
        createReplacementRule({ id: "zzz", ...at(iso) }),
        createReplacementRule({ id: "mmm", ...at(iso) }),
        createReplacementRule({ id: "aaa", ...at(iso) }),
      ]);

      const { toggleSort, sortedList } = useReplacementTableSort(
        () => rules.value,
        () => "zh-TW",
      );

      expect(sortedList.value.map((r) => r.id)).toEqual(["zzz", "mmm", "aaa"]);
      toggleSort("createdAt");
      expect(sortedList.value.map((r) => r.id)).toEqual(["zzz", "mmm", "aaa"]);
    });

    it("[P1] toggleSort 可在同一欄位間切換升冪／降冪", () => {
      const rules = ref<ReplacementRule[]>([
        createReplacementRule({ id: "a", ...at("2026-01-01T00:00:00.000Z") }),
        createReplacementRule({ id: "b", ...at("2026-02-01T00:00:00.000Z") }),
      ]);

      const { sortState, toggleSort, sortedList } = useReplacementTableSort(
        () => rules.value,
        () => "zh-TW",
      );

      expect(sortedList.value.map((r) => r.id)).toEqual(["b", "a"]);
      toggleSort("createdAt");
      expect(sortState.value.direction).toBe("asc");
      expect(sortedList.value.map((r) => r.id)).toEqual(["a", "b"]);
      toggleSort("createdAt");
      expect(sortState.value.direction).toBe("desc");
      expect(sortedList.value.map((r) => r.id)).toEqual(["b", "a"]);
    });

    it("[P1] 索引 tie-break 會跟著來源清單更新，不會 stale", () => {
      const iso = "2026-03-03T03:03:03.000Z";
      const first = createReplacementRule({ id: "first", ...at(iso) });
      const second = createReplacementRule({ id: "second", ...at(iso) });
      const rules = ref<ReplacementRule[]>([first, second]);

      const { sortedList } = useReplacementTableSort(
        () => rules.value,
        () => "zh-TW",
      );
      expect(sortedList.value.map((r) => r.id)).toEqual(["first", "second"]);

      rules.value = [second, first];
      expect(sortedList.value.map((r) => r.id)).toEqual(["second", "first"]);
    });

    it("[P2] locale 變更後以新語系重新排序（comparator 讀取 getter）", () => {
      const locale = ref("en");
      const rules = ref<ReplacementRule[]>([
        createReplacementRule({ id: "a", replacement: "a" }),
        createReplacementRule({ id: "b", replacement: "b" }),
      ]);

      const { toggleSort, sortedList } = useReplacementTableSort(
        () => rules.value,
        () => locale.value,
      );
      toggleSort("replacement");
      expect(sortedList.value.map((r) => r.id)).toEqual(["a", "b"]);

      locale.value = "zh-TW";
      expect(sortedList.value.map((r) => r.id)).toEqual(["a", "b"]);
    });
  });
});
