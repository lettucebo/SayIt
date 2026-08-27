import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: mocks.open,
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: mocks.captureError,
}));

import { openExternalUrl } from "../../src/lib/externalLink";

describe("openExternalUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
  });

  it("[P1] 應使用系統預設瀏覽器開啟 HTTPS URL", async () => {
    const result = await openExternalUrl(
      "https://github.com/lettucebo/SayIt/releases",
    );

    expect(result).toBe(true);
    expect(mocks.open).toHaveBeenCalledWith(
      "https://github.com/lettucebo/SayIt/releases",
    );
  });

  it.each([undefined, null, ""] as const)(
    "[P2] 空 URL %s 應安全略過",
    async (url) => {
      await expect(openExternalUrl(url)).resolves.toBe(false);
      expect(mocks.open).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://example.com",
    "file:///tmp/test",
    "javascript:alert(1)",
    "mailto:user@example.com",
  ])("[P1] 應拒絕非 HTTPS URL：%s", async (url) => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(openExternalUrl(url)).resolves.toBe(false);

    expect(mocks.open).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("[P2] 格式錯誤的 URL 應回報並安全失敗", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(openExternalUrl("not a url")).resolves.toBe(false);

    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.captureError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("[P1] Tauri 以純字串 reject 時應回報且不向呼叫端拋錯", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.open.mockRejectedValue("shell scope denied");

    await expect(
      openExternalUrl("https://github.com/lettucebo/SayIt/releases"),
    ).resolves.toBe(false);

    expect(mocks.captureError).toHaveBeenCalledWith("shell scope denied", {
      source: "external-link",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[external-link] Failed to open URL: shell scope denied",
    );
    consoleError.mockRestore();
  });
});
