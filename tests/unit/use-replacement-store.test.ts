import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createReplacementRule } from "../support/factories";

const h = vi.hoisted(() => {
  const clone = <T>(value: T): T =>
    value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

  // 依 tauri-plugin-store 的真實語意分開模擬「磁碟」與「記憶體 cache」：
  // set() 只改 cache、save() 才落盤、reload() 才把磁碟讀回 cache。
  let diskRules: unknown[] | undefined;
  let cacheRules: unknown[] | undefined;
  let failSave = false;
  /** 模擬檔案毀損／被鎖住：reload 丟出非 not-found 的錯誤 */
  let failRead = false;
  /** 模擬全新安裝：檔案不存在，reload 丟出帶 "(os error 2)" 的錯誤 */
  let fileMissing = false;
  const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
  const mockCaptureError = vi.fn();
  const store = {
    get: vi.fn(async (key: string) =>
      key === "rules" ? clone(cacheRules) : undefined,
    ),
    set: vi.fn(async (key: string, value: unknown) => {
      if (key === "rules") cacheRules = clone(value) as unknown[];
    }),
    delete: vi.fn(async (key: string) => {
      if (key === "rules") cacheRules = undefined;
    }),
    reload: vi.fn(async () => {
      if (failRead) throw new Error("failed to deserialize store");
      if (fileMissing) {
        throw new Error(
          "The system cannot find the file specified. (os error 2)",
        );
      }
      cacheRules = clone(diskRules);
    }),
    save: vi.fn(async () => {
      if (failSave) throw new Error("save failed");
      diskRules = clone(cacheRules);
      fileMissing = false;
    }),
  };

  return {
    store,
    mockEmitEvent,
    mockCaptureError,
    /** 磁碟上的內容（測試的 seed 與斷言對象） */
    get savedRules() {
      return diskRules;
    },
    set savedRules(value: unknown[] | undefined) {
      diskRules = value;
      cacheRules = clone(value);
      fileMissing = value === undefined;
    },
    get failSave() {
      return failSave;
    },
    set failSave(value: boolean) {
      failSave = value;
    },
    get failGet() {
      return failRead;
    },
    set failGet(value: boolean) {
      failRead = value;
    },
    get fileMissing() {
      return fileMissing;
    },
    set fileMissing(value: boolean) {
      fileMissing = value;
    },
  };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue(h.store),
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: h.mockEmitEvent,
  REPLACEMENTS_CHANGED: "replacements:changed",
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: h.mockCaptureError,
}));

import {
  MAX_PATTERNS_PER_RULE,
  MAX_PATTERN_LENGTH,
  MAX_TOTAL_PATTERN_CHARS_PER_RULE,
  useReplacementStore,
} from "../../src/stores/useReplacementStore";

describe("useReplacementStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.savedRules = [];
    h.failSave = false;
    h.failGet = false;
    h.fileMissing = false;
    h.store.get.mockClear();
    h.store.set.mockClear();
    h.store.delete.mockClear();
    h.store.reload.mockClear();
    h.store.save.mockClear();
    h.mockEmitEvent.mockClear();
    h.mockCaptureError.mockClear();
  });

  it("[P1] CRUD 成功後才更新 state 並廣播 replacements changed", async () => {
    const store = useReplacementStore();

    const added = await store.addRule({
      patterns: ["copilot", "copy lot"],
      replacement: "Copilot",
      isRegex: false,
      timing: "beforeAI",
      enabled: true,
    });
    expect(added).toEqual({ valid: true });
    expect(store.rules).toHaveLength(1);
    expect(h.mockEmitEvent).toHaveBeenCalledWith("replacements:changed");

    const id = store.rules[0].id;
    const updated = await store.updateRule(id, {
      replacement: "GitHub Copilot",
      enabled: false,
    });
    expect(updated).toEqual({ valid: true });
    expect(store.rules[0]).toMatchObject({
      replacement: "GitHub Copilot",
      enabled: false,
    });

    await expect(store.removeRule(id)).resolves.toEqual({ valid: true });
    expect(store.rules).toHaveLength(0);
    expect(h.mockEmitEvent).toHaveBeenCalledTimes(3);
  });

  it("[P1] 驗證錯誤碼涵蓋空 pattern、過長、無效正則與過多規則", () => {
    const store = useReplacementStore();

    expect(store.validateRuleInput([], "", false)).toEqual({
      valid: false,
      error: "empty-patterns",
    });
    expect(store.validateRuleInput(["x".repeat(201)], "", false)).toEqual({
      valid: false,
      error: "pattern-too-long",
    });
    expect(store.validateRuleInput(["("], "", true)).toEqual({
      valid: false,
      error: "invalid-regex",
    });
    expect(
      store.validateRuleInput(Array.from({ length: MAX_PATTERNS_PER_RULE + 1 }, (_, i) => `p${i}`), "", false),
    ).toEqual({ valid: false, error: "too-many-patterns" });
    expect(
      store.validateRuleInput(
        Array.from({ length: 11 }, () =>
          "x".repeat(Math.ceil(MAX_TOTAL_PATTERN_CHARS_PER_RULE / 10)),
        ),
        "",
        false,
      ),
    ).toEqual({ valid: false, error: "patterns-total-too-long" });
  });

  it("[P1] persist 失敗時 rollback，回傳 persistence-failed 且不廣播", async () => {
    const existing = createReplacementRule({
      patterns: ["old"],
      replacement: "OLD",
    });
    h.savedRules = [existing];
    const store = useReplacementStore();
    await store.ensureLoaded();

    h.failSave = true;
    const result = await store.addRule({
      patterns: ["new"],
      replacement: "NEW",
      isRegex: false,
      timing: "beforeAI",
      enabled: true,
    });

    expect(result).toEqual({ valid: false, error: "persistence-failed" });
    expect(store.rules).toEqual([existing]);
    expect(h.mockEmitEvent).not.toHaveBeenCalled();
    expect(h.mockCaptureError).toHaveBeenCalled();
  });

  it("[P1] ensureLoaded 失敗不永久標記 loaded；下次可重試", async () => {
    const persisted = createReplacementRule({
      patterns: ["retry"],
      replacement: "Retry",
    });
    const store = useReplacementStore();

    h.failGet = true;
    await store.ensureLoaded();
    expect(store.rules).toEqual([]);

    h.failGet = false;
    h.savedRules = [persisted];
    await store.ensureLoaded();
    expect(store.rules).toEqual([persisted]);
  });

  it("[P1] reload 重新讀取並過濾舊資料中不合法與超限 pattern", async () => {
    const valid = createReplacementRule({
      patterns: ["ok"],
      replacement: "OK",
    });
    const tooManyPatterns = createReplacementRule({
      patterns: Array.from({ length: MAX_PATTERNS_PER_RULE + 1 }, (_, i) => `p${i}`),
      replacement: "bad",
    });
    h.savedRules = [
      valid,
      tooManyPatterns,
      { ...valid, id: 123 },
    ];
    const store = useReplacementStore();

    await store.reload();

    expect(store.rules).toEqual([valid]);
  });

  describe("createdAt", () => {
    it("[P1] addRule 產生 ISO 8601 UTC 建立時間，updateRule 不會覆寫", async () => {
      const store = useReplacementStore();

      await store.addRule({
        patterns: ["copilot"],
        replacement: "Copilot",
        isRegex: false,
        timing: "beforeAI",
        enabled: true,
      });

      const created = store.rules[0].createdAt;
      expect(created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

      await store.updateRule(store.rules[0].id, { replacement: "GitHub" });
      expect(store.rules[0].createdAt).toBe(created);
      expect(store.rules[0].replacement).toBe("GitHub");
    });

    it("[P1] 舊資料缺 createdAt 時整批補同一個時間戳，且規則不被丟棄", async () => {
      const legacyA = createReplacementRule({ patterns: ["a"] });
      const legacyB = createReplacementRule({ patterns: ["b"] });
      delete (legacyA as Partial<typeof legacyA>).createdAt;
      delete (legacyB as Partial<typeof legacyB>).createdAt;
      h.savedRules = [legacyA, legacyB];

      const store = useReplacementStore();
      await store.reload();

      expect(store.rules).toHaveLength(2);
      expect(store.rules[0].createdAt).toBe(store.rules[1].createdAt);
      expect(Number.isNaN(Date.parse(store.rules[0].createdAt))).toBe(false);
    });

    it("[P1] 不合法的 createdAt 會被補值而非讓規則被丟棄", async () => {
      h.savedRules = [
        createReplacementRule({ patterns: ["bad"], createdAt: "not-a-date" }),
        createReplacementRule({ patterns: ["num"] }),
      ];
      (h.savedRules[1] as Record<string, unknown>).createdAt = 12345;

      const store = useReplacementStore();
      await store.reload();

      expect(store.rules).toHaveLength(2);
      for (const rule of store.rules) {
        expect(Number.isNaN(Date.parse(rule.createdAt))).toBe(false);
      }
    });

    it("[P1] sanitize 會把非 canonical 的時間字串正規化為 ISO UTC", async () => {
      h.savedRules = [
        createReplacementRule({
          patterns: ["norm"],
          createdAt: "2026-01-02T03:04:05.000+00:00",
        }),
      ];

      const store = useReplacementStore();
      await store.reload();

      expect(store.rules[0].createdAt).toBe("2026-01-02T03:04:05.000Z");
    });

    it("[P1] 遷移只補 createdAt，不刪除 sanitizer 會忽略的損毀規則", async () => {
      const valid = createReplacementRule({ patterns: ["keep"] });
      delete (valid as Partial<typeof valid>).createdAt;
      const broken = { id: 123, patterns: ["broken"] };
      h.savedRules = [valid, broken];

      const store = useReplacementStore();
      await store.migrateRuleCreatedAt();

      const persisted = h.savedRules as Record<string, unknown>[];
      expect(persisted).toHaveLength(2);
      expect(typeof persisted[0].createdAt).toBe("string");
      // 損毀規則仍留在檔案裡（只有記憶體中的清單會過濾掉它）；
      // 遷移只會補 createdAt，不會刪除或改寫原有欄位
      expect(persisted[1]).toMatchObject(broken);
      expect(store.rules).toHaveLength(1);
      // 遷移不得廣播，避免無謂的跨視窗 reload
      expect(h.mockEmitEvent).not.toHaveBeenCalled();
    });

    it("[P2] 所有規則都已有合法 createdAt 時遷移不寫入", async () => {
      h.savedRules = [createReplacementRule({ patterns: ["done"] })];
      const store = useReplacementStore();

      await store.migrateRuleCreatedAt();

      expect(h.store.set).not.toHaveBeenCalled();
      expect(h.store.save).not.toHaveBeenCalled();
    });
  });

  describe("資料安全", () => {
    it("[P1] 載入失敗時 CRUD 一律拒絕寫入，不覆蓋磁碟資料", async () => {
      const persisted = createReplacementRule({ patterns: ["disk"] });
      h.savedRules = [persisted];
      h.failGet = true;

      const store = useReplacementStore();

      await expect(
        store.addRule({
          patterns: ["new"],
          replacement: "NEW",
          isRegex: false,
          timing: "beforeAI",
          enabled: true,
        }),
      ).resolves.toEqual({ valid: false, error: "load-failed" });
      await expect(
        store.updateRule(persisted.id, { enabled: false }),
      ).resolves.toEqual({ valid: false, error: "load-failed" });
      await expect(store.removeRule(persisted.id)).resolves.toEqual({
        valid: false,
        error: "load-failed",
      });
      await expect(store.exportRules()).rejects.toThrow(
        "REPLACEMENTS_LOAD_FAILED",
      );

      expect(h.store.set).not.toHaveBeenCalled();
      expect(h.savedRules).toEqual([persisted]);
    });

    it("[P1] save 失敗後再 reload 不得復活失敗的變更", async () => {
      const existing = createReplacementRule({ patterns: ["old"] });
      h.savedRules = [existing];
      const store = useReplacementStore();
      await store.ensureLoaded();

      h.failSave = true;
      await store.addRule({
        patterns: ["ghost"],
        replacement: "GHOST",
        isRegex: false,
        timing: "beforeAI",
        enabled: true,
      });

      h.failSave = false;
      await store.reload();

      expect(store.rules).toEqual([existing]);
      expect(h.savedRules).toEqual([existing]);
    });

    it("[P1] CRUD 不會把 sanitizer 丟棄的規則從檔案中刪除", async () => {
      const valid = createReplacementRule({ patterns: ["ok"] });
      const overLimit = createReplacementRule({
        patterns: ["x".repeat(MAX_PATTERN_LENGTH + 1)],
      });
      h.savedRules = [valid, overLimit];

      const store = useReplacementStore();
      await store.ensureLoaded();
      expect(store.rules).toEqual([valid]);

      await store.updateRule(valid.id, { enabled: false });

      // 被丟棄的超限規則仍留在檔案裡，等待未來版本或手動修復
      expect(h.savedRules).toHaveLength(2);
      expect(h.savedRules).toContainEqual(overLimit);
    });

    it("[P1] 並行的 updateRule 不會互相覆蓋（lost update）", async () => {
      const first = createReplacementRule({ patterns: ["first"] });
      const second = createReplacementRule({ patterns: ["second"] });
      h.savedRules = [first, second];

      const store = useReplacementStore();
      await store.ensureLoaded();

      await Promise.all([
        store.updateRule(first.id, { enabled: false }),
        store.updateRule(second.id, { enabled: false }),
      ]);

      expect(store.rules.map((r) => r.enabled)).toEqual([false, false]);
      expect(
        (h.savedRules as { enabled: boolean }[]).map((r) => r.enabled),
      ).toEqual([false, false]);
    });

    it("[P1] 檔案不存在（全新安裝）視為合法空 store，可正常新增規則", async () => {
      h.savedRules = undefined;
      const store = useReplacementStore();

      await store.reload();
      expect(store.rules).toEqual([]);

      const added = await store.addRule({
        patterns: ["first"],
        replacement: "First",
        isRegex: false,
        timing: "beforeAI",
        enabled: true,
      });
      expect(added).toEqual({ valid: true });
      expect(h.savedRules).toHaveLength(1);
    });

    it("[P1] 檔案毀損／被鎖住不得偽裝成空 store，且必須擋下覆蓋寫入", async () => {
      const persisted = createReplacementRule({ patterns: ["disk"] });
      h.savedRules = [persisted];
      h.failGet = true;

      const store = useReplacementStore();
      await store.reload();

      expect(store.rules).toEqual([]);
      await expect(
        store.addRule({
          patterns: ["new"],
          replacement: "NEW",
          isRegex: false,
          timing: "beforeAI",
          enabled: true,
        }),
      ).resolves.toEqual({ valid: false, error: "load-failed" });
      expect(h.savedRules).toEqual([persisted]);
    });

    it("[P1] 匯入寫入失敗不得污染 dropped 狀態，導致後續 CRUD 寫入失敗備份的內容", async () => {
      const existing = createReplacementRule({ patterns: ["existing"] });
      h.savedRules = [existing];
      const store = useReplacementStore();
      await store.ensureLoaded();

      const junkFromBackup = { id: 456, patterns: ["junk"] };
      h.failSave = true;
      await expect(
        store.importRules([junkFromBackup]),
      ).resolves.toEqual({ valid: false, error: "persistence-failed" });

      h.failSave = false;
      await store.updateRule(existing.id, { enabled: false });

      expect(h.savedRules).toHaveLength(1);
      expect(h.savedRules).not.toContainEqual(junkFromBackup);
    });
  });
});
