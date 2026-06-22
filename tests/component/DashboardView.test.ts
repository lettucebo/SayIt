import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import DashboardView from "../../src/views/DashboardView.vue";

vi.mock("../../src/composables/useTauriEvents", () => ({
  listenToEvent: vi.fn().mockResolvedValue(vi.fn()),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

let settingsState: Record<string, unknown>;
let historyState: Record<string, unknown>;

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
}));

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => historyState,
}));

function makeHistory(usage: Record<string, number> = {}) {
  return {
    dashboardStats: {
      totalRecordingDurationMs: 0,
      totalCharacters: 0,
      estimatedTimeSavedMs: 0,
      totalTranscriptions: 0,
      dailyQuotaUsage: {
        whisperRequestCount: 0,
        whisperBilledAudioMs: 0,
        llmRequestCount: 0,
        llmTotalTokens: 0,
        vocabularyAnalysisRequestCount: 0,
        vocabularyAnalysisTotalTokens: 0,
        ...usage,
      },
    },
    dailyUsageTrendList: [],
    recentTranscriptionList: [],
    refreshDashboard: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    whisperProviderId: "groq",
    selectedLlmProviderId: "groq",
    selectedWhisperModelId: "whisper-large-v3",
    selectedLlmModelId: "llama-3.3-70b-versatile",
    ...overrides,
  };
}

const tooltipStub = { template: "<div><slot /></div>" };

function mountDashboard() {
  return mount(DashboardView, {
    global: {
      plugins: [i18n],
      stubs: {
        DashboardUsageChart: true,
        TooltipProvider: tooltipStub,
        Tooltip: tooltipStub,
        TooltipTrigger: tooltipStub,
        TooltipContent: tooltipStub,
      },
    },
  });
}

describe("DashboardView 額度卡片", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh-TW";
    historyState = makeHistory({ whisperRequestCount: 10, llmRequestCount: 5 });
  });

  it("[P0] 全免費 provider 顯示剩餘免費額度百分比，無計費標籤", () => {
    settingsState = makeSettings();
    const wrapper = mountDashboard();
    const text = wrapper.text();

    expect(text).toContain("今日剩餘免費額度");
    expect(text).toContain("%");
    expect(text).not.toContain("計費");
    expect(text).not.toContain("今日用量");
  });

  it("[P0] 全計費 provider（Azure）顯示今日用量與計費提示，不顯示百分比", () => {
    settingsState = makeSettings({
      whisperProviderId: "azure",
      selectedLlmProviderId: "azure",
    });
    historyState = makeHistory({
      whisperRequestCount: 12,
      whisperBilledAudioMs: 60_000,
      llmRequestCount: 8,
      llmTotalTokens: 4500,
    });
    const wrapper = mountDashboard();
    const text = wrapper.text();

    expect(text).toContain("今日用量");
    expect(text).toContain("計費");
    expect(text).toContain("Whisper");
    expect(text).toContain("LLM");
    expect(text).toContain("付費方案 — 無免費額度限制");
    // 計費方案不應出現額度百分比（避免誤導的 0% / Infinity）
    expect(text).not.toContain("%");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("NaN");
  });

  it("[P0] 混用（Groq Whisper + Azure LLM）顯示免費額度百分比並標示計費", () => {
    settingsState = makeSettings({
      whisperProviderId: "groq",
      selectedLlmProviderId: "azure",
    });
    const wrapper = mountDashboard();
    const text = wrapper.text();

    expect(text).toContain("今日剩餘免費額度");
    expect(text).toContain("%");
    expect(text).toContain("計費");
    expect(text).not.toContain("Infinity");
  });
});
