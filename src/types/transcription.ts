import type { TriggerMode } from "./index";

export type TranscriptionStatus = "success" | "failed";

export interface TranscriptionRecord {
  id: string;
  timestamp: number;
  rawText: string;
  processedText: string | null;
  recordingDurationMs: number;
  transcriptionDurationMs: number;
  enhancementDurationMs: number | null;
  charCount: number;
  triggerMode: TriggerMode;
  wasEnhanced: boolean;
  wasModified: boolean | null;
  createdAt: string;
  audioFilePath: string | null;
  status: TranscriptionStatus;
  isEditMode: boolean;
  editSourceText: string | null;
}

export interface DailyQuotaUsage {
  /** Whisper 系轉錄（Groq/Azure，依音訊時長計費） */
  whisperRequestCount: number;
  whisperBilledAudioMs: number;
  /** MAI-Transcribe（依音訊時長計費）——與 Whisper 系分開統計，
   *  否則同一天混用會讓 Groq 的免費額度條計入 MAI 的請求數。 */
  maiRequestCount: number;
  maiBilledAudioMs: number;
  /** Gemini 轉錄（依 token 計量，音訊約 32 tokens/秒）——與 Whisper 分開統計，
   *  否則同一天混用會讓 Groq 的免費額度條計入 Gemini 的請求數。 */
  geminiTranscriptionRequestCount: number;
  geminiTranscriptionTotalTokens: number;
  llmRequestCount: number;
  llmTotalTokens: number;
  vocabularyAnalysisRequestCount: number;
  vocabularyAnalysisTotalTokens: number;
}

export interface DashboardStats {
  totalTranscriptions: number;
  totalCharacters: number;
  totalRecordingDurationMs: number;
  estimatedTimeSavedMs: number;
  dailyQuotaUsage: DailyQuotaUsage;
  /** 本月累計用量——供「每月免費額度」的 provider 計算剩餘量。 */
  monthlyQuotaUsage: DailyQuotaUsage;
}

export type ApiType = "whisper" | "chat" | "vocabulary_analysis";

export interface ChatUsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTimeMs?: number;
  completionTimeMs?: number;
  totalTimeMs?: number;
}

export interface EnhanceResult {
  text: string;
  usage: ChatUsageData | null;
  /** Azure 因明確拒絕 temperature 而移除參數重試成功。 */
  temperatureAdjusted?: boolean;
}

export interface ApiUsageRecord {
  id: string;
  transcriptionId: string;
  apiType: ApiType;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptTimeMs: number | null;
  completionTimeMs: number | null;
  totalTimeMs: number | null;
  audioDurationMs: number | null;
  estimatedCostCeiling: number;
}

export interface DailyUsageTrend {
  date: string;
  count: number;
  totalChars: number;
}
