import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  emitEvent,
  REPLACEMENTS_CHANGED,
} from "../composables/useTauriEvents";
import { extractErrorMessage } from "../lib/errorUtils";
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

/**
 * 把任意時間值正規化成 canonical ISO 8601 UTC 字串；無法解析則回 null。
 * `Date.parse` 會接受不帶 `Z` 的字串並按本地時區解讀，故一律重新輸出
 * `toISOString()`，確保儲存值與型別宣告的「ISO UTC」契約一致。
 */
export function normalizeCreatedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
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

function sanitizeRule(
  value: unknown,
  fallbackCreatedAt: string,
): ReplacementRule | null {
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
      // 缺漏／不合法的時間戳一律補值，絕不因此丟棄規則（fail-open）
      createdAt: normalizeCreatedAt(r.createdAt) ?? fallbackCreatedAt,
    };
  }
  return null;
}

/**
 * 執行期防呆：過濾掉損毀 / 型別不符的持久化資料。
 * 嚴格版本——要求原物件本身已帶 **canonical** 的 `createdAt`（正規化後與原值相同），
 * 避免 type guard 對「還沒遷移過」或「非 ISO UTC 格式」的物件回報 true，
 * 讓呼叫端誤以為它已符合型別宣告的契約。補值請走 `sanitizeRuleList`。
 */
export function isValidRule(value: unknown): value is ReplacementRule {
  if (typeof value !== "object" || value === null) return false;
  const rawCreatedAt = (value as Record<string, unknown>).createdAt;
  if (normalizeCreatedAt(rawCreatedAt) !== rawCreatedAt) return false;
  return sanitizeRule(value, new Date().toISOString()) !== null;
}

export interface SanitizedRuleList {
  rules: ReplacementRule[];
  /**
   * sanitizer 丟棄的原始項目（損毀 / 超限 / 正則無法編譯）。
   * 必須保留：CRUD 是把記憶體清單整批寫回，若不接回這些項目，
   * 使用者下一次新增／編輯／刪除就會把它們從檔案裡永久刪除。
   */
  dropped: unknown[];
}

/** 整批共用同一個 fallback 時間戳，確保同批補值的規則時間一致。 */
function sanitizeRuleList(
  value: unknown,
  fallbackCreatedAt: string = new Date().toISOString(),
): SanitizedRuleList {
  if (!Array.isArray(value)) return { rules: [], dropped: [] };
  const rules: ReplacementRule[] = [];
  const dropped: unknown[] = [];
  for (const item of value) {
    const rule = sanitizeRule(item, fallbackCreatedAt);
    if (rule) rules.push(rule);
    else dropped.push(item);
  }
  return { rules, dropped };
}

/**
 * Rust `io::Error` 的 Display 會附上不受系統語系影響的 `(os error N)` 後綴。
 * 2 = ENOENT / ERROR_FILE_NOT_FOUND、3 = ERROR_PATH_NOT_FOUND。
 * 只有「檔案不存在」才是全新安裝的正常狀態，其餘讀取錯誤都必須視為失敗。
 */
function isFileNotFoundError(error: unknown): boolean {
  return /\(os error [23]\)/u.test(extractErrorMessage(error));
}

export const useReplacementStore = defineStore("replacement", () => {
  const rules = ref<ReplacementRule[]>([]);
  const isLoaded = ref(false);
  let storeInstance: Store | null = null;
  /** 見 `SanitizedRuleList.dropped`：寫回時原樣接回，避免靜默刪除。 */
  let droppedRawEntries: unknown[] = [];
  /**
   * 所有異動序列化執行的 promise chain。
   * 需要它有兩個理由：
   * 1. 每個異動都是「讀 `rules.value` → 算出新清單 → 寫回」，並行時後寫者會
   *    覆蓋前寫者（lost update）。把讀取也放進臨界區才能避免。
   * 2. `writeRules` 失敗時會重讀磁碟修正 cache，若兩次寫入交錯，失敗的那次會
   *    把另一次尚未落盤的結果一起抹掉。
   */
  let writeChain: Promise<unknown> = Promise.resolve();

  const ruleCount = computed(() => rules.value.length);

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeChain.then(task, task);
    writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function getStore(): Promise<Store> {
    // autoSave 預設為 100ms debounce（tauri-plugin-store store.rs:68）。關掉它，
    // 讓「什麼時候真的落盤」完全由 writeRules 掌控，rollback 才有意義。
    if (!storeInstance) {
      storeInstance = await load(STORE_NAME, { defaults: {}, autoSave: false });
    }
    return storeInstance;
  }

  /**
   * 讀取磁碟上的原始規則陣列。
   *
   * `tauri-plugin-store` 的 `load()` 會**吞掉**初次讀檔／反序列化錯誤
   * （store.rs:218-224 的 `let _ = store_inner.load();`），因此「檔案毀損」或
   * 「檔案被防毒／備份軟體鎖住」都會偽裝成「空 store」。若照單全收，使用者
   * 下一次新增規則就會把磁碟上的規則整份覆蓋掉。這裡明確重讀一次讓錯誤浮出，
   * 只有「檔案不存在」才視為合法的空 store。
   */
  async function readRawRules(): Promise<unknown> {
    const store = await getStore();
    try {
      await store.reload({ ignoreDefaults: true });
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
      return undefined;
    }
    return store.get<unknown>(RULES_KEY);
  }

  async function reload(): Promise<void> {
    try {
      const saved = await readRawRules();
      const sanitized = sanitizeRuleList(saved);
      rules.value = sanitized.rules;
      droppedRawEntries = sanitized.dropped;
      isLoaded.value = true;
    } catch (error) {
      // fail-open：讀取失敗不阻斷主流程，視為無規則（但 CRUD 會被 fail-closed 擋下）
      console.warn("[replacement-store] load failed:", error);
      captureError(error, { source: "replacement", step: "load" });
      rules.value = [];
      droppedRawEntries = [];
      isLoaded.value = false;
    }
  }

  /** 回傳是否已成功載入；呼叫端據此決定要不要放行寫入。 */
  async function ensureLoaded(): Promise<boolean> {
    if (isLoaded.value) return true;
    await reload();
    return isLoaded.value;
  }

  function validateRuleInput(
    patterns: string[],
    replacement: string,
    isRegex: boolean,
  ): RuleValidationResult {
    return validateReplacementRuleInput(patterns, replacement, isRegex);
  }

  /**
   * 寫入規則清單。
   *
   * `tauri-plugin-store` 的 `set()` 只改後端記憶體 cache，而 `save()` 失敗
   * **不會**自動還原 → 失敗的變更會在下次讀取時復活，甚至被之後某次成功的
   * `save()` 落盤。因此這裡在失敗時主動修正 cache，讓寫入對外呈現「全有或全無」。
   */
  async function writeRules(nextRules: readonly unknown[]): Promise<void> {
    const store = await getStore();
    // get() 走 IPC 序列化，拿到的是深拷貝快照，不會被後續 set() 影響
    const previous = await store.get<unknown>(RULES_KEY);
    try {
      await store.set(RULES_KEY, [...nextRules]);
      await store.save();
    } catch (error) {
      // 先以磁碟內容重建 cache：不需要猜 previous，也不會把可能過期的 cache
      // 寫回磁碟。只有當磁碟本身已讀不回來（例如 save 寫到一半失敗把檔案截斷），
      // 才用進入時的快照嘗試修復——plugin 用非原子的 fs::write，這是唯一補救途徑。
      try {
        await store.reload({ ignoreDefaults: true });
      } catch (reloadError) {
        if (!isFileNotFoundError(reloadError)) {
          try {
            if (previous === undefined) await store.delete(RULES_KEY);
            else await store.set(RULES_KEY, previous);
            await store.save();
          } catch (rollbackError) {
            captureError(rollbackError, {
              source: "replacement",
              step: "persist-rollback",
            });
          }
        }
      }
      throw error;
    }
  }

  async function persist(
    nextRules: readonly ReplacementRule[],
    nextDropped: readonly unknown[],
  ): Promise<void> {
    // 接回 sanitizer 丟棄的原始項目，避免它們被這次寫入從檔案中永久刪除
    await writeRules([...nextRules, ...nextDropped]);
  }

  async function commitRules(
    nextRules: ReplacementRule[],
    step: string,
    nextDropped: unknown[] = droppedRawEntries,
  ): Promise<RuleValidationResult> {
    try {
      await persist(nextRules, nextDropped);
      // 只有落盤成功才更新記憶體狀態，避免失敗的匯入污染 droppedRawEntries
      rules.value = nextRules;
      droppedRawEntries = nextDropped;
      void emitEvent(REPLACEMENTS_CHANGED);
      return { valid: true };
    } catch (error) {
      captureError(error, { source: "replacement", step });
      return { valid: false, error: "persistence-failed" };
    }
  }

  /**
   * 一次性遷移：替缺少／不合法 `createdAt` 的規則補上時間並正規化。
   *
   * 刻意以「原始陣列」為基礎逐筆改寫，**不經 `sanitizeRuleList`**——後者會丟棄
   * 損毀／超限規則與未知欄位，若把清洗結果寫回等於把那些資料永久刪除。
   * 整批共用同一個 fallback 時間戳，讓同時遷移的規則時間一致。
   *
   * 只由 Dashboard（`main-window.ts`）在 `app.mount()` 之前呼叫一次：此時沒有
   * 任何 UI 能做 CRUD，且 HUD 不執行遷移，因此不會發生跨視窗 read-modify-write
   * 互相覆蓋。不廣播 `replacements:changed`（規則內容未變，HUD 也不用 createdAt）。
   */
  async function migrateRuleCreatedAt(): Promise<void> {
    return enqueue(async () => {
      try {
        const saved = await readRawRules();
        if (!Array.isArray(saved)) return;

        const fallbackCreatedAt = new Date().toISOString();
        let changed = false;
        const migrated = saved.map((item) => {
          if (typeof item !== "object" || item === null) return item;
          const record = item as Record<string, unknown>;
          const normalized =
            normalizeCreatedAt(record.createdAt) ?? fallbackCreatedAt;
          if (normalized === record.createdAt) return item;
          changed = true;
          return { ...record, createdAt: normalized };
        });
        if (!changed) return;

        await writeRules(migrated);
        await reload();
      } catch (error) {
        // 遷移失敗不可阻斷啟動；規則仍能以記憶體補值運作（每次啟動時間會不同）
        console.warn("[replacement-store] createdAt migration failed:", error);
        captureError(error, {
          source: "replacement",
          step: "migrate-created-at",
        });
      }
    });
  }

  async function addRule(
    input: Omit<ReplacementRule, "id" | "createdAt">,
  ): Promise<RuleValidationResult> {
    return enqueue(async () => {
      if (!(await ensureLoaded())) {
        return { valid: false, error: "load-failed" };
      }
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
        createdAt: new Date().toISOString(),
      };
      return commitRules([...rules.value, rule], "add");
    });
  }

  async function updateRule(
    id: string,
    patch: Partial<Omit<ReplacementRule, "id" | "createdAt">>,
  ): Promise<RuleValidationResult> {
    return enqueue(async () => {
      if (!(await ensureLoaded())) {
        return { valid: false, error: "load-failed" };
      }
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
    });
  }

  /**
   * 刪除規則。回傳結構化結果而非 boolean：載入失敗、找不到規則、寫入失敗
   * 是三種不同狀況，壓成同一個 `false` 會讓 UI 對 fail-closed 顯示
   * 「儲存失敗，請稍後再試」，使用者只會不斷重試而永遠不會成功。
   */
  async function removeRule(id: string): Promise<RuleValidationResult> {
    return enqueue(async () => {
      if (!(await ensureLoaded())) {
        return { valid: false, error: "load-failed" };
      }
      const next = rules.value.filter((r) => r.id !== id);
      if (next.length === rules.value.length) {
        return { valid: false, error: "not-found" };
      }
      return commitRules(next, "remove");
    });
  }

  /**
   * 匯出目前規則（備份用）。
   * 載入失敗時 **throw**：否則備份會靜默寫出空清單，使用者會拿到一份看似成功、
   * 實際遺漏所有取代規則的備份檔。
   * 一併排入 `writeChain`，避免在某次寫入尚未落盤時讀到過期的 `rules.value`。
   */
  async function exportRules(): Promise<ReplacementRule[]> {
    return enqueue(async () => {
      if (!(await ensureLoaded())) {
        throw new Error("REPLACEMENTS_LOAD_FAILED");
      }
      return [...rules.value];
    });
  }

  /**
   * 以匯入的規則整批取代（備份還原用）。
   * 沿用 sanitizeRuleList 丟棄不合法規則，並套用筆數上限，
   * 避免壞掉的備份檔寫入無法在 UI 修復的規則或超量資料。
   *
   * 刻意**不**在 `ensureLoaded()` 上把關：這是整批取代、完全不讀 `rules.value`，
   * 目前載入狀態與寫入的正確性無關。舊備份缺 `createdAt` 時整批補同一個時間戳；
   * 新備份帶有合法時間則原樣保留（僅正規化格式）。
   * 被丟棄的備份項目改由 `droppedRawEntries` 承接，避免還原後又靜默刪掉備份內容。
   */
  async function importRules(value: unknown): Promise<RuleValidationResult> {
    return enqueue(async () => {
      const sanitized = sanitizeRuleList(value);
      return commitRules(
        sanitized.rules.slice(0, MAX_REPLACEMENT_RULES),
        "import",
        sanitized.dropped,
      );
    });
  }

  return {
    rules,
    ruleCount,
    ensureLoaded,
    reload,
    migrateRuleCreatedAt,
    addRule,
    updateRule,
    removeRule,
    validateRuleInput,
    exportRules,
    importRules,
  };
});
