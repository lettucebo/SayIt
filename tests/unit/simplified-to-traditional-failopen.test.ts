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

  it("[P1] 失敗後快取重置：同一模組實例下次呼叫會重試（真正覆蓋 reset 邏輯）", async () => {
    vi.resetModules();
    let calls = 0;
    vi.doMock("opencc-js", () => ({
      Converter: () => {
        // 第一次建立 converter 失敗、第二次成功——驗證 converterPromise 被重置後會重試
        if (++calls === 1) throw new Error("first failure");
        return (t: string) => t.replace("请", "請");
      },
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await import("../../src/lib/simplifiedToTraditional");
    // 第一次：converter 建立失敗 → fail-open 回原文，且 converterPromise 被重置為 null
    expect(await mod.convertSimplifiedToTraditional("请")).toBe("请");
    // 第二次：若少了 reset，會拿到快取的 rejected promise 續 fail-open 回 "请"；
    // 有 reset 才會重建、命中成功 mock → "請"（此斷言即 reset 邏輯的守衛）
    expect(await mod.convertSimplifiedToTraditional("请")).toBe("請");
  });
});
