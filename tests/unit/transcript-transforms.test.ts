import { describe, it, expect } from "vitest";
import { convertSimplifiedToTraditional } from "../../src/lib/simplifiedToTraditional";
import {
  applyTranscriptTextTransforms,
  applyWordReplacements,
  resolveEffectiveTranscriptionLocale,
} from "../../src/lib/transcriptTransforms";
import { createReplacementRule } from "../support/factories";

describe("simplifiedToTraditional", () => {
  it("[P0] 簡體轉台灣正體", async () => {
    expect(
      await convertSimplifiedToTraditional("请把会议改到星期五并通知所有人"),
    ).toBe("請把會議改到星期五並通知所有人");
  });

  it("[P0] 已是繁體 → 原樣返回", async () => {
    expect(await convertSimplifiedToTraditional("已經是繁體")).toBe("已經是繁體");
  });

  it("[P1] 空字串原樣返回", async () => {
    expect(await convertSimplifiedToTraditional("")).toBe("");
  });
});

describe("resolveEffectiveTranscriptionLocale", () => {
  it("[P0] auto → 回退介面語言", () => {
    expect(resolveEffectiveTranscriptionLocale("auto", "zh-TW")).toBe("zh-TW");
    expect(resolveEffectiveTranscriptionLocale("auto", "en")).toBe("en");
  });

  it("[P0] 明確語言 → 沿用該語言", () => {
    expect(resolveEffectiveTranscriptionLocale("zh-TW", "en")).toBe("zh-TW");
    expect(resolveEffectiveTranscriptionLocale("ja", "en")).toBe("ja");
  });
});

describe("applyTranscriptTextTransforms", () => {
  it("[P0] zh-TW → 簡體轉繁體", async () => {
    expect(
      await applyTranscriptTextTransforms(
        "请把会议改到星期五并通知所有人",
        "zh-TW",
      ),
    ).toBe("請把會議改到星期五並通知所有人");
  });

  it("[P0] 非 zh-TW → 不轉換（zh-CN 原樣，不觸發 opencc 載入）", async () => {
    expect(await applyTranscriptTextTransforms("请把会议", "zh-CN")).toBe(
      "请把会议",
    );
    expect(await applyTranscriptTextTransforms("请把会议", "en")).toBe(
      "请把会议",
    );
  });

  it("[P1] 空字串原樣返回", async () => {
    expect(await applyTranscriptTextTransforms("", "zh-TW")).toBe("");
  });
});

describe("applyWordReplacements", () => {
  it("[P1] 字面取代大小寫不敏感 + 詞界", () => {
    const rule = createReplacementRule({
      patterns: ["latency"],
      replacement: "延遲",
    });
    expect(
      applyWordReplacements("這個 Latency 有點高", [rule], "beforeAI"),
    ).toBe("這個 延遲 有點高");
  });

  it("[P1] 詞界避免部分字串誤取代", () => {
    const rule = createReplacementRule({ patterns: ["cat"], replacement: "X" });
    expect(applyWordReplacements("category and cat", [rule], "beforeAI")).toBe(
      "category and X",
    );
  });

  it("[P1] 字面 replacement 含 $& 照字面輸出（不當 replacement 樣板）", () => {
    const rule = createReplacementRule({
      patterns: ["foo"],
      replacement: "$&bar",
    });
    expect(applyWordReplacements("foo", [rule], "beforeAI")).toBe("$&bar");
  });

  it("[P1] 中文字面精確子字串取代（無 ASCII 詞界問題）", () => {
    const rule = createReplacementRule({
      patterns: ["程式"],
      replacement: "程序",
    });
    expect(applyWordReplacements("這個程式很好", [rule], "beforeAI")).toBe(
      "這個程序很好",
    );
  });

  it("[P1] 含符號術語 C++ / .NET 可字面取代", () => {
    const cpp = createReplacementRule({ patterns: ["C++"], replacement: "cpp" });
    expect(applyWordReplacements("我用 C++ 寫", [cpp], "beforeAI")).toBe(
      "我用 cpp 寫",
    );
    const dotnet = createReplacementRule({
      patterns: [".NET"],
      replacement: "dotnet",
    });
    expect(applyWordReplacements("跑在 .NET 上", [dotnet], "beforeAI")).toBe(
      "跑在 dotnet 上",
    );
  });

  it("[P2] 英文術語緊貼中文（無空格）仍可取代", () => {
    const rule = createReplacementRule({
      patterns: ["API"],
      replacement: "介面",
    });
    expect(applyWordReplacements("這個API的設計", [rule], "beforeAI")).toBe(
      "這個介面的設計",
    );
  });

  it("[P1] 多變體任一命中皆取代為正確寫法", () => {
    const rule = createReplacementRule({
      patterns: ["raycast", "reycast", "recast"],
      replacement: "Raycast",
    });
    expect(
      applyWordReplacements("open reycast then recast", [rule], "beforeAI"),
    ).toBe("open Raycast then Raycast");
  });

  it("[P1] 正則規則支援 capture group ($1)", () => {
    const rule = createReplacementRule({
      patterns: ["(\\d+)ms"],
      replacement: "$1 毫秒",
      isRegex: true,
    });
    expect(applyWordReplacements("延遲 30ms 很高", [rule], "beforeAI")).toBe(
      "延遲 30 毫秒 很高",
    );
  });

  it("[P1] timing 過濾：beforeAI 階段不套 afterAI 規則", () => {
    const rule = createReplacementRule({
      patterns: ["latency"],
      replacement: "延遲",
      timing: "afterAI",
    });
    expect(applyWordReplacements("latency", [rule], "beforeAI")).toBe(
      "latency",
    );
    expect(applyWordReplacements("latency", [rule], "afterAI")).toBe("延遲");
  });

  it("[P2] both 時機兩階段皆套用", () => {
    const rule = createReplacementRule({
      patterns: ["k8s"],
      replacement: "Kubernetes",
      timing: "both",
    });
    expect(applyWordReplacements("用 k8s", [rule], "beforeAI")).toBe(
      "用 Kubernetes",
    );
    expect(applyWordReplacements("用 k8s", [rule], "afterAI")).toBe(
      "用 Kubernetes",
    );
  });

  it("[P1] both 規則可連續跑 beforeAI 與 afterAI 階段", () => {
    const bothRule = createReplacementRule({
      patterns: ["copilot"],
      replacement: "Copilot",
      timing: "both",
    });
    const afterRule = createReplacementRule({
      patterns: ["Copilot"],
      replacement: "GitHub Copilot™",
      timing: "afterAI",
    });

    const before = applyWordReplacements(
      "open copilot",
      [bothRule, afterRule],
      "beforeAI",
    );
    const after = applyWordReplacements(
      before,
      [bothRule, afterRule],
      "afterAI",
    );

    expect(after).toBe("open GitHub Copilot™");
  });

  it("[P1] 正則 pattern 可包含逗號量詞 {1,3}", () => {
    const rule = createReplacementRule({
      patterns: ["^\\d{1,3}$"],
      replacement: "N",
      isRegex: true,
    });

    expect(applyWordReplacements("123", [rule], "beforeAI")).toBe("N");
  });

  it("[P2] enabled=false 不套用", () => {
    const rule = createReplacementRule({
      patterns: ["latency"],
      replacement: "延遲",
      enabled: false,
    });
    expect(applyWordReplacements("latency", [rule], "beforeAI")).toBe(
      "latency",
    );
  });

  it("[P2] 無效正則 fail-open：不丟錯、略過該 pattern", () => {
    const rule = createReplacementRule({
      patterns: ["("],
      replacement: "X",
      isRegex: true,
    });
    expect(() =>
      applyWordReplacements("test (", [rule], "beforeAI"),
    ).not.toThrow();
    expect(applyWordReplacements("test (", [rule], "beforeAI")).toBe("test (");
  });

  it("[P2] 空 text 或空規則原樣返回", () => {
    const rule = createReplacementRule({ patterns: ["a"], replacement: "b" });
    expect(applyWordReplacements("", [rule], "beforeAI")).toBe("");
    expect(applyWordReplacements("keep", [], "beforeAI")).toBe("keep");
  });
});

describe("applyTranscriptTextTransforms with replacements", () => {
  it("[P1] beforeAI 取代先於簡→繁套用（zh-TW）", async () => {
    const rule = createReplacementRule({
      patterns: ["kubernetes"],
      replacement: "K8s",
    });
    expect(
      await applyTranscriptTextTransforms(
        "请用 kubernetes 部署",
        "zh-TW",
        [rule],
      ),
    ).toBe("請用 K8s 部署");
  });

  it("[P2] 未提供規則時向後相容（僅簡→繁）", async () => {
    expect(await applyTranscriptTextTransforms("请用 kubernetes", "zh-TW")).toBe(
      "請用 kubernetes",
    );
  });
});
