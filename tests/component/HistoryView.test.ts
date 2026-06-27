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
    status: "success",
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

  it("[P1] 每筆紀錄都顯示兩顆重試按鈕（含已整理的成功紀錄）", async () => {
    const wrapper = await mountExpanded(
      createRecord({
        status: "success",
        wasEnhanced: true,
        processedText: "整理後文字",
        rawText: "原文",
        audioFilePath: "C:/rec/rec-1.wav",
      }),
    );
    expect(wrapper.find('[data-testid="retranscribe-button"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="reenhance-button"]').exists()).toBe(true);
  });

  it("[P1] 有錄音檔與原文 → 兩顆皆可用（未 disabled）", async () => {
    const wrapper = await mountExpanded(
      createRecord({ audioFilePath: "C:/rec/rec-1.wav", rawText: "有原文" }),
    );
    expect(
      wrapper.find('[data-testid="retranscribe-button"]').attributes("disabled"),
    ).toBeUndefined();
    expect(
      wrapper.find('[data-testid="reenhance-button"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("[P1] 無錄音檔 → 重新辨識 disabled、重新整理仍可用", async () => {
    const wrapper = await mountExpanded(
      createRecord({ audioFilePath: null, rawText: "有原文" }),
    );
    expect(
      wrapper.find('[data-testid="retranscribe-button"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find('[data-testid="reenhance-button"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("[P1] 空原文 → 重新整理 disabled、重新辨識仍可用", async () => {
    const wrapper = await mountExpanded(
      createRecord({
        status: "failed",
        audioFilePath: "C:/rec/rec-1.wav",
        rawText: "   ",
      }),
    );
    expect(
      wrapper.find('[data-testid="reenhance-button"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find('[data-testid="retranscribe-button"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("[P1] 點擊重新辨識會呼叫 store.retranscribeRecord", async () => {
    const record = createRecord({ audioFilePath: "C:/rec/rec-1.wav" });
    const wrapper = await mountExpanded(record);
    await wrapper.find('[data-testid="retranscribe-button"]').trigger("click");
    expect(historyState.retranscribeRecord).toHaveBeenCalledTimes(1);
    expect(historyState.retranscribeRecord).toHaveBeenCalledWith(record);
  });

  it("[P1] 點擊重新整理會呼叫 store.reEnhanceRecord", async () => {
    const record = createRecord({ rawText: "可整理的原文" });
    const wrapper = await mountExpanded(record);
    await wrapper.find('[data-testid="reenhance-button"]').trigger("click");
    expect(historyState.reEnhanceRecord).toHaveBeenCalledTimes(1);
    expect(historyState.reEnhanceRecord).toHaveBeenCalledWith(record);
  });

  it("[P2] 重試進行中切換展開到其他紀錄，其重試按鈕應 disabled（全域鎖）", async () => {
    let resolveRetry: (v: { ok: boolean }) => void = () => {};
    const recordA = createRecord({
      id: "rec-A",
      audioFilePath: "C:/a.wav",
    });
    const recordB = createRecord({
      id: "rec-B",
      audioFilePath: "C:/b.wav",
    });
    historyState = makeHistory([recordA, recordB]);
    historyState.retranscribeRecord = vi.fn(
      () => new Promise<{ ok: boolean }>((r) => (resolveRetry = r)),
    );
    const wrapper = mount(HistoryView, {
      global: { plugins: [i18n], stubs: { Button: ButtonStub } },
    });
    // 展開 A 並觸發重試（pending）
    await wrapper.findAll(".cursor-pointer")[0].trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="retranscribe-button"]').trigger("click");
    await wrapper.vm.$nextTick();
    // 切換展開到 B（A 收合）；B 的重試按鈕應因全域鎖 disabled
    await wrapper.findAll(".cursor-pointer")[1].trigger("click");
    await wrapper.vm.$nextTick();
    const bButton = wrapper.find('[data-testid="retranscribe-button"]');
    expect(bButton.exists()).toBe(true);
    expect(bButton.attributes("disabled")).toBeDefined();
    resolveRetry({ ok: true });
  });
});
