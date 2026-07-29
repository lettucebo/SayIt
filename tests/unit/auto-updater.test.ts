import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCheck = vi.fn();
const mockInvoke = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

describe("autoUpdater.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheck.mockReset();
    mockInvoke.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[P0] 無更新時應回傳 up-to-date", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "up-to-date" });
    expect(mockCheck).toHaveBeenCalledOnce();
  });

  it("[P0] 有更新時應回傳 update-available 且不觸發下載", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
    });

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "update-available", version: "1.2.0" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("[P0] check 失敗應回傳 error 結果且不拋錯", async () => {
    mockCheck.mockRejectedValue(new Error("Network error"));

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "error", error: "Network error" });
    expect(console.error).toHaveBeenCalledWith(
      "[autoUpdater] Update check failed:",
      "Network error",
    );
  });

  it("[P0] downloadUpdate 應只下載不安裝", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn();
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadUpdate();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("[P0] installAndRelaunch 應安裝並重啟", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadUpdate, installAndRelaunch } =
      await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();
    await downloadUpdate();
    await installAndRelaunch();

    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("request_app_restart");
  });

  it("[P0] downloadInstallAndRelaunch 應一鍵完成", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadInstallAndRelaunch } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadInstallAndRelaunch();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("request_app_restart");
  });

  it("[P0] 無暫存更新時 downloadUpdate 應拋錯", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("No pending update");
  });

  it("[P0] 下載失敗時 downloadUpdate 應拋錯", async () => {
    const mockDownload = vi
      .fn()
      .mockRejectedValue(new Error("Download failed"));
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("Download failed");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  describe("啟動檢查失敗的重試策略", () => {
    it("[P0] 重試階梯必須維持 1／5／15 分鐘、最多 3 次（防止改回頻繁輪詢）", async () => {
      const { AUTO_CHECK_RETRY_DELAYS_MS } = await import(
        "../../src/lib/updateRetryPolicy"
      );

      // 使用者需求是「啟動時檢查一次就好」，重試只是失敗時的補救，
      // 這些數值一旦被縮短就會退化成背景輪詢
      expect(AUTO_CHECK_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 900_000]);
      expect(AUTO_CHECK_RETRY_DELAYS_MS).toHaveLength(3);
    });

    it("[P1] 每次重試延遲應遞增（退避），避免離線時密集重試", async () => {
      const { AUTO_CHECK_RETRY_DELAYS_MS, getAutoCheckRetryDelayMs } =
        await import("../../src/lib/updateRetryPolicy");

      for (let i = 0; i < AUTO_CHECK_RETRY_DELAYS_MS.length; i += 1) {
        expect(getAutoCheckRetryDelayMs(i)).toBe(AUTO_CHECK_RETRY_DELAYS_MS[i]);
      }

      const delays = AUTO_CHECK_RETRY_DELAYS_MS;
      for (let i = 1; i < delays.length; i += 1) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]!);
      }
    });

    it("[P0] 重試次數用盡應回傳 null，讓呼叫端停止重試（不得變成無限輪詢）", async () => {
      const { AUTO_CHECK_RETRY_DELAYS_MS, getAutoCheckRetryDelayMs } =
        await import("../../src/lib/updateRetryPolicy");

      expect(getAutoCheckRetryDelayMs(AUTO_CHECK_RETRY_DELAYS_MS.length)).toBeNull();
      expect(getAutoCheckRetryDelayMs(999)).toBeNull();
    });

    it("[P0] 重試策略不得依賴 updater plugin（catch 路徑也要能排重試）", async () => {
      const policy = await import("../../src/lib/updateRetryPolicy");

      expect(typeof policy.getAutoCheckRetryDelayMs).toBe("function");
      expect(mockCheck).not.toHaveBeenCalled();
    });
  });

  it("[P0] check 應帶 timeout，避免請求不 settle 導致狀態永久卡在 checking", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();

    expect(mockCheck).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    const [options] = mockCheck.mock.calls[0] as [{ timeout: number }];
    expect(options.timeout).toBeGreaterThan(0);
  });
});
