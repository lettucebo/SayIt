import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createReplacementRule } from "../support/factories";

const h = vi.hoisted(() => {
  let savedRules: unknown[] | undefined;
  let failSave = false;
  let failGet = false;
  const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
  const mockCaptureError = vi.fn();
  const store = {
    get: vi.fn(async (key: string) => {
      if (failGet) throw new Error("load failed");
      return key === "rules" ? savedRules : undefined;
    }),
    set: vi.fn(async (key: string, value: unknown[]) => {
      if (key === "rules") savedRules = value;
    }),
    save: vi.fn(async () => {
      if (failSave) throw new Error("save failed");
    }),
  };

  return {
    store,
    mockEmitEvent,
    mockCaptureError,
    get savedRules() {
      return savedRules;
    },
    set savedRules(value: unknown[] | undefined) {
      savedRules = value;
    },
    get failSave() {
      return failSave;
    },
    set failSave(value: boolean) {
      failSave = value;
    },
    get failGet() {
      return failGet;
    },
    set failGet(value: boolean) {
      failGet = value;
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
  MAX_TOTAL_PATTERN_CHARS_PER_RULE,
  useReplacementStore,
} from "../../src/stores/useReplacementStore";

describe("useReplacementStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.savedRules = [];
    h.failSave = false;
    h.failGet = false;
    h.store.get.mockClear();
    h.store.set.mockClear();
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

    await expect(store.removeRule(id)).resolves.toBe(true);
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

  it("[P1] addRule 記錄建立時間", async () => {
    const before = Date.now();
    const store = useReplacementStore();

    await store.addRule({
      patterns: ["ts"],
      replacement: "TypeScript",
      isRegex: false,
      timing: "beforeAI",
      enabled: true,
    });

    const createdAt = store.rules[0].createdAt;
    expect(typeof createdAt).toBe("number");
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("[P1] 舊資料缺 createdAt 仍可載入；非數值的 createdAt 被丟棄", async () => {
    const legacy = createReplacementRule({ patterns: ["legacy"] });
    const withTimestamp = createReplacementRule({
      patterns: ["new"],
      createdAt: 1700000000000,
    });
    h.savedRules = [
      legacy,
      withTimestamp,
      { ...createReplacementRule({ patterns: ["bad"] }), createdAt: "昨天" },
      { ...createReplacementRule({ patterns: ["nan"] }), createdAt: Number.NaN },
    ];
    const store = useReplacementStore();

    await store.reload();

    expect(store.rules).toHaveLength(4);
    expect(store.rules[0].createdAt).toBeUndefined();
    expect(store.rules[1].createdAt).toBe(1700000000000);
    // 型別錯誤或非有限數值一律丟棄，不讓壞資料流進排序邏輯
    expect(store.rules[2].createdAt).toBeUndefined();
    expect(store.rules[3].createdAt).toBeUndefined();
  });

  it("[P0] moveRule 調整套用順序並持久化", async () => {
    const first = createReplacementRule({ patterns: ["一儀錶板"] });
    const second = createReplacementRule({ patterns: ["儀錶板"] });
    h.savedRules = [first, second];
    const store = useReplacementStore();
    await store.ensureLoaded();

    await expect(store.moveRule(second.id, "up")).resolves.toBe(true);
    expect(store.rules.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(h.savedRules).toEqual([second, first]);
    expect(h.mockEmitEvent).toHaveBeenCalledWith("replacements:changed");

    await expect(store.moveRule(second.id, "down")).resolves.toBe(true);
    expect(store.rules.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it("[P1] moveRule 在邊界與未知 id 時回傳 false 且不寫入", async () => {
    const first = createReplacementRule({ patterns: ["a"] });
    const second = createReplacementRule({ patterns: ["b"] });
    h.savedRules = [first, second];
    const store = useReplacementStore();
    await store.ensureLoaded();
    h.store.set.mockClear();

    await expect(store.moveRule(first.id, "up")).resolves.toBe(false);
    await expect(store.moveRule(second.id, "down")).resolves.toBe(false);
    await expect(store.moveRule("does-not-exist", "up")).resolves.toBe(false);

    expect(h.store.set).not.toHaveBeenCalled();
    expect(store.rules.map((r) => r.id)).toEqual([first.id, second.id]);
  });
});
