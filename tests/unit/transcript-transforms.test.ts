import { describe, it, expect } from "vitest";
import { convertSimplifiedToTraditional } from "../../src/lib/simplifiedToTraditional";
import {
  applyTranscriptTextTransforms,
  resolveEffectiveTranscriptionLocale,
} from "../../src/lib/transcriptTransforms";

describe("simplifiedToTraditional", () => {
  it("[P0] 簡體轉台灣正體", () => {
    expect(convertSimplifiedToTraditional("请把会议改到星期五并通知所有人")).toBe(
      "請把會議改到星期五並通知所有人",
    );
  });

  it("[P0] 已是繁體 → 原樣返回", () => {
    expect(convertSimplifiedToTraditional("已經是繁體")).toBe("已經是繁體");
  });

  it("[P1] 空字串原樣返回", () => {
    expect(convertSimplifiedToTraditional("")).toBe("");
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
  it("[P0] zh-TW → 簡體轉繁體", () => {
    expect(
      applyTranscriptTextTransforms("请把会议改到星期五并通知所有人", "zh-TW"),
    ).toBe("請把會議改到星期五並通知所有人");
  });

  it("[P0] 非 zh-TW → 不轉換（zh-CN 原樣）", () => {
    expect(applyTranscriptTextTransforms("请把会议", "zh-CN")).toBe("请把会议");
    expect(applyTranscriptTextTransforms("请把会议", "en")).toBe("请把会议");
  });

  it("[P1] 空字串原樣返回", () => {
    expect(applyTranscriptTextTransforms("", "zh-TW")).toBe("");
  });
});
