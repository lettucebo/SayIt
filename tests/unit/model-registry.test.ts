import { describe, it, expect } from "vitest";
import {
  DECOMMISSIONED_MODEL_MAP,
  DEFAULT_LLM_MODEL_ID,
  getEffectiveLlmModelId,
  findLlmModelConfig,
  getEffectiveTranscriptionProviderId,
  GEMINI_TRANSCRIPTION_MODEL,
  DEFAULT_TRANSCRIPTION_PROVIDER_ID,
  WHISPER_MODEL_LIST,
  LLM_MODEL_LIST,
  GEMINI_TRANSCRIPTION_MODEL_LIST,
  getEffectiveGeminiTranscriptionModelId,
  getEffectiveGeminiTranscriptionRpd,
  getEffectiveMaiTranscribeStyle,
} from "../../src/lib/modelRegistry";
import zhTW from "../../src/i18n/locales/zh-TW.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";
import en from "../../src/i18n/locales/en.json";
import ja from "../../src/i18n/locales/ja.json";
import ko from "../../src/i18n/locales/ko.json";

/** 依 "a.b.c" 路徑取值，缺任一層回 undefined */
function resolveKey(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      obj,
    );
}

const LOCALE_ENTRIES: [string, unknown][] = [
  ["zh-TW", zhTW],
  ["zh-CN", zhCN],
  ["en", en],
  ["ja", ja],
  ["ko", ko],
];

describe("modelRegistry — Gemini 轉錄模型", () => {
  it("[P0] 預設模型必須在清單內且被標為 isDefault", () => {
    const def = GEMINI_TRANSCRIPTION_MODEL_LIST.find((m) => m.isDefault);
    expect(def).toBeDefined();
    expect(GEMINI_TRANSCRIPTION_MODEL).toBe(def?.id);
  });

  it("[P0] 未知/舊值一律退回預設（避免打到不存在的模型端點）", () => {
    expect(getEffectiveGeminiTranscriptionModelId("whisper-large-v3")).toBe(
      GEMINI_TRANSCRIPTION_MODEL,
    );
    // 官方公告 2027-05-07 停用，刻意不提供
    expect(getEffectiveGeminiTranscriptionModelId("gemini-3.1-flash-lite")).toBe(
      GEMINI_TRANSCRIPTION_MODEL,
    );
    expect(getEffectiveGeminiTranscriptionModelId(null)).toBe(
      GEMINI_TRANSCRIPTION_MODEL,
    );
  });

  it("[P0] 清單內的模型原樣保留", () => {
    for (const model of GEMINI_TRANSCRIPTION_MODEL_LIST) {
      expect(getEffectiveGeminiTranscriptionModelId(model.id)).toBe(model.id);
    }
  });

  it("[P0] 每個模型的 badgeKey / descriptionKey 在五語系都要有字串", () => {
    for (const model of GEMINI_TRANSCRIPTION_MODEL_LIST) {
      for (const key of [model.badgeKey, model.descriptionKey]) {
        for (const [localeName, messages] of LOCALE_ENTRIES) {
          const value = resolveKey(messages, key);
          expect(
            typeof value === "string" && value.length > 0,
            `${localeName} 缺少 ${key}（模型 ${model.id}）`,
          ).toBe(true);
        }
      }
    }
  });

  it("[P0] 每個模型都要有內建免費額度預設值（選模型時就有分母可用）", () => {
    for (const model of GEMINI_TRANSCRIPTION_MODEL_LIST) {
      expect(
        model.typicalFreeRpd,
        `${model.id} 缺少 typicalFreeRpd`,
      ).toBeGreaterThan(0);
    }
  });

  it("[P0] 未覆寫時採用該模型的內建額度", () => {
    for (const model of GEMINI_TRANSCRIPTION_MODEL_LIST) {
      expect(getEffectiveGeminiTranscriptionRpd(0, model.id)).toBe(
        model.typicalFreeRpd,
      );
    }
  });

  it("[P0] 使用者覆寫優先於內建預設", () => {
    expect(getEffectiveGeminiTranscriptionRpd(1234, "gemini-3.6-flash")).toBe(
      1234,
    );
  });

  it("[P1] 未知模型且未覆寫 → 0（呼叫端據此隱藏額度條，不捏造分母）", () => {
    expect(getEffectiveGeminiTranscriptionRpd(0, "not-a-model")).toBe(0);
  });
});

describe("modelRegistry — 轉錄模型說明文案", () => {
  it("[P0] 每個 LLM 模型都有 badgeKey 與 descriptionKey，且五語系齊全", () => {
    for (const model of LLM_MODEL_LIST) {
      expect(model.badgeKey, `${model.id} 缺 badgeKey`).toBeTruthy();
      expect(model.descriptionKey, `${model.id} 缺 descriptionKey`).toBeTruthy();
      for (const key of [model.badgeKey, model.descriptionKey]) {
        for (const [localeName, messages] of LOCALE_ENTRIES) {
          const value = resolveKey(messages, key);
          expect(
            typeof value === "string" && value.length > 0,
            `${localeName} 缺少 ${key}（模型 ${model.id}）`,
          ).toBe(true);
        }
      }
    }
  });

  it("[P0] 每個 Whisper 模型都有 badgeKey 與 descriptionKey", () => {
    for (const model of WHISPER_MODEL_LIST) {
      expect(model.badgeKey, `${model.id} 缺 badgeKey`).toBeTruthy();
      expect(model.descriptionKey, `${model.id} 缺 descriptionKey`).toBeTruthy();
    }
  });

  it("[P0] badgeKey / descriptionKey 在五個語系都要有對應字串", () => {
    for (const model of WHISPER_MODEL_LIST) {
      for (const key of [model.badgeKey, model.descriptionKey]) {
        for (const [localeName, messages] of LOCALE_ENTRIES) {
          const value = resolveKey(messages, key);
          expect(
            typeof value === "string" && value.length > 0,
            `${localeName} 缺少 ${key}（模型 ${model.id}）`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("modelRegistry — 轉錄 provider", () => {
  it("[P0] 已知 provider 原樣回傳", () => {
    expect(getEffectiveTranscriptionProviderId("groq")).toBe("groq");
    expect(getEffectiveTranscriptionProviderId("azure")).toBe("azure");
    expect(getEffectiveTranscriptionProviderId("gemini")).toBe("gemini");
    expect(getEffectiveTranscriptionProviderId("mai")).toBe("mai");
  });

  it("[P0] 未知/空值 fail-closed 退回預設（避免金鑰送到非預期服務）", () => {
    expect(getEffectiveTranscriptionProviderId("openai")).toBe(
      DEFAULT_TRANSCRIPTION_PROVIDER_ID,
    );
    expect(getEffectiveTranscriptionProviderId("")).toBe(
      DEFAULT_TRANSCRIPTION_PROVIDER_ID,
    );
    expect(getEffectiveTranscriptionProviderId(null)).toBe(
      DEFAULT_TRANSCRIPTION_PROVIDER_ID,
    );
    expect(getEffectiveTranscriptionProviderId(undefined)).toBe(
      DEFAULT_TRANSCRIPTION_PROVIDER_ID,
    );
  });

  it("[P0] Gemini 轉錄模型不得是 Whisper 模型 id（會打到不存在的端點）", () => {
    expect(GEMINI_TRANSCRIPTION_MODEL).toMatch(/^gemini-/);
    expect(GEMINI_TRANSCRIPTION_MODEL).not.toMatch(/whisper/);
  });

  it("[P0] MAI 逐字稿風格只接受 verbatim，未知值安全退回 default", () => {
    expect(getEffectiveMaiTranscribeStyle("verbatim")).toBe("verbatim");
    expect(getEffectiveMaiTranscribeStyle("default")).toBe("default");
    expect(getEffectiveMaiTranscribeStyle("unexpected")).toBe("default");
    expect(getEffectiveMaiTranscribeStyle(null)).toBe("default");
  });
});

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
