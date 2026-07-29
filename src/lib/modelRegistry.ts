// ── LLM Provider ──────────────────────────────────────────

export type LlmProviderId = "groq" | "openai" | "anthropic" | "gemini" | "azure";

export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "groq";

// ── LLM 模型（文字整理用）────────────────────────────────

export type LlmModelId =
  | "qwen/qwen3.6-27b"
  | "openai/gpt-oss-120b"
  | "openai/gpt-oss-20b"
  | "gpt-5.6-luna"
  | "gpt-5.4-nano"
  | "claude-haiku-4-5-20251001"
  | "gemini-3.6-flash"
  | "gemini-3.5-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.1-flash-lite"
  | "gemini-3.1-pro-preview";

// ── Whisper 模型（語音轉錄用）─────────────────────────────

export type WhisperModelId = "whisper-large-v3" | "whisper-large-v3-turbo";

// ── 轉錄 Provider ─────────────────────────────────────────

/** 語音轉錄 provider。Gemini 走 generateContent（非 Whisper multipart 協定）。 */
export type TranscriptionProviderId = "groq" | "azure" | "gemini";

/**
 * 免費額度的計算週期。多數 provider 是每日（如 Gemini 的 RPD、Groq 的 RPD），
 * 但也有「每月 N 次免費」的方案（例：Gemini 的 Google Search grounding 每月 5,000 次），
 * 因此額度模型必須同時支援兩種週期。
 */
export type QuotaPeriod = "daily" | "monthly";

export const DEFAULT_QUOTA_PERIOD: QuotaPeriod = "daily";

export const DEFAULT_TRANSCRIPTION_PROVIDER_ID: TranscriptionProviderId = "groq";

/**
 * Gemini 轉錄可選模型（Rust 端有相同 allowlist，兩端必須一致）。
 * 刻意不提供 gemini-3.1-flash-lite：官方公告 2027-05-07 停用、接替者即 3.5-flash-lite。
 */
export type GeminiTranscriptionModelId =
  | "gemini-3.5-flash-lite"
  | "gemini-3.6-flash";

export interface GeminiTranscriptionModelConfig {
  id: GeminiTranscriptionModelId;
  displayName: string;
  badgeKey: string;
  descriptionKey: string;
  /** 免費層每日請求上限（依帳號可能不同，此為 AI Studio 常見值，僅供顯示參考） */
  typicalFreeRpd: number;
  isDefault: boolean;
}

export const GEMINI_TRANSCRIPTION_MODEL_LIST: GeminiTranscriptionModelConfig[] =
  [
    {
      // 免費層 RPD 是 Flash 的 25 倍，且官方 Flash-Lite 文件明列 Transcription 用例
      id: "gemini-3.5-flash-lite",
      displayName: "Gemini 3.5 Flash-Lite",
      badgeKey: "settings.modelBadge.highQuota",
      descriptionKey: "settings.model.geminiModelDescription.flashLite",
      typicalFreeRpd: 500,
      isDefault: true,
    },
    {
      id: "gemini-3.6-flash",
      displayName: "Gemini 3.6 Flash",
      badgeKey: "settings.modelBadge.accurate",
      descriptionKey: "settings.model.geminiModelDescription.flash",
      typicalFreeRpd: 20,
      isDefault: false,
    },
  ];

/**
 * Gemini 轉錄預設模型（Rust `DEFAULT_GEMINI_TRANSCRIPTION_MODEL` 需一致）。
 * 刻意與 LLM chat 模型解耦：轉錄若沿用 WhisperModelId 會打到不存在的
 * `/models/whisper-large-v3:generateContent`。
 */
export const GEMINI_TRANSCRIPTION_MODEL: GeminiTranscriptionModelId =
  "gemini-3.5-flash-lite";

export function findGeminiTranscriptionModelConfig(
  id: string,
): GeminiTranscriptionModelConfig | undefined {
  return GEMINI_TRANSCRIPTION_MODEL_LIST.find((m) => m.id === id);
}

/** 未知值（舊設定／壞掉的匯入）一律退回預設，避免送出不存在的模型。 */
export function getEffectiveGeminiTranscriptionModelId(
  savedId: string | null | undefined,
): GeminiTranscriptionModelId {
  return savedId && findGeminiTranscriptionModelConfig(savedId)
    ? (savedId as GeminiTranscriptionModelId)
    : GEMINI_TRANSCRIPTION_MODEL;
}

/**
 * 解析 Gemini 轉錄實際採用的每日請求額度：
 * 使用者有填（> 0）就以使用者的為準，否則用該模型的內建預設值。
 * 內建值來自 AI Studio 的免費層 RPD，會隨帳號/時間變動，故一律可被覆寫。
 */
export function getEffectiveGeminiTranscriptionRpd(
  overrideRequests: number,
  modelId: string,
): number {
  if (overrideRequests > 0) return overrideRequests;
  return findGeminiTranscriptionModelConfig(modelId)?.typicalFreeRpd ?? 0;
}

interface BaseModelConfig {
  displayName: string;
  badgeKey: string;
  speedTps: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  freeQuotaRpd: number;
  freeQuotaTpd: number;
  isDefault: boolean;
}

export interface LlmModelConfig extends BaseModelConfig {
  id: LlmModelId;
  providerId: LlmProviderId;
  /** 選中後顯示的特性說明 i18n key（強項／取捨／免費額度） */
  descriptionKey: string;
}

export interface WhisperModelConfig {
  id: WhisperModelId;
  displayName: string;
  /** 下拉選項旁的特性標籤 i18n key */
  badgeKey: string;
  /** 選中後顯示的特性說明 i18n key（哪個較強／取捨） */
  descriptionKey: string;
  costPerHour: number;
  freeQuotaRpd: number;
  freeQuotaAudioSecondsPerDay: number;
  isDefault: boolean;
}

// ── 預設值 ────────────────────────────────────────────────

export const DEFAULT_LLM_MODEL_ID: LlmModelId = "qwen/qwen3.6-27b";
export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "whisper-large-v3";

// ── 已下架模型 ID 映射（舊 → 新，用於自動遷移）──────────
// 每個 value 必須是「當前 registry 內存活的 id」或「map 內另一個 key」
// （getEffectiveLlmModelId 會迴圈解析、並保證回傳值存在於 registry）。
// 映射原則：同 provider 內遷移，避免觸發 useSettingsStore 的 provider 交叉驗證。

export const DECOMMISSIONED_MODEL_MAP: Record<string, string> = {
  // Groq — 2026-07-17 / 2026-08-16 下架潮
  "llama-3.3-70b-versatile": "qwen/qwen3.6-27b",
  "qwen/qwen3-32b": "qwen/qwen3.6-27b",
  "qwen-qwq-32b": "qwen/qwen3.6-27b",
  "moonshotai/kimi-k2-instruct": "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct": "openai/gpt-oss-20b",
  "llama-4-scout-17b-16e-instruct": "openai/gpt-oss-20b",
  "llama-4-maverick-17b-128e-instruct": "qwen/qwen3.6-27b",
  "meta-llama/llama-4-maverick-17b-128e-instruct": "qwen/qwen3.6-27b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "gpt-oss-120b": "openai/gpt-oss-120b",
  // Gemini — 2.5 世代汰換
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
  // OpenAI
  "gpt-5.4-mini": "gpt-5.6-luna",
  // Anthropic — 3.5 Haiku 已於 2026-02-19 退役
  "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
};

// ── 模型清單 ──────────────────────────────────────────────

export const LLM_MODEL_LIST: LlmModelConfig[] = [
  // ── Groq（免費）──
  {
    // Preview 模型：Groq 可無預警下架，顯示名稱標明讓使用者知情
    id: "qwen/qwen3.6-27b",
    providerId: "groq",
    displayName: "Qwen3.6 27B (Preview)",
    badgeKey: "settings.modelBadge.balanced",
    descriptionKey: "settings.model.llmDescription.qwen",
    speedTps: 500,
    inputCostPerMillion: 0.6,
    outputCostPerMillion: 3.0,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 200_000,
    isDefault: true,
  },
  {
    id: "openai/gpt-oss-120b",
    providerId: "groq",
    displayName: "GPT OSS 120B",
    badgeKey: "settings.modelBadge.stableCostly",
    descriptionKey: "settings.model.llmDescription.oss120b",
    speedTps: 500,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 200_000,
    isDefault: false,
  },
  {
    id: "openai/gpt-oss-20b",
    providerId: "groq",
    displayName: "GPT OSS 20B",
    badgeKey: "settings.modelBadge.fastCheap",
    descriptionKey: "settings.model.llmDescription.oss20b",
    speedTps: 1_000,
    inputCostPerMillion: 0.075,
    outputCostPerMillion: 0.3,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 200_000,
    isDefault: false,
  },
  // ── Google Gemini（免費額度依帳號浮動、Google 未公開，故不設內建分母）──
  // 轉錄模型另有可覆寫的內建額度（見 GEMINI_TRANSCRIPTION_MODEL_LIST）；
  // LLM 側目前沒有覆寫入口，維持「不顯示額度條、只顯示今日用量」的既有行為。
  // 各模型的免費額度僅寫在說明文字中供參考，不作為計算分母。
  {
    // 最新旗艦 Flash（2026-07-21 發布，無停用日期）
    id: "gemini-3.6-flash",
    providerId: "gemini",
    displayName: "Gemini 3.6 Flash",
    badgeKey: "settings.modelBadge.premium",
    descriptionKey: "settings.model.llmDescription.gemini36Flash",
    speedTps: 0,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 7.5,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  {
    id: "gemini-3.5-flash",
    providerId: "gemini",
    displayName: "Gemini 3.5 Flash",
    badgeKey: "settings.modelBadge.premium",
    descriptionKey: "settings.model.llmDescription.gemini35Flash",
    speedTps: 0,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 9.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: true,
  },
  {
    // 官方稱「最具成本效益的正式版」；免費層 RPD 為 Flash 的 25 倍
    id: "gemini-3.5-flash-lite",
    providerId: "gemini",
    displayName: "Gemini 3.5 Flash-Lite",
    badgeKey: "settings.modelBadge.highQuota",
    descriptionKey: "settings.model.llmDescription.gemini35FlashLite",
    speedTps: 0,
    inputCostPerMillion: 0.3,
    outputCostPerMillion: 2.5,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  {
    // 官方公告 2027-05-07 停用，接替者為 gemini-3.5-flash-lite
    id: "gemini-3.1-flash-lite",
    providerId: "gemini",
    displayName: "Gemini 3.1 Flash-Lite",
    badgeKey: "settings.modelBadge.fastCheap",
    descriptionKey: "settings.model.llmDescription.gemini31FlashLite",
    speedTps: 0,
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 1.5,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  {
    // Preview 模型：Google 標為 preview，顯示名稱標明讓使用者知情。
    // Pro 級最高品質；分層計價（<200k: $2/$12、>200k: $4/$18），此處採 <200k
    // tier——本 App 請求（短逐字稿＋prompt）遠低於 200k tokens。
    id: "gemini-3.1-pro-preview",
    providerId: "gemini",
    displayName: "Gemini 3.1 Pro (Preview)",
    badgeKey: "settings.modelBadge.smartestSlow",
    descriptionKey: "settings.model.llmDescription.gemini31Pro",
    speedTps: 0,
    inputCostPerMillion: 2.0,
    outputCostPerMillion: 12.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  // ── OpenAI（付費）──
  {
    id: "gpt-5.6-luna",
    providerId: "openai",
    displayName: "GPT-5.6 Luna",
    badgeKey: "settings.modelBadge.premium",
    descriptionKey: "settings.model.llmDescription.gptLuna",
    speedTps: 0,
    inputCostPerMillion: 1.0,
    outputCostPerMillion: 6.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: true,
  },
  {
    id: "gpt-5.4-nano",
    providerId: "openai",
    displayName: "GPT-5.4 Nano",
    badgeKey: "settings.modelBadge.fastCheap",
    descriptionKey: "settings.model.llmDescription.gptNano",
    speedTps: 0,
    inputCostPerMillion: 0.2,
    outputCostPerMillion: 1.25,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  // ── Anthropic（付費）──
  {
    id: "claude-haiku-4-5-20251001",
    providerId: "anthropic",
    displayName: "Claude Haiku 4.5",
    badgeKey: "settings.modelBadge.premium",
    descriptionKey: "settings.model.llmDescription.claudeHaiku",
    speedTps: 0,
    inputCostPerMillion: 1.0,
    outputCostPerMillion: 5.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: true,
  },
];

// 數據出自 Groq 官方 speech-to-text 文件（WER / 速度倍率 / 每小時單價）。
// 兩者皆為多語言、免費額度相同，差別在準確度與成本速度的取捨。
export const WHISPER_MODEL_LIST: WhisperModelConfig[] = [
  {
    id: "whisper-large-v3",
    displayName: "Whisper Large V3",
    badgeKey: "settings.modelBadge.accurate",
    descriptionKey: "settings.model.whisperDescription.largeV3",
    costPerHour: 0.111,
    freeQuotaRpd: 2_000,
    freeQuotaAudioSecondsPerDay: 28_800,
    isDefault: true,
  },
  {
    id: "whisper-large-v3-turbo",
    displayName: "Whisper Large V3 Turbo",
    badgeKey: "settings.modelBadge.fastCheap",
    descriptionKey: "settings.model.whisperDescription.largeV3Turbo",
    costPerHour: 0.04,
    freeQuotaRpd: 2_000,
    freeQuotaAudioSecondsPerDay: 28_800,
    isDefault: false,
  },
];

// ── Lookup helpers ────────────────────────────────────────

export function findLlmModelConfig(id: string): LlmModelConfig | undefined {
  return LLM_MODEL_LIST.find((m) => m.id === id);
}

export function findWhisperModelConfig(
  id: string,
): WhisperModelConfig | undefined {
  return WHISPER_MODEL_LIST.find((m) => m.id === id);
}

export function getModelListByProvider(
  providerId: LlmProviderId,
): LlmModelConfig[] {
  return LLM_MODEL_LIST.filter((m) => m.providerId === providerId);
}

export function getDefaultModelIdForProvider(
  providerId: LlmProviderId,
): LlmModelId {
  const providerModelList = getModelListByProvider(providerId);
  const defaultModel = providerModelList.find((m) => m.isDefault);
  return defaultModel?.id ?? providerModelList[0]?.id ?? DEFAULT_LLM_MODEL_ID;
}

// 遷移鏈解析上限：防止 map 內互指造成無窮迴圈
const MAX_MIGRATION_HOPS = 5;

/**
 * 安全取得 LLM 模型 ID：若 savedId 不在 registry 則沿遷移表迴圈解析，
 * 解析失敗則 fallback 到預設。處理舊版升級（null）和模型下架的情境。
 *
 * 迴圈解析（而非單跳查找）是刻意的：歷次下架累積的舊 entry 可能指向
 * 「後來也被下架」的模型，單跳會回傳 registry 查不到的死值，且下游
 * provider 交叉驗證對 undefined config 短路、救不回來。此函式保證
 * 回傳值必存在於當前 registry。
 */
export function getEffectiveLlmModelId(savedId: string | null): LlmModelId {
  let candidate = savedId;
  for (let hop = 0; candidate && hop < MAX_MIGRATION_HOPS; hop += 1) {
    if (findLlmModelConfig(candidate)) return candidate as LlmModelId;
    const next: string | undefined = DECOMMISSIONED_MODEL_MAP[candidate];
    if (!next) break;
    candidate = next;
  }
  // 迴圈上限用盡後，最後一跳的結果仍可能是存活模型 → 補驗一次（避免 off-by-one 誤退預設）
  if (candidate && findLlmModelConfig(candidate)) return candidate as LlmModelId;
  return DEFAULT_LLM_MODEL_ID;
}

/**
 * 安全取得 Whisper 模型 ID：若 savedId 不在 registry 則 fallback 到預設。
 */
export function getEffectiveWhisperModelId(
  savedId: string | null,
): WhisperModelId {
  if (savedId && findWhisperModelConfig(savedId))
    return savedId as WhisperModelId;
  return DEFAULT_WHISPER_MODEL_ID;
}

/**
 * 安全取得轉錄 provider：未知值（壞掉的匯入檔／舊版殘留）一律退回預設，
 * 避免把金鑰送到非預期的服務（Rust 端亦 fail-closed 拒絕未知 provider）。
 */
export function getEffectiveTranscriptionProviderId(
  savedId: string | null | undefined,
): TranscriptionProviderId {
  return savedId === "azure" || savedId === "gemini" || savedId === "groq"
    ? savedId
    : DEFAULT_TRANSCRIPTION_PROVIDER_ID;
}
