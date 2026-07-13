import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogInfoLine = vi.fn();
vi.mock("../../src/lib/logger", () => ({
  logInfoLine: (msg: string) => mockLogInfoLine(msg),
}));

import { observeSemanticDrift } from "../../src/lib/semanticDriftObserver";

describe("observeSemanticDrift (a5-B shadow 觀測)", () => {
  beforeEach(() => {
    mockLogInfoLine.mockClear();
  });

  it("[P1] 偵測到語意漂移時記一筆 content-free log（不含任何文字內容）", () => {
    const raw = "把會議改到星期五並通知大家準時出席";
    // 與 raw 完全無關 → bigram 重疊近 0 → drift
    const enhanced = "今天陽光普照適合出門散步順便買杯咖啡";

    observeSemanticDrift(raw, enhanced, "main", {
      locale: "zh-TW",
      promptMode: "minimal",
      provider: "groq",
      model: "qwen/qwen3.6-27b",
    });

    expect(mockLogInfoLine).toHaveBeenCalledTimes(1);
    const msg = mockLogInfoLine.mock.calls[0][0] as string;
    expect(msg).toContain("[semantic-drift-shadow]");
    expect(msg).toContain("path=main");
    expect(msg).toContain("wouldFallback=true");
    expect(msg).toContain("provider=groq");
    // content-free：絕不含原文或整理後文字
    expect(msg).not.toContain(raw);
    expect(msg).not.toContain(enhanced);
  });

  it("[P1] 無漂移（enhanced 貼近 raw）時不記 log、不改任何行為", () => {
    const raw = "把會議改到星期五並通知大家";
    observeSemanticDrift(raw, raw, "resend", {});
    expect(mockLogInfoLine).not.toHaveBeenCalled();
  });

  it("[P2] 長度守衛已 fallback（enhanced === raw）的情境天然不觸發", () => {
    const raw = "這是一段夠長的測試逐字稿內容";
    observeSemanticDrift(raw, raw, "history", { provider: "azure" });
    expect(mockLogInfoLine).not.toHaveBeenCalled();
  });

  it("[P2] 極短原文（< 門檻）不判定 drift", () => {
    observeSemanticDrift("你好", "完全不同的內容啦", "main", {});
    expect(mockLogInfoLine).not.toHaveBeenCalled();
  });
});
