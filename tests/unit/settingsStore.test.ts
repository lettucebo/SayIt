import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock tauri-plugin-store
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
const mockStoreSave = vi.fn();
const mockStoreDelete = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
    delete: mockStoreDelete,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-TW" },
      t: (key: string) => key,
    },
  },
  switchLocale: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/i18n/prompts", async () => {
  const LEGACY_PROMPT = "你是文字校對工具，不是對話助理。";
  const MINIMAL_PROMPT = "你是語音逐字稿的文字校對工具。";
  const ACTIVE_PROMPT = "你是語音逐字稿整理工具。";

  return {
    getMinimalPromptForLocale: () => MINIMAL_PROMPT,
    getPromptForModeAndLocale: (mode: string) =>
      mode === "active" ? ACTIVE_PROMPT : MINIMAL_PROMPT,
    isKnownDefaultPrompt: (prompt: string) => {
      const trimmed = prompt.trim();
      return trimmed === LEGACY_PROMPT || trimmed === MINIMAL_PROMPT;
    },
    MINIMAL_PROMPTS: { "zh-TW": MINIMAL_PROMPT },
    ACTIVE_PROMPTS: { "zh-TW": ACTIVE_PROMPT },
  };
});

vi.mock("../../src/i18n/languageConfig", () => ({
  FALLBACK_LOCALE: "zh-TW",
  LANGUAGE_OPTIONS: [{ locale: "zh-TW" }],
  TRANSCRIPTION_LANGUAGE_OPTIONS: [
    { locale: "auto" },
    { locale: "zh-TW" },
  ],
  detectSystemLocale: () => "zh-TW",
  getHtmlLangForLocale: () => "zh-TW",
  getWhisperCodeForTranscriptionLocale: () => null,
  normalizeMaiCandidateLocales: () => [],
}));

vi.mock("../../src/lib/enhancer", () => ({
  getDefaultSystemPrompt: () => "你是語音逐字稿的文字校對工具。",
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: vi.fn(),
  SETTINGS_UPDATED: "settings:updated",
}));

vi.mock("../../src/lib/errorUtils", () => ({
  extractErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  getHotkeyRecordingTimeoutMessage: () => "",
  getHotkeyUnsupportedKeyMessage: () => "",
  getHotkeyPresetHint: () => "",
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("../../src/lib/keycodeMap", () => ({
  getKeyDisplayName: () => "",
  getPlatformKeycode: () => 0,
  isPresetEquivalentKey: () => false,
  getDangerousKeyWarning: () => null,
  getEscapeReservedMessage: () => null,
}));

vi.mock("../../src/lib/modelRegistry", () => ({
  DEFAULT_LLM_MODEL_ID: "test-llm",
  DEFAULT_LLM_PROVIDER_ID: "groq",
  DEFAULT_WHISPER_MODEL_ID: "test-whisper",
  DEFAULT_AZURE_CHAT_MODEL_FAMILY_ID: "azure-openai",
  getEffectiveLlmModelId: (id: string | null) => id ?? "test-llm",
  getEffectiveWhisperModelId: (id: string | null) => id ?? "test-whisper",
  findLlmModelConfig: () => ({ providerId: "groq" }),
  getEffectiveTranscriptionProviderId: (id: string | null | undefined) =>
    id === "azure" || id === "gemini" || id === "groq" || id === "mai"
      ? id
      : "groq",
  getEffectiveGeminiTranscriptionModelId: (id: string | null | undefined) =>
    id === "gemini-3.6-flash" ? id : "gemini-3.5-flash-lite",
  getEffectiveAzureChatModelFamilyId: (id: string | null | undefined) =>
    id === "deepseek" ? id : "azure-openai",
  isAzureChatModelFamilyId: (id: unknown) => id === "deepseek",
  getEffectiveAzureChatModelFamilySource: (source: unknown) =>
    source === "auto" ? "auto" : "manual",
  GEMINI_TRANSCRIPTION_MODEL: "gemini-3.5-flash-lite",
  DEFAULT_MAI_TRANSCRIPTION_MODEL_ID: "mai-transcribe-2",
  LEGACY_MAI_TRANSCRIPTION_MODEL_ID: "mai-transcribe-1.5",
  isMaiTranscriptionModelId: (id: unknown) =>
    id === "mai-transcribe-1.5" || id === "mai-transcribe-2",
  resolveInitialMaiTranscriptionModelId: (
    saved: unknown,
    savedWhisperProviderId: string | null | undefined,
  ) =>
    saved === "mai-transcribe-1.5" || saved === "mai-transcribe-2"
      ? saved
      : savedWhisperProviderId === "mai"
        ? "mai-transcribe-1.5"
        : "mai-transcribe-2",
  DEFAULT_FOUNDRY_TRANSCRIPTION_PROVIDER: "mai",
  toTranscriptionProviderGroup: (id: string) =>
    id === "azure" || id === "mai" ? "foundry" : id,
  isFoundryTranscriptionProvider: (id: unknown) =>
    id === "azure" || id === "mai",
  getEffectiveMaiTranscribeStyle: (style: string | null | undefined) =>
    style === "verbatim" ? "verbatim" : "default",
  DEFAULT_QUOTA_PERIOD: "daily",
  QUOTA_PERIOD_VALUES: ["daily", "monthly"],
  getModelListByProvider: () => [],
  getDefaultModelIdForProvider: () => "test-llm",
}));

vi.mock("../../src/lib/llmProvider", () => ({
  LLM_PROVIDER_LIST: [{ id: "groq" }],
  findProviderConfig: () => undefined,
  normalizeAzureEndpoint: (endpoint: string) => endpoint.replace(/\/+$/, ""),
  parseAzureProjectEndpoint: (endpoint: string) => ({
    endpoint: endpoint.replace(/\/+$/, ""),
    projectName: "",
  }),
}));

describe("useSettingsStore — prompt mode 遷移", () => {
  beforeEach(() => {
    vi.resetModules();
    mockStoreGet.mockReset();
    mockStoreSet.mockReset();
    mockStoreSave.mockReset();
    mockStoreDelete.mockReset();

    // Default: return null for all keys
    mockStoreGet.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupStoreGetMock(overrides: Record<string, unknown>) {
    mockStoreGet.mockImplementation((key: string) => {
      if (key in overrides) return Promise.resolve(overrides[key]);
      return Promise.resolve(null);
    });
  }

  async function createStore() {
    const { createPinia, setActivePinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    return useSettingsStore();
  }

  it("[P0] 新安裝（store 無 promptMode 且無 aiPrompt）→ 設為 minimal", async () => {
    setupStoreGetMock({});
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("minimal");
  });

  it("[P0] 舊版預設 prompt（匹配 LEGACY）→ 遷移為 minimal", async () => {
    setupStoreGetMock({
      aiPrompt: "你是文字校對工具，不是對話助理。",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("minimal");
  });

  it("[P0] 舊版自訂 prompt（不匹配任何預設）→ 遷移為 custom，保留原文", async () => {
    const customPrompt = "我的自訂 prompt 完全不一樣";
    setupStoreGetMock({
      aiPrompt: customPrompt,
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("custom");
    expect(store.getAiPrompt()).toBe(customPrompt);
  });

  it("[P0] 已有 promptMode（非遷移）→ 直接使用存的值", async () => {
    setupStoreGetMock({
      promptMode: "active",
      aiPrompt: "some prompt",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("active");
  });

  it("[P0] getAiPrompt() minimal 模式 → 回傳 minimal preset", async () => {
    setupStoreGetMock({
      promptMode: "minimal",
    });
    const store = await createStore();
    await store.loadSettings();

    const prompt = store.getAiPrompt();
    expect(prompt).toBe("你是語音逐字稿的文字校對工具。");
  });

  it("[P0] getAiPrompt() active 模式 → 回傳 active preset", async () => {
    setupStoreGetMock({
      promptMode: "active",
    });
    const store = await createStore();
    await store.loadSettings();

    const prompt = store.getAiPrompt();
    expect(prompt).toBe("你是語音逐字稿整理工具。");
  });

  it("[P0] getAiPrompt() custom 模式 → 回傳 aiPrompt ref 值", async () => {
    const customPrompt = "完全自訂的 prompt";
    setupStoreGetMock({
      promptMode: "custom",
      aiPrompt: customPrompt,
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe(customPrompt);
  });

  describe("MAI 轉錄模型預設值", () => {
    it("[P0] 全新安裝（無模型鍵、未用 MAI）→ 推導為 mai-transcribe-2", async () => {
      setupStoreGetMock({});
      const store = await createStore();
      await store.loadSettings();

      expect(store.maiTranscriptionModelId).toBe("mai-transcribe-2");
    });

    it("[P0] 既有 MAI 使用者（無模型鍵、whisperProviderId=mai）→ 維持 1.5", async () => {
      setupStoreGetMock({ whisperProviderId: "mai", azureEnabled: true });
      const store = await createStore();
      await store.loadSettings();

      expect(store.maiTranscriptionModelId).toBe("mai-transcribe-1.5");
    });

    it("[P0] 已存合法值 → 原樣沿用，不被 provider 規則翻掉", async () => {
      setupStoreGetMock({
        whisperProviderId: "mai",
        azureEnabled: true,
        maiTranscriptionModelId: "mai-transcribe-2",
      });
      const store = await createStore();
      await store.loadSettings();

      expect(store.maiTranscriptionModelId).toBe("mai-transcribe-2");
    });

    it("[P0] 已存無法辨識的值 → 記憶體退回，且不覆寫 store", async () => {
      setupStoreGetMock({ maiTranscriptionModelId: "mai-transcribe-99" });
      const store = await createStore();
      await store.loadSettings();

      expect(store.maiTranscriptionModelId).toBe("mai-transcribe-2");
      // 未來版本寫下的選擇不可被抹掉
      expect(mockStoreSet).not.toHaveBeenCalledWith(
        "maiTranscriptionModelId",
        expect.anything(),
      );
    });

    // 回歸鎖：HUD 與 Dashboard 會並行 loadSettings()，載入時寫入會讓較慢的
    // 視窗把使用者剛選好的模型覆寫回推導值。
    it("[P0] loadSettings() 不得寫入 maiTranscriptionModelId", async () => {
      setupStoreGetMock({});
      const store = await createStore();
      await store.loadSettings();

      expect(mockStoreSet).not.toHaveBeenCalledWith(
        "maiTranscriptionModelId",
        expect.anything(),
      );
    });

    it("[P0] migrate：鍵不存在時寫入推導值", async () => {
      setupStoreGetMock({ whisperProviderId: "mai", azureEnabled: true });
      const store = await createStore();
      await store.loadSettings();
      mockStoreSet.mockClear();

      await store.migrateMaiTranscriptionModelDefault();

      expect(mockStoreSet).toHaveBeenCalledWith(
        "maiTranscriptionModelId",
        "mai-transcribe-1.5",
      );
    });

    it("[P0] migrate：鍵已存在時不寫入（含無法辨識的值）", async () => {
      for (const saved of ["mai-transcribe-2", "mai-transcribe-99"]) {
        setupStoreGetMock({ maiTranscriptionModelId: saved });
        const store = await createStore();
        await store.loadSettings();
        mockStoreSet.mockClear();

        await store.migrateMaiTranscriptionModelDefault();

        expect(mockStoreSet).not.toHaveBeenCalledWith(
          "maiTranscriptionModelId",
          expect.anything(),
        );
      }
    });
  });
});
