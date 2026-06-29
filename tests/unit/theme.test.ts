import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockStoreData = new Map<string, unknown>();
const mockStoreGet = vi.fn(async (key: string) => mockStoreData.get(key));
const mockStoreSet = vi.fn(async (key: string, value: unknown) => {
  mockStoreData.set(key, value);
});
const mockStoreSave = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
  })),
}));

function stubMatchMedia(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("theme lib", () => {
  beforeEach(() => {
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockStoreSave.mockClear();
    document.documentElement.classList.remove("dark");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[P0] isThemeMode 只接受 light/dark/system", async () => {
    const { isThemeMode } = await import("../../src/lib/theme");
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("blue")).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });

  it("[P0] resolveTheme: system 依系統偏好 (dark)", async () => {
    stubMatchMedia(true);
    const { resolveTheme } = await import("../../src/lib/theme");
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("[P0] resolveTheme: system 依系統偏好 (light)", async () => {
    stubMatchMedia(false);
    const { resolveTheme } = await import("../../src/lib/theme");
    expect(resolveTheme("system")).toBe("light");
  });

  it("[P0] applyTheme('dark') 加上 .dark；applyTheme('light') 移除", async () => {
    stubMatchMedia(false);
    const { applyTheme } = await import("../../src/lib/theme");
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("[P0] initThemeFromStore 無儲存值時 fallback 為 system", async () => {
    stubMatchMedia(true);
    const { initThemeFromStore } = await import("../../src/lib/theme");
    const mode = await initThemeFromStore();
    expect(mode).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("[P0] initThemeFromStore 讀取已儲存的 themeMode", async () => {
    stubMatchMedia(true);
    mockStoreData.set("themeMode", "light");
    const { initThemeFromStore } = await import("../../src/lib/theme");
    const mode = await initThemeFromStore();
    expect(mode).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
