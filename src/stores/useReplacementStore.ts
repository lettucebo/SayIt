import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { load, type Store } from "@tauri-apps/plugin-store";
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

/** 執行期防呆：過濾掉損毀 / 型別不符的持久化資料。 */
export function isValidRule(value: unknown): value is ReplacementRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    Array.isArray(r.patterns) &&
    r.patterns.every((p) => typeof p === "string") &&
    typeof r.replacement === "string" &&
    typeof r.isRegex === "boolean" &&
    typeof r.timing === "string" &&
    VALID_TIMINGS.includes(r.timing as ReplacementTiming) &&
    typeof r.enabled === "boolean"
  );
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

  async function ensureLoaded(): Promise<void> {
    if (isLoaded.value) return;
    try {
      const store = await getStore();
      const saved = await store.get<unknown[]>(RULES_KEY);
      rules.value = Array.isArray(saved) ? saved.filter(isValidRule) : [];
    } catch (error) {
      // fail-open：讀取失敗不阻斷主流程，視為無規則
      console.warn("[replacement-store] load failed:", error);
      rules.value = [];
    }
    isLoaded.value = true;
  }

  /** 純驗證：長度上限 + 正則可編譯性。回傳錯誤碼供 UI i18n。 */
  function validateRuleInput(
    patterns: string[],
    replacement: string,
    isRegex: boolean,
  ): RuleValidationResult {
    const cleaned = patterns.map((p) => p.trim()).filter((p) => p.length > 0);
    if (cleaned.length === 0) return { valid: false, error: "empty-patterns" };
    if (cleaned.some((p) => p.length > MAX_PATTERN_LENGTH)) {
      return { valid: false, error: "pattern-too-long" };
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

  async function persist(): Promise<void> {
    const store = await getStore();
    await store.set(RULES_KEY, rules.value);
    await store.save();
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
      patterns: input.patterns.map((p) => p.trim()).filter((p) => p.length > 0),
      replacement: input.replacement,
      isRegex: input.isRegex,
      timing: input.timing,
      enabled: input.enabled,
    };
    rules.value = [...rules.value, rule];
    try {
      await persist();
    } catch (error) {
      captureError(error, { source: "replacement", step: "add" });
    }
    return { valid: true };
  }

  async function updateRule(
    id: string,
    patch: Partial<Omit<ReplacementRule, "id">>,
  ): Promise<RuleValidationResult> {
    await ensureLoaded();
    const index = rules.value.findIndex((r) => r.id === id);
    if (index === -1) return { valid: false, error: "not-found" };
    const merged: ReplacementRule = { ...rules.value[index], ...patch };
    const validation = validateRuleInput(
      merged.patterns,
      merged.replacement,
      merged.isRegex,
    );
    if (!validation.valid) return validation;
    const next = [...rules.value];
    next[index] = merged;
    rules.value = next;
    try {
      await persist();
    } catch (error) {
      captureError(error, { source: "replacement", step: "update" });
    }
    return { valid: true };
  }

  async function removeRule(id: string): Promise<void> {
    await ensureLoaded();
    rules.value = rules.value.filter((r) => r.id !== id);
    try {
      await persist();
    } catch (error) {
      captureError(error, { source: "replacement", step: "remove" });
    }
  }

  return {
    rules,
    ruleCount,
    ensureLoaded,
    addRule,
    updateRule,
    removeRule,
    validateRuleInput,
  };
});
