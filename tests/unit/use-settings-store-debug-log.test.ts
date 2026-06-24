import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockStoreData = new Map<string, unknown>();
const mockStoreGet = vi.fn(async (key: string) => mockStoreData.get(key));
const mockStoreSet = vi.fn(async (key: string, value: unknown) => {
  mockStoreData.set(key, value);
});
const mockStoreDelete = vi.fn(async (key: string) => {
  mockStoreData.delete(key);
});
const mockStoreSave = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mockStoreGet,
    set: mockStoreSet,
    delete: mockStoreDelete,
    save: mockStoreSave,
  })),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({ emit: mockEmit }));

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
}));

describe("useSettingsStore debug log", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockStoreDelete.mockClear();
    mockStoreSave.mockClear();
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockEmit.mockClear().mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("[P0] saveDebugLog 應持久化 enabled + days 並儲存", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveDebugLog(true, 14);

    expect(mockStoreSet).toHaveBeenCalledWith("debugLogEnabled", true);
    expect(mockStoreSet).toHaveBeenCalledWith("debugLogRetentionDays", 14);
    expect(mockStoreSave).toHaveBeenCalled();
  });

  it("[P0] saveDebugLog 應更新 reactive refs", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveDebugLog(true, 10);

    expect(store.isDebugLogEnabled).toBe(true);
    expect(store.debugLogRetentionDays).toBe(10);
  });

  it("[P0] saveDebugLog 應透過 invoke 通知 Rust 切換開關", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveDebugLog(true, 7);

    expect(mockInvoke).toHaveBeenCalledWith("set_file_logging_enabled", {
      enabled: true,
    });
  });

  it("[P1] saveDebugLog days < 1 應 fallback 到預設值 7", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveDebugLog(true, 0);

    expect(store.debugLogRetentionDays).toBe(7);
    expect(mockStoreSet).toHaveBeenCalledWith("debugLogRetentionDays", 7);
  });

  it("[P1] saveDebugLog 非整數天數應 fallback 到預設值 7", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveDebugLog(true, 3.5);

    expect(store.debugLogRetentionDays).toBe(7);
  });

  it("[P0] loadSettings 無儲存值時 debug log 應預設關閉 / 7 天", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.loadSettings();

    expect(store.isDebugLogEnabled).toBe(false);
    expect(store.debugLogRetentionDays).toBe(7);
  });

  it("[P0] loadSettings 應載入已儲存的 debug log 設定", async () => {
    mockStoreData.set("debugLogEnabled", true);
    mockStoreData.set("debugLogRetentionDays", 30);

    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.loadSettings();

    expect(store.isDebugLogEnabled).toBe(true);
    expect(store.debugLogRetentionDays).toBe(30);
  });
});
