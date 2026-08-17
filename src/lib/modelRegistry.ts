// ── LLM Provider ──────────────────────────────────────────

export type LlmProviderId = "groq" | "openai" | "anthropic" | "gemini" | "azure";

export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "groq";

// ── Azure / Microsoft Foundry chat 模型類型 ────────────────

/**
 * Azure OpenAI v1 的 `model` 是使用者取的部署名稱，無法從名稱可靠推斷底層模型。
 * 這個類型讓使用者明確選擇部署的 wire 行為，而不是以字串猜測。
 */
export type AzureChatModelFamilyId =
  | "azure-openai"
  | "azure-openai-reasoning"
  | "deepseek"
  | "kimi"
  | "grok"
  | "grok-reasoning"
  | "llama"
  | "mistral"
  | "cohere"
  | "other"
  | "other-reasoning";

/**
 * 模型類型的來源。舊設定一律視為 manual，避免新版本在背景覆寫使用者既有選擇。
 */
export type AzureChatModelFamilySource = "auto" | "manual";

export interface AzureFoundryModelMetadata {
  modelName?: string;
  modelPublisher?: string;
}

export interface AzureChatModelFamilyResolution {
  familyId: AzureChatModelFamilyId;
  confidence: "high" | "low";
}

export interface AzureChatModelFamilyConfig {
  id: AzureChatModelFamilyId;
  displayName: string;
  descriptionKey: string;
  isReasoning: boolean;
  /** 單一 HTTP 請求的產品逾時上限；不是服務端的最大允許值。 */
  timeoutMs: number;
  /** 同步貼上流程全部 retry 合計的上限，避免多次 retry 無限延長等待。 */
  totalDeadlineMs: number;
  /** 一般文字整理的預設 max_completion_tokens。 */
  defaultMaxTokens: number;
  /**
   * 此類型內最保守的官方 Output token 上限。服務端對超限的行為未文件化，
   * 因此 client 端先 clamp，避免部分模型直接回 400。
   */
  maxCompletionTokens: number;
}

const NON_REASONING_TIMEOUT_MS = 30_000;
const REASONING_TIMEOUT_MS = 60_000;
const NON_REASONING_TOTAL_DEADLINE_MS = 60_000;
const REASONING_TOTAL_DEADLINE_MS = 120_000;

export const DEFAULT_AZURE_CHAT_MODEL_FAMILY_ID: AzureChatModelFamilyId =
  "azure-openai";

export const DEFAULT_AZURE_CHAT_MODEL_FAMILY_SOURCE: AzureChatModelFamilySource =
  "manual";

/**
 * Azure 直售模型的行為 profile。
 *
 * maxCompletionTokens 取該 family 已文件化模型的最低 output 上限。例如 Grok、
 * Llama 3.3 與 Cohere Command A 分別只有 8,192、8,192、8,182 token。
 */
export const AZURE_CHAT_MODEL_FAMILY_LIST: AzureChatModelFamilyConfig[] = [
  {
    id: "azure-openai",
    displayName: "Azure OpenAI (GPT-4o / GPT-4.1)",
    descriptionKey: "settings.azure.modelFamilyDescription.azureOpenai",
    isReasoning: false,
    timeoutMs: NON_REASONING_TIMEOUT_MS,
    totalDeadlineMs: NON_REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 16_384,
  },
  {
    id: "azure-openai-reasoning",
    displayName: "Azure OpenAI reasoning (GPT-5)",
    descriptionKey: "settings.azure.modelFamilyDescription.azureOpenaiReasoning",
    isReasoning: true,
    timeoutMs: REASONING_TIMEOUT_MS,
    totalDeadlineMs: REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 32_768,
  },
  {
    id: "deepseek",
    displayName: "DeepSeek (V3.2 / V4)",
    descriptionKey: "settings.azure.modelFamilyDescription.deepseek",
    isReasoning: true,
    timeoutMs: REASONING_TIMEOUT_MS,
    totalDeadlineMs: REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 128_000,
  },
  {
    id: "kimi",
    displayName: "Moonshot Kimi (K2)",
    descriptionKey: "settings.azure.modelFamilyDescription.kimi",
    isReasoning: true,
    timeoutMs: REASONING_TIMEOUT_MS,
    totalDeadlineMs: REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 262_144,
  },
  {
    id: "grok",
    displayName: "xAI Grok (non-reasoning)",
    descriptionKey: "settings.azure.modelFamilyDescription.grok",
    isReasoning: false,
    timeoutMs: NON_REASONING_TIMEOUT_MS,
    totalDeadlineMs: NON_REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 8_192,
  },
  {
    id: "grok-reasoning",
    displayName: "xAI Grok (reasoning)",
    descriptionKey: "settings.azure.modelFamilyDescription.grokReasoning",
    isReasoning: true,
    timeoutMs: REASONING_TIMEOUT_MS,
    totalDeadlineMs: REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 8_192,
  },
  {
    id: "llama",
    displayName: "Meta Llama",
    descriptionKey: "settings.azure.modelFamilyDescription.llama",
    isReasoning: false,
    timeoutMs: NON_REASONING_TIMEOUT_MS,
    totalDeadlineMs: NON_REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 8_192,
  },
  {
    id: "mistral",
    displayName: "Mistral",
    descriptionKey: "settings.azure.modelFamilyDescription.mistral",
    isReasoning: false,
    timeoutMs: NON_REASONING_TIMEOUT_MS,
    totalDeadlineMs: NON_REASONING_TOTAL_DEADLINE_MS,
    // Mistral Large 3 的 Foundry model card 未列 output 上限，採保守值。
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 8_192,
  },
  {
    id: "cohere",
    displayName: "Cohere Command A",
    descriptionKey: "settings.azure.modelFamilyDescription.cohere",
    isReasoning: false,
    timeoutMs: NON_REASONING_TIMEOUT_MS,
    totalDeadlineMs: NON_REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 8_182,
  },
  {
    id: "other",
    displayName: "Other OpenAI-compatible model",
    descriptionKey: "settings.azure.modelFamilyDescription.other",
    isReasoning: false,
    timeoutMs: NON_REASONING_TIMEOUT_MS,
    totalDeadlineMs: NON_REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 8_192,
  },
  {
    id: "other-reasoning",
    displayName: "Other reasoning model",
    descriptionKey: "settings.azure.modelFamilyDescription.otherReasoning",
    isReasoning: true,
    timeoutMs: REASONING_TIMEOUT_MS,
    totalDeadlineMs: REASONING_TOTAL_DEADLINE_MS,
    defaultMaxTokens: 8_192,
    maxCompletionTokens: 16_384,
  },
];

export function findAzureChatModelFamilyConfig(
  id: string,
): AzureChatModelFamilyConfig | undefined {
  return AZURE_CHAT_MODEL_FAMILY_LIST.find((family) => family.id === id);
}

export function isAzureChatModelFamilyId(
  id: unknown,
): id is AzureChatModelFamilyId {
  return typeof id === "string" && findAzureChatModelFamilyConfig(id) !== undefined;
}

export function isAzureChatModelFamilySource(
  source: unknown,
): source is AzureChatModelFamilySource {
  return source === "auto" || source === "manual";
}

/** 未知值（舊備份／手動編輯的 store）一律安全退回 Azure OpenAI profile。 */
export function getEffectiveAzureChatModelFamilyId(
  savedId: string | null | undefined,
): AzureChatModelFamilyId {
  return savedId && isAzureChatModelFamilyId(savedId)
    ? savedId
    : DEFAULT_AZURE_CHAT_MODEL_FAMILY_ID;
}

/** 缺少來源欄位代表舊設定，必須保留使用者既有模型類型。 */
export function getEffectiveAzureChatModelFamilySource(
  savedSource: unknown,
): AzureChatModelFamilySource {
  return isAzureChatModelFamilySource(savedSource)
    ? savedSource
    : DEFAULT_AZURE_CHAT_MODEL_FAMILY_SOURCE;
}

export function mapFoundryModelToFamily(
  publisher: string | null | undefined,
  modelName: string | null | undefined,
): AzureChatModelFamilyId | undefined {
  const normalizedPublisher = publisher?.trim().toLowerCase() ?? "";
  const normalizedModelName = modelName?.trim().toLowerCase() ?? "";
  const has = (...valueList: string[]) =>
    valueList.some(
      (value) =>
        normalizedPublisher.includes(value) || normalizedModelName.includes(value),
    );

  if (has("deepseek")) return "deepseek";
  if (has("moonshot", "kimi")) return "kimi";
  if (has("xai", "grok")) {
    return normalizedModelName.includes("reasoning") ||
      normalizedModelName.includes("thinking")
      ? "grok-reasoning"
      : "grok";
  }
  if (has("meta", "llama")) return "llama";
  if (has("mistral")) return "mistral";
  if (has("cohere", "command")) return "cohere";
  if (has("openai", "gpt-", "o1", "o3", "o4")) {
    return normalizedModelName.startsWith("o") ||
      normalizedModelName.includes("gpt-5") ||
      normalizedModelName.includes("reasoning")
      ? "azure-openai-reasoning"
      : "azure-openai";
  }
  return undefined;
}

/**
 * 部署名稱完全由使用者自訂，這只能是 UI 建議，絕不可自動持久化。
 */
export function suggestAzureChatModelFamily(
  deploymentName: string,
): AzureChatModelFamilyId | undefined {
  return mapFoundryModelToFamily(undefined, deploymentName);
}

/**
 * 僅使用 Foundry 回傳的 metadata 來自動選擇 profile。
 * 未知模型使用保守 profile，絕不沿用前一個部署的模型類型。
 */
export function resolveAzureFamilyFromDeployment(
  deployment: AzureFoundryModelMetadata,
): AzureChatModelFamilyResolution {
  const familyId = mapFoundryModelToFamily(
    deployment.modelPublisher,
    deployment.modelName,
  );
  if (familyId) return { familyId, confidence: "high" };

  const normalizedModelName = deployment.modelName?.trim().toLowerCase() ?? "";
  const isReasoning =
    normalizedModelName.includes("reasoning") ||
    normalizedModelName.includes("thinking") ||
    /(?:^|[-_])r1(?:$|[-_])/.test(normalizedModelName);

  return {
    familyId: isReasoning ? "other-reasoning" : "other",
    confidence: "low",
  };
}

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

/** 語音轉錄 provider。Gemini 與 MAI 均有專屬協定，非 Whisper multipart API。 */
export type TranscriptionProviderId = "groq" | "azure" | "gemini" | "mai";

/**
 * 轉錄服務的使用者可見名稱。皆為專有名詞，五種介面語言共用。
 * 使用 Record 讓新增 provider 時編譯器強制補齊顯示名稱。
 */
export const TRANSCRIPTION_PROVIDER_DISPLAY_NAME: Record<
  TranscriptionProviderId,
  string
> = {
  groq: "Groq Whisper",
  azure: "Azure OpenAI Whisper",
  gemini: "Gemini",
  mai: "MAI-Transcribe",
};

/**
 * 免費額度的計算週期。多數 provider 是每日（如 Gemini 的 RPD、Groq 的 RPD），
 * 但也有「每月 N 次免費」的方案（例：Gemini 的 Google Search grounding 每月 5,000 次），
 * 因此額度模型必須同時支援兩種週期。
 */
export type QuotaPeriod = "daily" | "monthly";

export const DEFAULT_QUOTA_PERIOD: QuotaPeriod = "daily";

export const DEFAULT_TRANSCRIPTION_PROVIDER_ID: TranscriptionProviderId = "groq";

/** Azure AI Speech LLM Speech API 的 MAI-Transcribe 模型 ID。 */
export const MAI_TRANSCRIPTION_MODEL_ID = "mai-transcribe-1.5" as const;

/** MAI 的預設輸出已最佳化可讀性；`verbatim` 才會傳到服務端。 */
export type MaiTranscribeStyle = "default" | "verbatim";

export function getEffectiveMaiTranscribeStyle(
  savedStyle: string | null | undefined,
): MaiTranscribeStyle {
  return savedStyle === "verbatim" ? "verbatim" : "default";
}

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
    // badge 是「正式版」而非「成本高」：本模型 $0.15/$0.60 是全 registry 第二便宜
    // （僅次於 20B），且 Groq 三個模型都有免費額度，成本不是這裡的區分軸。
    // 真正的差異是預設的 qwen 為 preview（可能無預警下架），本模型是正式版。
    badgeKey: "settings.modelBadge.stableProduction",
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
  return savedId === "azure" ||
    savedId === "gemini" ||
    savedId === "groq" ||
    savedId === "mai"
    ? savedId
    : DEFAULT_TRANSCRIPTION_PROVIDER_ID;
}
