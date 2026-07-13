import { describe, it, expect } from "vitest";
import {
  calculateWhisperCostCeiling,
  calculateChatCostCeiling,
} from "../../src/lib/apiPricing";
import { LLM_MODEL_LIST } from "../../src/lib/modelRegistry";

describe("apiPricing.ts", () => {
  // ==========================================================================
  // calculateWhisperCostCeiling
  // ==========================================================================

  describe("calculateWhisperCostCeiling", () => {
    it("[P0] 10 秒音檔應按最低計費 10 秒計算", () => {
      // 10000ms = 10s → 10/3600 * 0.111 = 0.000308333...
      const cost = calculateWhisperCostCeiling(10_000);
      expect(cost).toBeCloseTo(0.000308, 5);
    });

    it("[P0] 低於 10 秒應按最低計費 10 秒計算", () => {
      const cost5s = calculateWhisperCostCeiling(5_000);
      const cost10s = calculateWhisperCostCeiling(10_000);
      expect(cost5s).toBe(cost10s);
    });

    it("[P0] 0ms 應按最低計費 10 秒計算", () => {
      const cost = calculateWhisperCostCeiling(0);
      const cost10s = calculateWhisperCostCeiling(10_000);
      expect(cost).toBe(cost10s);
    });

    it("[P0] 1 小時應回傳 $0.111", () => {
      const cost = calculateWhisperCostCeiling(3_600_000);
      expect(cost).toBeCloseTo(0.111, 6);
    });

    it("[P1] 30 秒應正確按比例計算", () => {
      // 30000ms = 30s → 30/3600 * 0.111 = 0.000925
      const cost = calculateWhisperCostCeiling(30_000);
      expect(cost).toBeCloseTo(0.000925, 5);
    });

    it("[P1] 1 秒應按最低 10 秒計費", () => {
      const cost1s = calculateWhisperCostCeiling(1_000);
      const cost10s = calculateWhisperCostCeiling(10_000);
      expect(cost1s).toBe(cost10s);
    });
  });

  // ==========================================================================
  // calculateChatCostCeiling
  // ==========================================================================

  describe("calculateChatCostCeiling", () => {
    it("[P0] 0 tokens 應回傳 0", () => {
      expect(calculateChatCostCeiling(0)).toBe(0);
    });

    it("[P0] 1000 tokens 應按 output 價格上限計算", () => {
      // 預設模型 Qwen3.6 27B: max(input=0.6, output=3.0) = 3.0/M
      // 1000 * 0.000003 = 0.003
      const cost = calculateChatCostCeiling(1000);
      expect(cost).toBeCloseTo(0.003, 6);
    });

    it("[P0] 1M tokens 應回傳 $3.00", () => {
      // 預設模型 Qwen3.6 27B: 1M * 3.0/M = 3.0
      const cost = calculateChatCostCeiling(1_000_000);
      expect(cost).toBeCloseTo(3.0, 4);
    });

    it("[P1] 150 tokens 應正確計算", () => {
      // 預設模型 Qwen3.6 27B: 150 * 0.000003 = 0.00045
      const cost = calculateChatCostCeiling(150);
      expect(cost).toBeCloseTo(0.00045, 6);
    });

    it("[P1] 未知 model id 的 fallback 上限 ≥ registry 內任何模型（保證不低估）", () => {
      // 不變量守衛：加入更貴的模型（如 Gemini 3.1 Pro $12/M）後，
      // apiPricing.ts 的 fallback 天花板須同步 ≥ 最貴模型，否則遺留死 id 會被低估。
      const unknownCeiling = calculateChatCostCeiling(
        1_000_000,
        "totally-dead-model-id",
      );
      for (const model of LLM_MODEL_LIST) {
        const modelCost = calculateChatCostCeiling(1_000_000, model.id);
        expect(unknownCeiling).toBeGreaterThanOrEqual(modelCost);
      }
    });
  });
});
