import { describe, it, expect } from "vitest";
import {
  DECOMMISSIONED_MODEL_MAP,
  DEFAULT_LLM_MODEL_ID,
  getEffectiveLlmModelId,
  findLlmModelConfig,
} from "../../src/lib/modelRegistry";

describe("modelRegistry — 模型遷移", () => {
  describe("DECOMMISSIONED_MODEL_MAP 不變量", () => {
    it("[P0] 每個 map value 是存活模型或另一個 map key（結構不變量，抓 typo）", () => {
      for (const [key, value] of Object.entries(DECOMMISSIONED_MODEL_MAP)) {
        const isLiveModel = findLlmModelConfig(value) !== undefined;
        const isAnotherKey = value in DECOMMISSIONED_MODEL_MAP;
        expect(
          isLiveModel || isAnotherKey,
          `${key} → ${value}: value 既非存活模型也非另一個 map key（可能是 typo）`,
        ).toBe(true);
      }
    });

    it("[P0] 每條遷移鏈無環且終點為存活模型", () => {
      for (const startKey of Object.keys(DECOMMISSIONED_MODEL_MAP)) {
        const seen = new Set<string>();
        let cur: string | undefined = startKey;
        while (cur && !findLlmModelConfig(cur)) {
          expect(seen.has(cur), `遷移鏈出現環：${startKey} … ${cur}`).toBe(
            false,
          );
          seen.add(cur);
          cur = DECOMMISSIONED_MODEL_MAP[cur];
        }
        expect(
          cur ? findLlmModelConfig(cur) : undefined,
          `${startKey} 的遷移鏈終點不是存活模型`,
        ).toBeDefined();
      }
    });

    it("[P0] 預設模型本身存在於 registry", () => {
      expect(findLlmModelConfig(DEFAULT_LLM_MODEL_ID)).toBeDefined();
    });

    it("[P1] gemini-3.1-pro-preview（新增 Pro 級）存在且 providerId=gemini", () => {
      const config = findLlmModelConfig("gemini-3.1-pro-preview");
      expect(config).toBeDefined();
      expect(config?.providerId).toBe("gemini");
    });
  });

  describe("getEffectiveLlmModelId", () => {
    it("[P0] registry 內的 id 原樣返回", () => {
      expect(getEffectiveLlmModelId(DEFAULT_LLM_MODEL_ID)).toBe(
        DEFAULT_LLM_MODEL_ID,
      );
      expect(getEffectiveLlmModelId("openai/gpt-oss-120b")).toBe(
        "openai/gpt-oss-120b",
      );
    });

    it("[P0] 已下架的舊預設 llama-3.3-70b 遷移到新預設", () => {
      expect(getEffectiveLlmModelId("llama-3.3-70b-versatile")).toBe(
        "qwen/qwen3.6-27b",
      );
    });

    it("[P0] 07-17 下架的 scout / qwen3-32b 遷移到存活模型", () => {
      expect(
        findLlmModelConfig(
          getEffectiveLlmModelId("meta-llama/llama-4-scout-17b-16e-instruct"),
        ),
      ).toBeDefined();
      expect(
        findLlmModelConfig(getEffectiveLlmModelId("qwen/qwen3-32b")),
      ).toBeDefined();
    });

    it("[P0] null（舊版升級）→ 預設", () => {
      expect(getEffectiveLlmModelId(null)).toBe(DEFAULT_LLM_MODEL_ID);
    });

    it("[P0] 完全未知的 id → 預設", () => {
      expect(getEffectiveLlmModelId("totally-made-up-model")).toBe(
        DEFAULT_LLM_MODEL_ID,
      );
    });
  });
});
