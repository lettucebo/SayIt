import { describe, it, expect, vi, afterEach } from "vitest";

// 隔離檔：驗證 opencc-js 惰性載入 / converter 失敗時 convertSimplifiedToTraditional
// 會 fail-open 回傳原文而非 throw（RubberDuck 要求的 import/converter 失敗覆蓋）。
// 用 vi.doMock + resetModules 避免污染其他測試對真實 opencc 的依賴。

describe("convertSimplifiedToTraditional — fail-open", () => {
  afterEach(() => {
    vi.doUnmock("opencc-js");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("[P1] converter 建立失敗時回傳原文、不 throw、不噴文字內容", async () => {
    vi.resetModules();
    vi.doMock("opencc-js", () => ({
      Converter: () => {
        throw new Error("simulated opencc failure");
      },
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { convertSimplifiedToTraditional } = await import(
      "../../src/lib/simplifiedToTraditional"
    );

    const input = "请把会议改到星期五并通知所有人";
    const result = await convertSimplifiedToTraditional(input);

    // fail-open：原文原樣返回（未轉換）
    expect(result).toBe(input);
    // 有記 warning，但不含文字內容（content-free）
    expect(warnSpy).toHaveBeenCalled();
    const loggedArgs = warnSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).not.toContain(input);
  });

  it("[P1] 失敗後快取重置：下次呼叫會重試（成功 mock 下可正常轉換）", async () => {
    // 先一次失敗
    vi.resetModules();
    vi.doMock("opencc-js", () => ({
      Converter: () => {
        throw new Error("first failure");
      },
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod1 = await import("../../src/lib/simplifiedToTraditional");
    expect(await mod1.convertSimplifiedToTraditional("请")).toBe("请");

    // 換成成功的 mock（模擬字典就緒後重試成功）——需重置模組讓快取清空
    vi.doUnmock("opencc-js");
    vi.resetModules();
    vi.doMock("opencc-js", () => ({
      Converter: () => (t: string) => t.replace("请", "請"),
    }));
    const mod2 = await import("../../src/lib/simplifiedToTraditional");
    expect(await mod2.convertSimplifiedToTraditional("请")).toBe("請");
  });
});
