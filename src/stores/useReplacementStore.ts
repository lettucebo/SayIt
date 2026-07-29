import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  emitEvent,
  REPLACEMENTS_CHANGED,
} from "../composables/useTauriEvents";
import { captureError } from "../lib/sentry";
import type { ReplacementRule, ReplacementTiming } from "../types/replacement";

const STORE_NAME = "replacements.json";
const RULES_KEY = "rules";

/**
 * ReDoS / 巨量輸入的基本硬限制。完整阻擋 catastrophic backtracking 需未來於
 * Web Worker 執行並 timeout terminate；此處先以硬上限與可編譯性檢查降低風險。
 */
export const MAX_REPLACEMENT_RULES = 200;
export const MAX_PATTERN_LENGTH = 200;
export const MAX_PATTERNS_PER_RULE = 50;
export const MAX_TOTAL_PATTERN_CHARS_PER_RULE = 2000;
export const MAX_REPLACEMENT_LENGTH = 500;

const VALID_TIMINGS: readonly ReplacementTiming[] = [
  "beforeAI",
  "afterAI",
  "both",
];

export interface RuleValidationResult {
  valid: boolean;
  error?: string;
}

function cleanPatterns(patterns: readonly string[]): string[] {
  return patterns.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** 純驗證：長度上限 + 正則可編譯性。回傳錯誤碼供 UI i18n。 */
function validateReplacementRuleInput(
  patterns: string[],
  replacement: string,
  isRegex: boolean,
): RuleValidationResult {
  const cleaned = cleanPatterns(patterns);
  if (cleaned.length === 0) return { valid: false, error: "empty-patterns" };
  if (cleaned.length > MAX_PATTERNS_PER_RULE) {
    return { valid: false, error: "too-many-patterns" };
  }
  if (cleaned.some((p) => p.length > MAX_PATTERN_LENGTH)) {
    return { valid: false, error: "pattern-too-long" };
  }
  const totalPatternChars = cleaned.reduce((sum, p) => sum + p.length, 0);
  if (totalPatternChars > MAX_TOTAL_PATTERN_CHARS_PER_RULE) {
    return { valid: false, error: "patterns-total-too-long" };
  }
  if (replacement.length > MAX_REPLACEMENT_LENGTH) {
    return { valid: false, error: "replacement-too-long" };
  }
  if (isRegex) {
    for (const p of cleaned) {
      try {
        new RegExp(p, "g");
      } catch {
        return { valid: false, error: "invalid-regex" };
      }
    }
  }
  return { valid: true };
}

function sanitizeRule(value: unknown): ReplacementRule | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.id === "string" &&
    Array.isArray(r.patterns) &&
    r.patterns.every((p) => typeof p === "string") &&
    typeof r.replacement === "string" &&
    typeof r.isRegex === "boolean" &&
    typeof r.timing === "string" &&
    VALID_TIMINGS.includes(r.timing as ReplacementTiming) &&
    typeof r.enabled === "boolean"
  ) {
    const patterns = cleanPatterns(r.patterns);
    const validation = validateReplacementRuleInput(
      patterns,
      r.replacement,
      r.isRegex,
    );
    if (!validation.valid) return null;
    return {
      id: r.id,
      patterns,
      replacement: r.replacement,
      isRegex: r.isRegex,
      timing: r.timing as ReplacementTiming,
      enabled: r.enabled,
      // 舊資料沒有這個欄位；只在型別正確且為有限正數時才保留。
      ...(typeof r.createdAt === "number" && Number.isFinite(r.createdAt)
        ? { createdAt: r.createdAt }
        : {}),
    };
  }
  return null;
}

/** 執行期防呆：過濾掉損毀 / 型別不符的持久化資料。 */
export function isValidRule(value: unknown): value is ReplacementRule {
  return sanitizeRule(value) !== null;
}

function sanitizeRuleList(value: unknown): ReplacementRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const rule = sanitizeRule(item);
    return rule ? [rule] : [];
  });
}

export const useReplacementStore = defineStore("replacement", () => {
  const rules = ref<ReplacementRule[]>([]);
  const isLoaded = ref(false);
  let storeInstance: Store | null = null;

  const ruleCount = computed(() => rules.value.length);

  async function getStore(): Promise<Store> {
    if (!storeInstance) storeInstance = await load(STORE_NAME);
    return storeInstance;
  }

  async function reload(): Promise<void> {
    try {
      const store = await getStore();
      const saved = await store.get<unknown>(RULES_KEY);
      rules.value = sanitizeRuleList(saved);
      isLoaded.value = true;
    } catch (error) {
      // fail-open：讀取失敗不阻斷主流程，視為無規則
      console.warn("[replacement-store] load failed:", error);
      captureError(error, { source: "replacement", step: "load" });
      rules.value = [];
      isLoaded.value = false;
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (isLoaded.value) return;
    await reload();
  }

  function validateRuleInput(
    patterns: string[],
    replacement: string,
    isRegex: boolean,
  ): RuleValidationResult {
    return validateReplacementRuleInput(patterns, replacement, isRegex);
  }

  async function persist(nextRules: readonly ReplacementRule[]): Promise<void> {
    const store = await getStore();
    await store.set(RULES_KEY, [...nextRules]);
    await store.save();
  }

  async function commitRules(
    nextRules: ReplacementRule[],
    step: string,
  ): Promise<RuleValidationResult> {
    try {
      await persist(nextRules);
      rules.value = nextRules;
      void emitEvent(REPLACEMENTS_CHANGED);
      return { valid: true };
    } catch (error) {
      captureError(error, { source: "replacement", step });
      return { valid: false, error: "persistence-failed" };
    }
  }

  async function addRule(
    input: Omit<ReplacementRule, "id">,
  ): Promise<RuleValidationResult> {
    await ensureLoaded();
    if (rules.value.length >= MAX_REPLACEMENT_RULES) {
      return { valid: false, error: "too-many-rules" };
    }
    const validation = validateRuleInput(
      input.patterns,
      input.replacement,
      input.isRegex,
    );
    if (!validation.valid) return validation;
    const rule: ReplacementRule = {
      id: crypto.randomUUID(),
      patterns: cleanPatterns(input.patterns),
      replacement: input.replacement,
      isRegex: input.isRegex,
      timing: input.timing,
      enabled: input.enabled,
      createdAt: Date.now(),
    };
    return commitRules([...rules.value, rule], "add");
  }

  /**
   * 調整規則的**套用順序**（往前 / 往後一位）。
   *
   * 順序有實質語意：`applyWordReplacements` 依陣列順序逐條套用，前面的規則會改
   * 動後面規則看到的文字。例如「一儀錶板 → 儀表板」必須排在「儀錶板 → 儀表板」
   * 之前，否則短的先命中會留下贅字「一」。因此這裡調整的是持久化的真實順序，
   * 與 UI 的欄位排序（純檢視）是兩回事。
   */
  async function moveRule(
    id: string,
    direction: "up" | "down",
  ): Promise<boolean> {
    await ensureLoaded();
    const index = rules.value.findIndex((r) => r.id === id);
    if (index === -1) return false;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rules.value.length) return false;
    const next = [...rules.value];
    [next[index], next[target]] = [next[target], next[index]];
    const result = await commitRules(next, "move");
    return result.valid;
  }

  async function updateRule(
    id: string,
    patch: Partial<Omit<ReplacementRule, "id">>,
  ): Promise<RuleValidationResult> {
    await ensureLoaded();
    const index = rules.value.findIndex((r) => r.id === id);
    if (index === -1) return { valid: false, error: "not-found" };
    const merged: ReplacementRule = {
      ...rules.value[index],
      ...patch,
      patterns: patch.patterns
        ? cleanPatterns(patch.patterns)
        : rules.value[index].patterns,
    };
    const validation = validateRuleInput(
      merged.patterns,
      merged.replacement,
      merged.isRegex,
    );
    if (!validation.valid) return validation;
    const next = [...rules.value];
    next[index] = merged;
    return commitRules(next, "update");
  }

  async function removeRule(id: string): Promise<boolean> {
    await ensureLoaded();
    const next = rules.value.filter((r) => r.id !== id);
    if (next.length === rules.value.length) return false;
    const result = await commitRules(next, "remove");
    return result.valid;
  }

  /** 匯出目前規則（備份用）。 */
  async function exportRules(): Promise<ReplacementRule[]> {
    await ensureLoaded();
    return [...rules.value];
  }

  /**
   * 以匯入的規則整批取代（備份還原用）。
   * 沿用 sanitizeRuleList 丟棄不合法規則，並套用筆數上限，
   * 避免壞掉的備份檔寫入無法在 UI 修復的規則或超量資料。
   */
  async function importRules(value: unknown): Promise<RuleValidationResult> {
    const sanitized = sanitizeRuleList(value).slice(0, MAX_REPLACEMENT_RULES);
    return commitRules(sanitized, "import");
  }

  return {
    rules,
    ruleCount,
    ensureLoaded,
    reload,
    addRule,
    updateRule,
    removeRule,
    moveRule,
    validateRuleInput,
    exportRules,
    importRules,
  };
});
