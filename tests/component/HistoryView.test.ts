import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import HistoryView from "../../src/views/HistoryView.vue";
import type { TranscriptionRecord } from "../../src/types/transcription";

vi.mock("../../src/composables/useTauriEvents", () => ({
  listenToEvent: vi.fn().mockResolvedValue(vi.fn()),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));

let historyState: Record<string, unknown>;

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => historyState,
}));

function createRecord(
  overrides: Partial<TranscriptionRecord> = {},
): TranscriptionRecord {
  return {
    id: "rec-1",
    timestamp: 1700000000000,
    rawText: "原始文字內容",
    processedText: null,
    recordingDurationMs: 3000,
    transcriptionDurationMs: 280,
    enhancementDurationMs: null,
    charCount: 6,
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

function makeHistory(records: TranscriptionRecord[]): Record<string, unknown> {
  return {
    transcriptionList: records,
    isLoading: false,
    hasMore: false,
    searchQuery: "",
    resetAndFetch: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    retranscribeRecord: vi.fn().mockResolvedValue({ ok: true }),
    reEnhanceRecord: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const ButtonStub = {
  name: "Button",
  inheritAttrs: false,
  template: '<button v-bind="$attrs"><slot /></button>',
};

async function mountExpanded(record: TranscriptionRecord) {
  historyState = makeHistory([record]);
  const wrapper = mount(HistoryView, {
    global: {
      plugins: [i18n],
      stubs: { Button: ButtonStub },
    },
  });
  // 展開該紀錄，重試按鈕位於展開詳細區
  await wrapper.find(".cursor-pointer").trigger("click");
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("HistoryView 重試按鈕", () => {
  beforeEach(() => {
    class IOStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", IOStub);
  });

  it("[P1] 失敗紀錄（有錄音檔）顯示可用的重新辨識、不顯示重新整理", async () => {
    const wrapper = await mountExpanded(
      createRecord({ status: "failed", audioFilePath: "C:/rec/rec-1.wav" }),
    );
    const retranscribe = wrapper.find('[data-testid="retranscribe-button"]');
    expect(retranscribe.exists()).toBe(true);
    expect(retranscribe.attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-testid="reenhance-button"]').exists()).toBe(
      false,
    );
  });

  it("[P1] 失敗紀錄（無錄音檔）重新辨識 disabled", async () => {
    const wrapper = await mountExpanded(
      createRecord({ status: "failed", audioFilePath: null }),
    );
    const retranscribe = wrapper.find('[data-testid="retranscribe-button"]');
    expect(retranscribe.exists()).toBe(true);
    expect(retranscribe.attributes("disabled")).toBeDefined();
  });

  it("[P1] 成功但未整理且有原文 → 顯示重新整理、不顯示重新辨識", async () => {
    const wrapper = await mountExpanded(
      createRecord({
        status: "success",
        wasEnhanced: false,
        rawText: "可整理的原文",
      }),
    );
    expect(wrapper.find('[data-testid="reenhance-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="retranscribe-button"]').exists()).toBe(
      false,
    );
  });

  it("[P2] 已整理的成功紀錄 → 兩顆重試按鈕都不顯示", async () => {
    const wrapper = await mountExpanded(
      createRecord({
        status: "success",
        wasEnhanced: true,
        processedText: "整理後文字",
        rawText: "原文",
      }),
    );
    expect(wrapper.find('[data-testid="retranscribe-button"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="reenhance-button"]').exists()).toBe(
      false,
    );
  });

  it("[P1] 點擊重新辨識會呼叫 store.retranscribeRecord", async () => {
    const record = createRecord({
      status: "failed",
      audioFilePath: "C:/rec/rec-1.wav",
    });
    const wrapper = await mountExpanded(record);
    await wrapper.find('[data-testid="retranscribe-button"]').trigger("click");
    expect(historyState.retranscribeRecord).toHaveBeenCalledTimes(1);
    expect(historyState.retranscribeRecord).toHaveBeenCalledWith(record);
  });

  it("[P1] 點擊重新整理會呼叫 store.reEnhanceRecord", async () => {
    const record = createRecord({
      status: "success",
      wasEnhanced: false,
      rawText: "可整理的原文",
    });
    const wrapper = await mountExpanded(record);
    await wrapper.find('[data-testid="reenhance-button"]').trigger("click");
    expect(historyState.reEnhanceRecord).toHaveBeenCalledTimes(1);
    expect(historyState.reEnhanceRecord).toHaveBeenCalledWith(record);
  });
});
