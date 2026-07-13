import { describe, it, expect } from "vitest";
import {
  DECOMMISSIONED_MODEL_MAP,
  DEFAULT_LLM_MODEL_ID,
  getEffectiveLlmModelId,
  findLlmModelConfig,
} from "../../src/lib/modelRegistry";

describe("modelRegistry — 模型遷移", () => {
  describe("DECOMMISSIONED_MODEL_MAP 不變量", () => {
    it("[P0] 每個 legacy id 最終都解析到 registry 內存活的模型（無死值）", () => {
      for (const legacyId of Object.keys(DECOMMISSIONED_MODEL_MAP)) {
        const resolved = getEffectiveLlmModelId(legacyId);
        expect(
          findLlmModelConfig(resolved),
          `${legacyId} → ${resolved} 不在 registry`,
        ).toBeDefined();
      }
    });

    it("[P0] 預設模型本身存在於 registry", () => {
      expect(findLlmModelConfig(DEFAULT_LLM_MODEL_ID)).toBeDefined();
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
