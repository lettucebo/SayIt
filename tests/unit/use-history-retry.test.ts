import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { TranscriptionRecord } from "../../src/types/transcription";

const h = vi.hoisted(() => {
  const mockDbExecute = vi.fn();
  const mockInvoke = vi.fn();
  const mockEnhanceGuard = vi.fn();
  const mockGetTopTerms = vi.fn();
  const mockReplacementState = {
    rules: [] as Array<{
      id: string;
      patterns: string[];
      replacement: string;
      isRegex: boolean;
      timing: "beforeAI" | "afterAI" | "both";
      enabled: boolean;
    }>,
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
  };
  const settingsStub = {
    whisperProviderId: "groq",
    hasWhisperConfig: true,
    getApiKey: () => "whisper-key",
    refreshApiKey: vi.fn(),
    refreshTranscriptionApiKey: vi.fn(),
    getWhisperRequestConfig: vi.fn(),
    selectedWhisperModelId: "whisper-large-v3-turbo",
    getWhisperLanguageCode: () => "zh",
    refreshLlmApiKey: vi.fn(),
    getLlmRequestConfig: vi.fn(),
    getAiPrompt: () => "prompt",
    getAiPromptForEnhancement: () => "runtime-script-policy-prompt",
    getEffectiveChatModel: () => "qwen/qwen3.6-27b",
    selectedTranscriptionLocale: "auto",
    selectedLocale: "en",
    promptMode: "active",
  };
  return {
    mockDbExecute,
    mockInvoke,
    mockEnhanceGuard,
    mockGetTopTerms,
    mockReplacementState,
    settingsStub,
  };
});

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({ execute: h.mockDbExecute, select: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.mockInvoke }));
vi.mock("../../src/composables/useTauriEvents", () => ({
  emitToWindow: vi.fn().mockResolvedValue(undefined),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/lib/enhancer", () => ({
  enhanceWithAnomalyGuard: h.mockEnhanceGuard,
  EnhancerApiError: class EnhancerApiError extends Error {
    constructor(statusCode: number, statusText: string, public body: string) {
      super(`Enhancement API error: ${statusCode} ${statusText}`);
    }
    statusCode = 429;
    provider = "groq";
    rateLimit = { kind: "tpm", retryAfterMs: 1500 };
  },
}));
vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => h.settingsStub,
}));
vi.mock("../../src/stores/useReplacementStore", () => ({
  useReplacementStore: () => ({
    rules: h.mockReplacementState.rules,
    ensureLoaded: h.mockReplacementState.ensureLoaded,
  }),
}));
vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => ({ getTopTermListByWeight: h.mockGetTopTerms }),
}));

import { useHistoryStore } from "../../src/stores/useHistoryStore";

function createRecord(
  overrides: Partial<TranscriptionRecord> = {},
): TranscriptionRecord {
  return {
    id: "rec-1",
    timestamp: 1700000000000,
    rawText: "",
    processedText: null,
    recordingDurationMs: 3000,
    transcriptionDurationMs: 0,
    enhancementDurationMs: null,
    charCount: 0,
    triggerMode: "hold",
    wasEnhanced: false,
    wasModified: null,
    createdAt: "",
    audioFilePath: "C:/rec/rec-1.wav",
    status: "failed",
    isEditMode: false,
    editSourceText: null,
    ...overrides,
  };
}

const GOOD_TRANSCRIBE_RESULT = {
  rawText: "這是重新辨識後得到的完整句子內容。",
  transcriptionDurationMs: 280,
  noSpeechProbability: 0.01,
  peakEnergyLevel: 0.5,
  rmsEnergyLevel: 0.1,
};

describe("useHistoryStore retry", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.mockDbExecute
      .mockReset()
      .mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    h.mockInvoke.mockReset();
    h.mockEnhanceGuard.mockReset();
    h.mockGetTopTerms.mockReset().mockResolvedValue([]);
    h.mockReplacementState.rules = [];
    h.mockReplacementState.ensureLoaded.mockClear().mockResolvedValue(undefined);
    h.settingsStub.refreshApiKey.mockReset().mockResolvedValue(undefined);
    h.settingsStub.refreshTranscriptionApiKey
      .mockReset()
      .mockResolvedValue(undefined);
    h.settingsStub.refreshLlmApiKey.mockReset().mockResolvedValue(undefined);
    h.settingsStub.getWhisperRequestConfig.mockReset().mockResolvedValue({
      apiKey: "whisper-key",
      provider: "groq",
      modelId: "whisper-large-v3-turbo",
    });
    h.settingsStub.getLlmRequestConfig.mockReset().mockResolvedValue({
      apiKey: "llm-key",
      provider: "groq",
      modelId: "qwen/qwen3.6-27b",
    });
    h.settingsStub.selectedTranscriptionLocale = "auto";
    h.settingsStub.selectedLocale = "en";
    h.settingsStub.promptMode = "active";
  });

  describe("retranscribeRecord", () => {
    it("[P0] edit-mode record is rejected before settings, vocabulary, API and DB", async () => {
      const store = useHistoryStore();
      const record = createRecord({
        isEditMode: true,
        rawText: "刪掉前一句",
        processedText: "已編輯內容",
        status: "success",
      });
      store.transcriptionList.push(record);

      expect((await store.retranscribeRecord(record)).ok).toBe(false);
      expect(store.transcriptionList[0].processedText).toBe("已編輯內容");
      expect(h.settingsStub.getWhisperRequestConfig).not.toHaveBeenCalled();
      expect(h.mockGetTopTerms).not.toHaveBeenCalled();
      expect(h.mockInvoke).not.toHaveBeenCalled();
      expect(h.mockDbExecute).not.toHaveBeenCalled();
    });

    it("[P0] pending retranscription locks both retry actions across store references", async () => {
      let resolveInvoke!: (value: typeof GOOD_TRANSCRIBE_RESULT) => void;
      h.mockInvoke.mockReturnValue(new Promise((resolve) => { resolveInvoke = resolve; }));
      const store = useHistoryStore();
      const recordA = createRecord({ id: "rec-A" });
      const recordB = createRecord({ id: "rec-B", rawText: "待整理原文" });
      const pending = store.retranscribeRecord(recordA);
      await vi.waitFor(() => expect(h.mockInvoke).toHaveBeenCalledTimes(1));
      expect(useHistoryStore().retryingId).toBe(recordA.id);
      expect(useHistoryStore().retryingAction).toBe("transcribe");
      expect((await useHistoryStore().reEnhanceRecord(recordB)).ok).toBe(false);
      expect((await useHistoryStore().retranscribeRecord(recordB)).ok).toBe(false);
      expect(h.mockEnhanceGuard).not.toHaveBeenCalled();
      expect(h.mockInvoke).toHaveBeenCalledTimes(1);
      resolveInvoke(GOOD_TRANSCRIBE_RESULT);
      await pending;
      expect(store.retryingId).toBeNull();
      expect(store.retryingAction).toBeNull();
    });

    it("[P1] failed settings lookup and DB write both release the retry lock", async () => {
      const store = useHistoryStore();
      const record = createRecord();
      h.settingsStub.getWhisperRequestConfig.mockRejectedValueOnce(new Error("settings"));
      await expect(store.retranscribeRecord(record)).rejects.toThrow("settings");
      expect(store.retryingId).toBeNull();
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      h.mockDbExecute.mockImplementation((sql: string) =>
        sql.includes("UPDATE transcriptions")
          ? Promise.reject(new Error("database"))
          : Promise.resolve({ rowsAffected: 1, lastInsertId: 0 }),
      );
      await expect(store.retranscribeRecord(record)).rejects.toThrow("database");
      expect(store.retryingId).toBeNull();
      expect(store.retryingAction).toBeNull();
    });

    it("[P1] failed transcription API releases the retry lock", async () => {
      h.mockInvoke.mockRejectedValueOnce(new Error("offline"));
      const store = useHistoryStore();
      const result = await store.retranscribeRecord(createRecord());
      expect(result).toMatchObject({ ok: false, errorKey: "history.retranscribeFailed" });
      expect(store.retryingId).toBeNull();
      expect(store.retryingAction).toBeNull();
    });

    it("[P1] 成功重新辨識 → flip success、更新原文、清空整理結果", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);

      expect(res.ok).toBe(true);
      expect(h.mockInvoke).toHaveBeenCalledWith(
        "retranscribe_from_file",
        expect.objectContaining({ filePath: record.audioFilePath }),
      );
      expect(store.transcriptionList[0].status).toBe("success");
      expect(store.transcriptionList[0].rawText).toBe(
        GOOD_TRANSCRIBE_RESULT.rawText,
      );
      expect(store.transcriptionList[0].processedText).toBeNull();
      expect(store.transcriptionList[0].wasEnhanced).toBe(false);
    });

    it("[P1] 無錄音檔 → 不呼叫後端並回 noRecordingFile", async () => {
      const store = useHistoryStore();
      const record = createRecord({ audioFilePath: null });
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.noRecordingFile");
      expect(h.mockInvoke).not.toHaveBeenCalled();
    });

    it("[P1] 空轉錄結果 → 保留 failed、不覆寫原文", async () => {
      h.mockInvoke.mockResolvedValue({ ...GOOD_TRANSCRIBE_RESULT, rawText: "  " });
      const store = useHistoryStore();
      const record = createRecord({ rawText: "原本失敗" });
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.retranscribeFailed");
      expect(store.transcriptionList[0].status).toBe("failed");
      expect(store.transcriptionList[0].rawText).toBe("原本失敗");
    });

    it("[P1] 空轉錄偵測使用 Whisper 原始結果，不被 beforeAI 規則繞過", async () => {
      h.mockReplacementState.rules = [
        {
          id: "before-empty-history",
          patterns: ["^\\s*$"],
          replacement: "被規則補出的文字",
          isRegex: true,
          timing: "beforeAI",
          enabled: true,
        },
      ];
      h.mockInvoke.mockResolvedValue({
        ...GOOD_TRANSCRIBE_RESULT,
        rawText: "  ",
      });
      const store = useHistoryStore();
      const record = createRecord({ rawText: "原本失敗" });
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);

      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.retranscribeFailed");
      expect(store.transcriptionList[0].status).toBe("failed");
      expect(store.transcriptionList[0].rawText).toBe("原本失敗");
    });

    it("[P2] 幻覺結果（靜音 + 高 NSP）→ 保留 failed", async () => {
      h.mockInvoke.mockResolvedValue({
        rawText: "幻覺出來的一長串文字但其實完全沒有人聲",
        transcriptionDurationMs: 280,
        noSpeechProbability: 0.95,
        peakEnergyLevel: 0,
        rmsEnergyLevel: 0,
      });
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(store.transcriptionList[0].status).toBe("failed");
    });

    it("[P2] 樂觀鎖 rowsAffected=0 → 回失敗、紀錄不變", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      h.mockDbExecute.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(store.transcriptionList[0].status).toBe("failed");
    });

    it("[P2] recordingDurationMs<=0 仍可成功（跳過語速異常層、保留能量/NSP）", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      const store = useHistoryStore();
      const record = createRecord({ recordingDurationMs: 0 });
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].status).toBe("success");
    });

    it("[P2] 已整理的成功紀錄重新辨識 → 清空整理、status 仍 success", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        wasEnhanced: true,
        processedText: "舊的整理結果",
        rawText: "舊原文",
      });
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].status).toBe("success");
      expect(store.transcriptionList[0].rawText).toBe(
        GOOD_TRANSCRIBE_RESULT.rawText,
      );
      expect(store.transcriptionList[0].processedText).toBeNull();
      expect(store.transcriptionList[0].wasEnhanced).toBe(false);
    });
  });

  describe("reEnhanceRecord", () => {
    it("[P0] edit-mode record is rejected before settings, vocabulary, API and DB", async () => {
      const store = useHistoryStore();
      const record = createRecord({
        isEditMode: true,
        rawText: "翻譯上一段",
        processedText: "原有編輯結果",
        status: "success",
      });
      store.transcriptionList.push(record);
      expect((await store.reEnhanceRecord(record)).ok).toBe(false);
      expect(store.transcriptionList[0].processedText).toBe("原有編輯結果");
      expect(h.settingsStub.refreshLlmApiKey).not.toHaveBeenCalled();
      expect(h.mockGetTopTerms).not.toHaveBeenCalled();
      expect(h.mockEnhanceGuard).not.toHaveBeenCalled();
      expect(h.mockDbExecute).not.toHaveBeenCalled();
    });

    it("[P0] empty-response fallback keeps prior output and records successful HTTP usage", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "原始口語內容",
        usage: { promptTokens: 12, completionTokens: 2, totalTokens: 14 },
        wasAnomalous: false,
        wasEmptyResponse: true,
      });
      const store = useHistoryStore();
      const record = createRecord({ status: "success", rawText: "原始口語內容", processedText: "既有整理", wasEnhanced: true });
      store.transcriptionList.push(record);

      const result = await store.reEnhanceRecord(record);
      expect(result).toMatchObject({ ok: false, errorKey: "history.reEnhanceFailed" });
      expect(store.transcriptionList[0].processedText).toBe("既有整理");
      expect(h.mockDbExecute.mock.calls.some(([sql]) => String(sql).includes("UPDATE transcriptions"))).toBe(false);
      await vi.waitFor(() => expect(h.mockDbExecute.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO api_usage"))).toBe(true));
    });

    it("[P0] valid output identical to the original is allowed", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "原始口語內容",
        usage: null,
        wasAnomalous: false,
        wasEmptyResponse: false,
      });
      const store = useHistoryStore();
      const record = createRecord({ status: "success", rawText: "原始口語內容", processedText: "舊整理" });
      store.transcriptionList.push(record);
      expect((await store.reEnhanceRecord(record)).ok).toBe(true);
      expect(store.transcriptionList[0].processedText).toBe("原始口語內容");
    });

    it("[P1] failed LLM configuration and DB write release retry lock", async () => {
      const store = useHistoryStore();
      const record = createRecord({ rawText: "原始口語內容" });
      h.settingsStub.getLlmRequestConfig.mockRejectedValueOnce(new Error("settings"));
      await expect(store.reEnhanceRecord(record)).rejects.toThrow("settings");
      expect(store.retryingId).toBeNull();
      h.mockEnhanceGuard.mockResolvedValue({ text: "整理結果", usage: null, wasAnomalous: false });
      h.mockDbExecute.mockRejectedValueOnce(new Error("database"));
      await expect(store.reEnhanceRecord(record)).rejects.toThrow("database");
      expect(store.retryingId).toBeNull();
      expect(store.retryingAction).toBeNull();
    });

    it("[P0] history 429 returns actionable feedback while preserving the record", async () => {
      const { EnhancerApiError } = await import("../../src/lib/enhancer");
      h.mockEnhanceGuard.mockRejectedValue(
        new EnhancerApiError(429, "Too Many Requests", ""),
      );
      const store = useHistoryStore();
      const record = createRecord({ status: "success", rawText: "原始內容" });
      store.transcriptionList.push(record);
      const result = await store.reEnhanceRecord(record);
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toContain("2 秒");
      expect(store.transcriptionList[0].processedText).toBeNull();
      expect(store.retryingId).toBeNull();
      expect(store.retryingAction).toBeNull();
    });
    it("[P1] 成功整理 → 寫入 processed_text、標記 was_enhanced", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "整理後的書面語句子。",
        usage: null,
        wasAnomalous: false,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: false,
      });
      store.transcriptionList.push(record);
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(true);
      expect(h.mockEnhanceGuard).toHaveBeenCalledWith(
        record.rawText,
        "llm-key",
        expect.objectContaining({
          systemPrompt: "runtime-script-policy-prompt",
        }),
      );
      expect(store.transcriptionList[0].processedText).toBe(
        "整理後的書面語句子。",
      );
      expect(store.transcriptionList[0].wasEnhanced).toBe(true);
    });

    it("[P1] 空原文 → 不呼叫 LLM 並回失敗", async () => {
      const store = useHistoryStore();
      const record = createRecord({ status: "success", rawText: "   " });
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.reEnhanceFailed");
      expect(h.mockEnhanceGuard).not.toHaveBeenCalled();
    });

    it("[P1] 長度爆炸 anomaly → 不 finalize、保留未整理", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "原始口語內容",
        usage: null,
        wasAnomalous: true,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: false,
      });
      store.transcriptionList.push(record);
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.reEnhanceFailed");
      expect(store.transcriptionList[0].wasEnhanced).toBe(false);
      expect(store.transcriptionList[0].processedText).toBeNull();
    });

    it("[P2] 已整理紀錄可再次重新整理（覆寫整理結果）", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "新的整理結果。",
        usage: null,
        wasAnomalous: false,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        wasEnhanced: true,
        processedText: "舊整理",
        rawText: "原始口語內容",
      });
      store.transcriptionList.push(record);
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].processedText).toBe("新的整理結果。");
      expect(store.transcriptionList[0].wasEnhanced).toBe(true);
    });

    it("[P0] zh-TW history re-enhancement final output 簡轉繁後寫入 processed_text", async () => {
      h.settingsStub.selectedLocale = "zh-TW";
      h.mockEnhanceGuard.mockResolvedValue({
        text: "请把会议改到星期五。",
        usage: null,
        wasAnomalous: false,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: false,
      });
      store.transcriptionList.push(record);

      const res = await store.reEnhanceRecord(record);

      expect(res.ok).toBe(true);
      expect(h.mockDbExecute).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.arrayContaining(["請把會議改到星期五。"]),
      );
      expect(store.transcriptionList[0].processedText).toBe(
        "請把會議改到星期五。",
      );
    });

    it("[P0] history re-enhancement 以送出請求當下的 locale/promptMode 決定 final conversion", async () => {
      h.settingsStub.selectedLocale = "zh-CN";
      let resolveEnhance!: (value: {
        text: string;
        usage: null;
        wasAnomalous: false;
      }) => void;
      h.mockEnhanceGuard.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveEnhance = resolve;
        }),
      );
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: false,
      });
      store.transcriptionList.push(record);

      const reEnhancePromise = store.reEnhanceRecord(record);
      await vi.waitFor(() => {
        expect(h.mockEnhanceGuard).toHaveBeenCalled();
      });

      h.settingsStub.selectedLocale = "zh-TW";
      resolveEnhance({
        text: "请把会议改到星期五。",
        usage: null,
        wasAnomalous: false,
      });
      const res = await reEnhancePromise;

      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].processedText).toBe(
        "请把会议改到星期五。",
      );
    });
  });
});
