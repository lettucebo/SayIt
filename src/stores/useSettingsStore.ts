import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { setDockVisibility } from "@tauri-apps/api/app";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "../types";
import {
  type HotkeyConfig,
  type TriggerKey,
  type CustomTriggerKey,
  type ComboTriggerKey,
  type PromptMode,
  PROMPT_MODE_VALUES,
  type ThemeMode,
  isCustomTriggerKey,
  isComboTriggerKey,
  isPresetTriggerKey,
  type AzureAuthMode,
  type AzureAuthHeaderMode,
  toAzureAuthMode,
  toAzureAuthHeaderMode,
} from "../types/settings";
import {
  getKeyDisplayName,
  getComboTriggerKeyDisplayName,
  getPlatformKeycode,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
  getEscapeReservedMessage,
} from "../lib/keycodeMap";
import {
  extractErrorMessage,
  getHotkeyRecordingTimeoutMessage,
  getHotkeyUnsupportedKeyMessage,
  getHotkeyPresetHint,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { setFileLoggingEnabled } from "../lib/logger";
import { getDefaultSystemPrompt } from "../lib/enhancer";
import {
  getMinimalPromptForLocale,
  getPromptForModeAndLocale,
  isKnownDefaultPrompt,
} from "../i18n/prompts";
import i18n, { switchLocale } from "../i18n";
import {
  type SupportedLocale,
  type TranscriptionLocale,
  FALLBACK_LOCALE,
  detectSystemLocale,
  getHtmlLangForLocale,
  getWhisperCodeForTranscriptionLocale,
} from "../i18n/languageConfig";
import {
  emitEvent,
  SETTINGS_UPDATED,
  AZURE_AUTH_STATE_CHANGED,
} from "../composables/useTauriEvents";
import type {
  SettingsUpdatedPayload,
  AzureAuthStateChangedPayload,
} from "../types/events";
import { applyTheme, DEFAULT_THEME_MODE, isThemeMode } from "../lib/theme";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_LLM_PROVIDER_ID,
  DEFAULT_WHISPER_MODEL_ID,
  getEffectiveLlmModelId,
  getEffectiveWhisperModelId,
  getDefaultModelIdForProvider,
  findLlmModelConfig,
  type LlmModelId,
  type LlmProviderId,
  type WhisperModelId,
  type TranscriptionProviderId,
  type QuotaPeriod,
  type GeminiTranscriptionModelId,
  DEFAULT_QUOTA_PERIOD,
  GEMINI_TRANSCRIPTION_MODEL,
  getEffectiveTranscriptionProviderId,
  getEffectiveGeminiTranscriptionModelId,
} from "../lib/modelRegistry";
import {
  normalizeAzureEndpoint,
  type AzureRequestOptions,
} from "../lib/llmProvider";
import {
  getAzureAccessToken,
  clearAzureTokenCache,
  getAzureScopeForApiKind,
} from "../lib/azureAuth";
import {
  type AzureUserAccount,
  getAzureUserAccount,
  getAzureUserToken,
  matchesCredentials,
  newSignInOperationId,
  signInAzureUser,
  signOutAzureUser,
  cancelAzureUserSignIn,
} from "../lib/azureUserAuth";
import {
  EXPORTABLE_SETTING_KEYS,
  stripSensitiveKeys,
  type ExportableSettingKey,
  type SettingsPayload,
} from "../lib/settingsTransfer";

declare const __APP_VERSION__: string;

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_CONTEXT_INJECTION_ENABLED = false;
export const DEFAULT_MUTE_ON_RECORDING = true;
// 全平台啟用：macOS 走 AXUIElement、Windows 走 UI Automation，兩邊都能讀游標所在
// 輸入框（`text_field_reader.rs`）。
// 密碼欄位守衛目前**不對稱**：Windows 用 `CurrentIsPassword` fail-closed 排除；
// macOS 僅以 AXRole 過濾，倚賴系統不對 secure field 暴露 AXValue（追蹤中，見 issue 67）。
const DEFAULT_SMART_DICTIONARY_ENABLED = true;
const DEFAULT_SOUND_EFFECTS_ENABLED = true;
const DEFAULT_HIDE_DOCK_ICON = false;
const IS_MACOS = navigator.userAgent.includes("Mac");
const DEFAULT_PROMPT_MODE: PromptMode = "minimal";
const DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED = false;
const DEFAULT_RECORDING_AUTO_CLEANUP_DAYS = 7;
const DEFAULT_DEBUG_LOG_ENABLED = false;
const DEFAULT_DEBUG_LOG_RETENTION_DAYS = 7;
const DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD = true;

function getDefaultTriggerKey(): TriggerKey {
  const isMac = navigator.userAgent.includes("Mac");
  return isMac ? "fn" : "rightAlt";
}

const PRESET_KEY_DISPLAY_NAMES: Record<string, string> = {
  fn: "Fn",
  option: "Option (⌥)",
  rightOption: "Right Option (⌥)",
  command: "Command (⌘)",
  rightAlt: "Right Alt",
  leftAlt: "Left Alt",
  control: "Control (⌃)",
  rightControl: "Right Control",
  shift: "Shift (⇧)",
};

export const useSettingsStore = defineStore("settings", () => {
  const hotkeyConfig = ref<HotkeyConfig | null>(null);
  const triggerMode = computed<TriggerMode>(
    () => hotkeyConfig.value?.triggerMode ?? "hold",
  );
  const apiKey = ref<string>("");
  const hasApiKey = computed(() => apiKey.value !== "");
  const aiPrompt = ref<string>(getDefaultSystemPrompt());
  const promptMode = ref<PromptMode>(DEFAULT_PROMPT_MODE);
  const showPromptUpgradeNotice = ref(false);
  const isAutoStartEnabled = ref(false);
  const isEnhancementThresholdEnabled = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  );
  const enhancementThresholdCharCount = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
  );
  const selectedLlmProviderId = ref<LlmProviderId>(DEFAULT_LLM_PROVIDER_ID);
  const selectedLlmModelId = ref<LlmModelId>(DEFAULT_LLM_MODEL_ID);
  const selectedWhisperModelId = ref<WhisperModelId>(DEFAULT_WHISPER_MODEL_ID);
  const openaiApiKey = ref<string>("");
  const anthropicApiKey = ref<string>("");
  const geminiApiKey = ref<string>("");
  const hasLlmApiKey = computed(() => {
    switch (selectedLlmProviderId.value) {
      case "groq":
        return apiKey.value !== "";
      case "openai":
        return openaiApiKey.value !== "";
      case "anthropic":
        return anthropicApiKey.value !== "";
      case "gemini":
        return geminiApiKey.value !== "";
      case "azure":
        return (
          azureEnabled.value &&
          azureEndpoint.value !== "" &&
          azureChatDeployment.value !== "" &&
          hasAzureCredentials.value
        );
      default:
        // exhaustiveness：若 LlmProviderId 新增成員，這行會 type error
        selectedLlmProviderId.value satisfies never;
        return false;
    }
  });
  const customTriggerKey = ref<CustomTriggerKey | ComboTriggerKey | null>(null);
  const isMuteOnRecordingEnabled = ref<boolean>(DEFAULT_MUTE_ON_RECORDING);
  const isSmartDictionaryEnabled = ref<boolean>(
    DEFAULT_SMART_DICTIONARY_ENABLED,
  );
  const customTriggerKeyDomCode = ref<string>("");
  const selectedLocale = ref<SupportedLocale>(FALLBACK_LOCALE);
  const selectedTranscriptionLocale = ref<TranscriptionLocale>(FALLBACK_LOCALE);
  const themeMode = ref<ThemeMode>(DEFAULT_THEME_MODE);
  const isSoundEffectsEnabled = ref<boolean>(DEFAULT_SOUND_EFFECTS_ENABLED);
  const isHideDockIconEnabled = ref<boolean>(DEFAULT_HIDE_DOCK_ICON);
  const isRecordingAutoCleanupEnabled = ref<boolean>(
    DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED,
  );
  const recordingAutoCleanupDays = ref<number>(
    DEFAULT_RECORDING_AUTO_CLEANUP_DAYS,
  );
  // 除錯記錄（Debug Log）— 與錄音清理完全獨立的設定
  const isDebugLogEnabled = ref<boolean>(DEFAULT_DEBUG_LOG_ENABLED);
  const debugLogRetentionDays = ref<number>(DEFAULT_DEBUG_LOG_RETENTION_DAYS);
  const selectedAudioInputDeviceName = ref<string>("");
  const isCopyTranscriptionToClipboardEnabled = ref<boolean>(
    DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD,
  );
  const contextInjectionEnabled = ref<boolean>(
    DEFAULT_CONTEXT_INJECTION_ENABLED,
  );
  // ── Azure / Microsoft Foundry ──
  const azureEnabled = ref<boolean>(false);
  const azureEndpoint = ref<string>("");
  const azureAuthMode = ref<AzureAuthMode>("key");
  const azureApiKey = ref<string>("");
  const azureTenantId = ref<string>("");
  const azureClientId = ref<string>("");
  const azureClientSecret = ref<string>("");
  const azureApiVersion = ref<string>("");
  const azureOmitTemperature = ref<boolean>(false);
  const azureChatDeployment = ref<string>("");
  const azureWhisperDeployment = ref<string>("");
  /**
   * `entraUser` 模式下目前已登入的帳號。真實來源在 Rust（OS 憑證庫），
   * 這裡只是給 UI 與 computed 用的快照，由 `refreshAzureUserAccount()` 同步。
   */
  const azureUserAccount = ref<AzureUserAccount | null>(null);

  /**
   * 已登入的帳號是否對應「目前這組」tenant/client。
   * 只判斷 account 非 null 不夠：使用者改了 Client ID 但快照還是舊帳號時會誤判已登入。
   */
  const isAzureUserSignedIn = computed(() =>
    matchesCredentials(azureUserAccount.value, {
      tenantId: azureTenantId.value,
      clientId: azureClientId.value,
    }),
  );

  /** 三種驗證模式各自的憑證完整性判斷。 */
  const hasAzureCredentials = computed(() => {
    switch (azureAuthMode.value) {
      case "key":
        return azureApiKey.value !== "";
      case "entra":
        return (
          azureTenantId.value !== "" &&
          azureClientId.value !== "" &&
          azureClientSecret.value !== ""
        );
      case "entraUser":
        return isAzureUserSignedIn.value;
      default:
        // exhaustiveness：若 AzureAuthMode 新增成員，這行會 type error
        azureAuthMode.value satisfies never;
        return false;
    }
  });
  const whisperProviderId = ref<TranscriptionProviderId>("groq");
  /** Gemini 轉錄模型（Flash-Lite 免費額度高、Flash 品質優先） */
  const geminiTranscriptionModelId = ref<GeminiTranscriptionModelId>(
    GEMINI_TRANSCRIPTION_MODEL,
  );
  /** Gemini 轉錄免費額度（0 = 未設定）；Google 不公開 Free tier 數字，只能由使用者填入。 */
  const geminiFreeQuotaRequests = ref<number>(0);
  const geminiFreeQuotaPeriod = ref<QuotaPeriod>(DEFAULT_QUOTA_PERIOD);
  const hasWhisperConfig = computed(() => {
    if (whisperProviderId.value === "gemini") return geminiApiKey.value !== "";
    if (whisperProviderId.value !== "azure") return apiKey.value !== "";
    return (
      azureEnabled.value &&
      azureEndpoint.value !== "" &&
      azureWhisperDeployment.value !== "" &&
      hasAzureCredentials.value
    );
  });
  let isLoaded = false;

  /** Resolve which SupportedLocale to use for prompt default (shared logic). */
  function getEffectivePromptLocale(): SupportedLocale {
    return selectedTranscriptionLocale.value === "auto"
      ? selectedLocale.value
      : selectedTranscriptionLocale.value;
  }

  function getApiKey(): string {
    return apiKey.value;
  }

  function getLlmApiKey(): string {
    switch (selectedLlmProviderId.value) {
      case "groq":
        return apiKey.value;
      case "openai":
        return openaiApiKey.value;
      case "anthropic":
        return anthropicApiKey.value;
      case "gemini":
        return geminiApiKey.value;
      case "azure":
        return azureAuthMode.value === "key" ? azureApiKey.value : "";
    }
  }

  function getAzureRequestOptions(
    authValue: string,
    authMode: AzureAuthHeaderMode = toAzureAuthHeaderMode(azureAuthMode.value),
  ): AzureRequestOptions {
    return {
      endpoint: azureEndpoint.value,
      apiVersion: azureApiVersion.value || undefined,
      authMode,
      authValue,
      omitTemperature: azureOmitTemperature.value,
    };
  }

  /**
   * 解析一次 LLM 請求所需的 auth + provider + model。
   * Azure-Entra 需非同步換 token，故此方法為 async。
   */
  async function getLlmRequestConfig(): Promise<{
    apiKey: string;
    provider: LlmProviderId;
    modelId: string;
    azure?: AzureRequestOptions;
  }> {
    const provider = selectedLlmProviderId.value;
    if (provider !== "azure") {
      return {
        apiKey: getLlmApiKey(),
        provider,
        modelId: selectedLlmModelId.value,
      };
    }

    // Azure 設定不完整 → 回空 apiKey，呼叫端走「未設定」流程（不打 token / 不送請求）
    if (
      !azureEnabled.value ||
      azureEndpoint.value === "" ||
      azureChatDeployment.value === ""
    ) {
      return { apiKey: "", provider, modelId: azureChatDeployment.value };
    }

    // chat 走 v1 路徑（/openai/v1/）→ ai.azure.com 受眾
    if (azureAuthMode.value === "entraUser") {
      const token = await getAzureUserToken(
        { tenantId: azureTenantId.value, clientId: azureClientId.value },
        "chat",
      );
      // 明確固定成 "bearer"：等待 token 期間另一個視窗可能已把 authMode 改掉，
      // 若回頭再讀 reactive 值，這個 bearer token 會被塞進 api-key header。
      return {
        apiKey: token,
        provider,
        modelId: azureChatDeployment.value,
        azure: getAzureRequestOptions(token, "bearer"),
      };
    }

    const scope = getAzureScopeForApiKind("chat");
    if (azureAuthMode.value === "entra") {
      const token = await getAzureAccessToken(
        {
          tenantId: azureTenantId.value,
          clientId: azureClientId.value,
          clientSecret: azureClientSecret.value,
        },
        scope,
      );
      return {
        apiKey: token,
        provider,
        modelId: azureChatDeployment.value,
        azure: getAzureRequestOptions(token, "bearer"),
      };
    }

    return {
      apiKey: azureApiKey.value,
      provider,
      modelId: azureChatDeployment.value,
      azure: getAzureRequestOptions(azureApiKey.value, "key"),
    };
  }

  /** 用於 usage 記錄/成本計算的有效 chat 模型：Azure 用部署名，其餘用 selectedLlmModelId。 */
  function getEffectiveChatModel(): string {
    return selectedLlmProviderId.value === "azure"
      ? azureChatDeployment.value
      : selectedLlmModelId.value;
  }

  /**
   * 解析語音轉錄所需的 auth + provider + 模型 + Azure 連線參數。
   * Azure-Entra 用 cognitiveservices scope（deployments 路徑）。
   * modelId 由 provider 決定：Gemini 有自己的固定轉錄模型，不可沿用 WhisperModelId。
   */
  async function getWhisperRequestConfig(): Promise<{
    apiKey: string;
    provider: TranscriptionProviderId;
    modelId: string;
    endpoint?: string;
    deployment?: string;
    apiVersion?: string;
    authMode?: AzureAuthHeaderMode;
  }> {
    // Gemini 走 generateContent，模型固定（沿用 whisper-large-v3 會打到不存在的端點）
    if (whisperProviderId.value === "gemini") {
      return {
        apiKey: geminiApiKey.value,
        provider: "gemini",
        modelId: geminiTranscriptionModelId.value,
      };
    }

    if (whisperProviderId.value !== "azure") {
      return {
        apiKey: apiKey.value,
        provider: "groq",
        modelId: selectedWhisperModelId.value,
      };
    }

    if (
      !azureEnabled.value ||
      azureEndpoint.value === "" ||
      azureWhisperDeployment.value === ""
    ) {
      return {
        apiKey: "",
        provider: "azure",
        modelId: selectedWhisperModelId.value,
      };
    }

    const base = {
      provider: "azure" as const,
      modelId: selectedWhisperModelId.value,
      endpoint: azureEndpoint.value,
      deployment: azureWhisperDeployment.value,
      apiVersion: azureApiVersion.value || undefined,
    };

    // whisper 走傳統 deployments 路徑 → cognitiveservices 受眾
    if (azureAuthMode.value === "entraUser") {
      const token = await getAzureUserToken(
        { tenantId: azureTenantId.value, clientId: azureClientId.value },
        "whisper",
      );
      return { ...base, apiKey: token, authMode: "bearer" };
    }

    const scope = getAzureScopeForApiKind("whisper");
    if (azureAuthMode.value === "entra") {
      const token = await getAzureAccessToken(
        {
          tenantId: azureTenantId.value,
          clientId: azureClientId.value,
          clientSecret: azureClientSecret.value,
        },
        scope,
      );
      return { ...base, apiKey: token, authMode: "bearer" };
    }

    return { ...base, apiKey: azureApiKey.value, authMode: "key" };
  }

  async function syncHotkeyConfigToRust(key: TriggerKey, mode: TriggerMode) {
    try {
      await invoke("update_hotkey_config", {
        triggerKey: key,
        triggerMode: mode,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] Failed to sync hotkey config:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "sync-hotkey" });
    }
  }

  async function loadSettings() {
    if (isLoaded) return;

    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedApiKey = await store.get<string>("groqApiKey");

      // Backward-compatible key parsing: string → PresetTriggerKey, object → CustomTriggerKey
      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };
      apiKey.value = savedApiKey?.trim() ?? "";

      // Load independently persisted custom/combo key
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      if (
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        (isCustomTriggerKey(savedCustomKey) ||
          isComboTriggerKey(savedCustomKey))
      ) {
        customTriggerKey.value = savedCustomKey;
        customTriggerKeyDomCode.value = savedCustomDomCode ?? "";
      }

      // Load locale (first launch: detect system language, upgrade: fallback to zh-TW)
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      if (savedLocale) {
        selectedLocale.value = savedLocale;
      } else {
        const detected = detectSystemLocale();
        selectedLocale.value = detected;
        await store.set("selectedLocale", detected);
        await store.save();
      }
      await switchLocale(selectedLocale.value);
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      // Load transcription locale (migration: default to UI locale if missing)
      const savedTranscriptionLocale = await store.get<TranscriptionLocale>(
        "selectedTranscriptionLocale",
      );
      if (savedTranscriptionLocale) {
        selectedTranscriptionLocale.value = savedTranscriptionLocale;
      } else {
        selectedTranscriptionLocale.value = selectedLocale.value;
        await store.set("selectedTranscriptionLocale", selectedLocale.value);
        await store.save();
      }

      // Load theme mode (default: follow system)
      const savedThemeMode = await store.get<ThemeMode>("themeMode");
      themeMode.value = isThemeMode(savedThemeMode)
        ? savedThemeMode
        : DEFAULT_THEME_MODE;
      applyTheme(themeMode.value);

      // Load aiPrompt once (used by both migration and normal flow)
      const savedPrompt = await store.get<string>("aiPrompt");
      const trimmedSavedPrompt = savedPrompt?.trim() ?? "";

      // Prompt mode migration
      const savedPromptMode = await store.get<string>("promptMode");
      if (
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
      ) {
        promptMode.value = savedPromptMode as PromptMode;
      } else if (!savedPromptMode) {
        // 舊版升級遷移
        if (!trimmedSavedPrompt || isKnownDefaultPrompt(trimmedSavedPrompt)) {
          promptMode.value = "minimal";
        } else {
          promptMode.value = "custom";
        }
        await store.set("promptMode", promptMode.value);
        await store.save();
      }

      aiPrompt.value =
        trimmedSavedPrompt ||
        getMinimalPromptForLocale(getEffectivePromptLocale());

      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;

      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;

      // LLM Provider
      const savedLlmProviderId =
        await store.get<LlmProviderId>("llmProviderId");
      selectedLlmProviderId.value = savedLlmProviderId ?? DEFAULT_LLM_PROVIDER_ID;

      // OpenAI / Anthropic API keys
      const savedOpenaiApiKey = await store.get<string>("openaiApiKey");
      openaiApiKey.value = savedOpenaiApiKey?.trim() ?? "";
      const savedAnthropicApiKey = await store.get<string>("anthropicApiKey");
      anthropicApiKey.value = savedAnthropicApiKey?.trim() ?? "";
      const savedGeminiApiKey = await store.get<string>("geminiApiKey");
      geminiApiKey.value = savedGeminiApiKey?.trim() ?? "";

      // Azure / Microsoft Foundry
      azureEnabled.value = (await store.get<boolean>("azureEnabled")) ?? false;
      azureEndpoint.value =
        (await store.get<string>("azureEndpoint"))?.trim() ?? "";
      azureAuthMode.value =
        toAzureAuthMode(await store.get("azureAuthMode"));
      azureApiKey.value = (await store.get<string>("azureApiKey"))?.trim() ?? "";
      azureTenantId.value =
        (await store.get<string>("azureTenantId"))?.trim() ?? "";
      azureClientId.value =
        (await store.get<string>("azureClientId"))?.trim() ?? "";
      azureClientSecret.value =
        (await store.get<string>("azureClientSecret")) ?? "";
      azureApiVersion.value =
        (await store.get<string>("azureApiVersion"))?.trim() ?? "";
      azureOmitTemperature.value =
        (await store.get<boolean>("azureOmitTemperature")) ?? false;
      azureChatDeployment.value =
        (await store.get<string>("azureChatDeployment"))?.trim() ?? "";
      azureWhisperDeployment.value =
        (await store.get<string>("azureWhisperDeployment"))?.trim() ?? "";
      whisperProviderId.value = getEffectiveTranscriptionProviderId(
        await store.get<string>("whisperProviderId"),
      );
      geminiFreeQuotaRequests.value =
        (await store.get<number>("geminiFreeQuotaRequests")) ?? 0;
      geminiFreeQuotaPeriod.value =
        (await store.get<QuotaPeriod>("geminiFreeQuotaPeriod")) ??
        DEFAULT_QUOTA_PERIOD;
      geminiTranscriptionModelId.value = getEffectiveGeminiTranscriptionModelId(
        await store.get<string>("geminiTranscriptionModelId"),
      );

      // LLM Model ID（含 Kimi K2 遷移）
      const savedLlmModelId = await store.get<string>("llmModelId");
      const llmMigratedFromKimiK2 = await store.get<boolean>(
        "llmMigratedFromKimiK2",
      );
      if (
        !llmMigratedFromKimiK2 &&
        savedLlmModelId === "moonshotai/kimi-k2-instruct"
      ) {
        selectedLlmModelId.value = DEFAULT_LLM_MODEL_ID;
        selectedLlmProviderId.value = "groq";
        await store.set("llmModelId", DEFAULT_LLM_MODEL_ID);
        await store.set("llmProviderId", "groq");
        await store.set("llmMigratedFromKimiK2", true);
        await store.save();
      } else {
        const effectiveLlmModelId = getEffectiveLlmModelId(
          savedLlmModelId ?? null,
        );
        selectedLlmModelId.value = effectiveLlmModelId;
      }

      // model-provider 交叉驗證：防止 key 洩漏到錯誤 provider
      const modelConfig = findLlmModelConfig(selectedLlmModelId.value);
      if (
        selectedLlmProviderId.value !== "azure" &&
        modelConfig &&
        modelConfig.providerId !== selectedLlmProviderId.value
      ) {
        selectedLlmModelId.value = getDefaultModelIdForProvider(
          selectedLlmProviderId.value,
        );
        await store.set("llmModelId", selectedLlmModelId.value);
        await store.save();
      }

      const savedWhisperModelId = await store.get<string>("whisperModelId");
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );

      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;

      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;

      const savedHideDockIcon = await store.get<boolean>("hideDockIcon");
      isHideDockIconEnabled.value = savedHideDockIcon ?? DEFAULT_HIDE_DOCK_ICON;

      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;

      const savedRecordingAutoCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecordingAutoCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;

      const savedRecordingAutoCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecordingAutoCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedDebugLogEnabled = await store.get<boolean>("debugLogEnabled");
      isDebugLogEnabled.value = savedDebugLogEnabled ?? DEFAULT_DEBUG_LOG_ENABLED;

      const savedDebugLogRetentionDays = await store.get<number>(
        "debugLogRetentionDays",
      );
      debugLogRetentionDays.value =
        savedDebugLogRetentionDays ?? DEFAULT_DEBUG_LOG_RETENTION_DAYS;

      const savedAudioInputDeviceName = await store.get<string>(
        "audioInputDeviceName",
      );
      selectedAudioInputDeviceName.value = savedAudioInputDeviceName ?? "";

      const savedCopyTranscriptionToClipboard = await store.get<boolean>(
        "copyTranscriptionToClipboard",
      );
      isCopyTranscriptionToClipboardEnabled.value =
        savedCopyTranscriptionToClipboard ??
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;

      contextInjectionEnabled.value =
        (await store.get<boolean>("contextInjectionEnabled")) ??
        DEFAULT_CONTEXT_INJECTION_ENABLED;

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[useSettingsStore] Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`,
      );
      // tenant/client 已就緒 → 讀出 entraUser 模式的登入狀態供 UI 與 computed 使用
      await refreshAzureUserAccount();
    } catch (err) {
      console.error(
        "[useSettingsStore] loadSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "load" });

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      hotkeyConfig.value = { triggerKey: key, triggerMode: "hold" };
      isEnhancementThresholdEnabled.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      isMuteOnRecordingEnabled.value = DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value = DEFAULT_SOUND_EFFECTS_ENABLED;
      isHideDockIconEnabled.value = DEFAULT_HIDE_DOCK_ICON;
      isCopyTranscriptionToClipboardEnabled.value =
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;
      contextInjectionEnabled.value = DEFAULT_CONTEXT_INJECTION_ENABLED;
    }
  }

  async function saveHotkeyConfig(key: TriggerKey, mode: TriggerMode) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hotkeyTriggerKey", key);
      await store.set("hotkeyTriggerMode", mode);
      await store.save();

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };

      // Sync to Rust immediately
      await syncHotkeyConfigToRust(key, mode);

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "hotkey",
        value: { triggerKey: key, triggerMode: mode },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHotkeyConfig failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hotkey" });
      throw err;
    }
  }

  async function saveCustomTriggerKey(
    keycode: number,
    domCode: string,
    mode: TriggerMode,
  ) {
    const customKey: CustomTriggerKey = { custom: { keycode } };
    try {
      // Persist custom key independently (survives mode switching)
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", customKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = customKey;
      customTriggerKeyDomCode.value = domCode;

      // Reuse shared logic for active key + Rust sync + event broadcast
      await saveHotkeyConfig(customKey, mode);

      console.log(
        `[useSettingsStore] Custom trigger key saved: keycode=${keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCustomTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveComboTriggerKey(
    comboKey: ComboTriggerKey,
    domCode: string,
    mode: TriggerMode,
  ) {
    try {
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", comboKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = comboKey;
      customTriggerKeyDomCode.value = domCode;

      await saveHotkeyConfig(comboKey, mode);

      console.log(
        `[useSettingsStore] Combo trigger key saved: modifiers=${JSON.stringify(comboKey.combo.modifiers)}, keycode=${comboKey.combo.keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveComboTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function switchToPresetMode(presetKey: TriggerKey, mode: TriggerMode) {
    // Only update active key; keep customTriggerKey intact
    await saveHotkeyConfig(presetKey, mode);
  }

  async function switchToCustomMode(mode: TriggerMode) {
    if (!customTriggerKey.value) return;
    // Restore custom key as active key
    await saveHotkeyConfig(customTriggerKey.value, mode);
  }

  function getTriggerKeyDisplayName(key: TriggerKey): string {
    if (isPresetTriggerKey(key)) {
      return PRESET_KEY_DISPLAY_NAMES[key] ?? key;
    }
    if (isComboTriggerKey(key)) {
      return getComboTriggerKeyDisplayName(key);
    }
    if (isCustomTriggerKey(key)) {
      // For custom keys, use saved DOM code to look up display name
      if (customTriggerKeyDomCode.value) {
        return getKeyDisplayName(customTriggerKeyDomCode.value);
      }
      return i18n.global.t("settings.hotkey.customKeyDisplay", {
        keycode: key.custom.keycode,
      });
    }
    return String(key);
  }

  async function saveApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("groqApiKey", trimmedKey);
      await store.save();
      apiKey.value = trimmedKey;

      const payload: SettingsUpdatedPayload = {
        key: "apiKey",
        value: trimmedKey,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-api-key" });
      throw err;
    }
  }

  async function refreshApiKey() {
    try {
      const store = await load(STORE_NAME);
      const savedApiKey = await store.get<string>("groqApiKey");
      apiKey.value = savedApiKey?.trim() ?? "";
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  /**
   * 依「轉錄 provider」刷新對應金鑰。
   * 與 refreshLlmApiKey（依 LLM provider）不同：使用者可能用 Groq LLM + Gemini 轉錄，
   * 那條路徑刷不到 Gemini key，會讓 HUD 一直持有空值而轉錄失敗。
   */
  async function refreshTranscriptionApiKey() {
    try {
      const store = await load(STORE_NAME);
      if (whisperProviderId.value === "gemini") {
        const savedKey = await store.get<string>("geminiApiKey");
        geminiApiKey.value = savedKey?.trim() ?? "";
        return;
      }
      if (whisperProviderId.value === "groq") {
        const savedApiKey = await store.get<string>("groqApiKey");
        apiKey.value = savedApiKey?.trim() ?? "";
      }
      // azure：連線參數由 refreshCrossWindowSettings 統一刷新
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshTranscriptionApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function deleteApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("groqApiKey");
      await store.save();
      apiKey.value = "";

      const payload: SettingsUpdatedPayload = { key: "apiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  function getAiPrompt(): string {
    if (promptMode.value === "custom") return aiPrompt.value;
    return getPromptForModeAndLocale(
      promptMode.value,
      getEffectivePromptLocale(),
    );
  }

  async function savePromptMode(mode: PromptMode) {
    const previousMode = promptMode.value;
    promptMode.value = mode;
    try {
      const store = await load(STORE_NAME);
      await store.set("promptMode", mode);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: mode,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Prompt mode saved: ${mode}`);
    } catch (err) {
      promptMode.value = previousMode;
      console.error(
        "[useSettingsStore] savePromptMode failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-prompt-mode" });
      throw err;
    }
  }

  /** 只由 Dashboard (main-window.ts) 呼叫，比對版本號決定是否顯示升級提示 */
  async function consumeUpgradeNotice() {
    try {
      const store = await load(STORE_NAME);
      const lastSeenVersion = await store.get<string>("lastSeenVersion");

      if (lastSeenVersion === null || lastSeenVersion === undefined) {
        // 區分首次安裝 vs 舊版升級：有 API key = 老使用者
        const existingApiKey = await store.get<string>("groqApiKey");
        if (existingApiKey) {
          showPromptUpgradeNotice.value = true;
        }
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
        return;
      }

      if (lastSeenVersion !== __APP_VERSION__) {
        showPromptUpgradeNotice.value = true;
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] consumeUpgradeNotice failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveAiPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") {
      throw new Error(i18n.global.t("errors.promptEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("aiPrompt", trimmedPrompt);
      await store.save();
      aiPrompt.value = trimmedPrompt;

      const payload: SettingsUpdatedPayload = {
        key: "aiPrompt",
        value: trimmedPrompt,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function resetAiPrompt() {
    try {
      const store = await load(STORE_NAME);
      const defaultPrompt = getMinimalPromptForLocale(
        getEffectivePromptLocale(),
      );
      promptMode.value = "minimal";
      aiPrompt.value = defaultPrompt;
      await store.set("promptMode", "minimal");
      await store.set("aiPrompt", defaultPrompt);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: "minimal",
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt reset to minimal");
    } catch (err) {
      console.error(
        "[useSettingsStore] resetAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveEnhancementThreshold(enabled: boolean, charCount: number) {
    const validatedCharCount =
      !Number.isInteger(charCount) || charCount < 1
        ? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT
        : charCount;

    try {
      const store = await load(STORE_NAME);
      await store.set("enhancementThresholdEnabled", enabled);
      await store.set("enhancementThresholdCharCount", validatedCharCount);
      await store.save();

      isEnhancementThresholdEnabled.value = enabled;
      enhancementThresholdCharCount.value = validatedCharCount;

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "enhancementThreshold",
        value: { enabled, charCount: validatedCharCount },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Enhancement threshold saved: enabled=${enabled}, charCount=${validatedCharCount}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveEnhancementThreshold failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  /**
   * 儲存 Gemini 轉錄的免費額度（使用者自 AI Studio 查得後填入）。
   * Google 不公開 Free tier 的 RPD/TPD 數字（依帳號浮動），因此無法內建預設值；
   * 未填（0）時 Dashboard 只顯示實際用量、不顯示額度條，避免捏造分母。
   */
  async function saveGeminiFreeQuota(requests: number, period: QuotaPeriod) {
    const validatedRequests =
      !Number.isFinite(requests) || requests < 0 ? 0 : Math.floor(requests);
    try {
      const store = await load(STORE_NAME);
      await store.set("geminiFreeQuotaRequests", validatedRequests);
      await store.set("geminiFreeQuotaPeriod", period);
      await store.save();
      geminiFreeQuotaRequests.value = validatedRequests;
      geminiFreeQuotaPeriod.value = period;

      const payload: SettingsUpdatedPayload = {
        key: "geminiFreeQuota",
        value: { requests: validatedRequests, period },
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveGeminiFreeQuota failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveGeminiTranscriptionModel(id: GeminiTranscriptionModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("geminiTranscriptionModelId", id);
      await store.save();
      geminiTranscriptionModelId.value = id;
      const payload: SettingsUpdatedPayload = {
        key: "geminiTranscriptionModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveGeminiTranscriptionModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmModel(id: LlmModelId) {    try {
      const store = await load(STORE_NAME);
      await store.set("llmModelId", id);
      await store.save();
      selectedLlmModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "llmModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] LLM model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmProvider(providerId: LlmProviderId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("llmProviderId", providerId);

      // 切換 provider 時重設為該 provider 預設模型；Azure 例外（模型 = 部署名稱）
      if (providerId !== "azure") {
        const defaultModelId = getDefaultModelIdForProvider(providerId);
        await store.set("llmModelId", defaultModelId);
        selectedLlmModelId.value = defaultModelId;
      }
      await store.save();

      selectedLlmProviderId.value = providerId;

      const payload: SettingsUpdatedPayload = {
        key: "llmProvider",
        value: providerId,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] LLM provider saved: ${providerId}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmProvider failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-llm-provider" });
      throw err;
    }
  }

  async function saveOpenaiApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("openaiApiKey", trimmedKey);
      await store.save();
      openaiApiKey.value = trimmedKey;
      console.log("[useSettingsStore] OpenAI API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveOpenaiApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-openai-api-key" });
      throw err;
    }
  }

  async function deleteOpenaiApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("openaiApiKey");
      await store.save();
      openaiApiKey.value = "";
      console.log("[useSettingsStore] OpenAI API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteOpenaiApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveAnthropicApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("anthropicApiKey", trimmedKey);
      await store.save();
      anthropicApiKey.value = trimmedKey;
      console.log("[useSettingsStore] Anthropic API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAnthropicApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-anthropic-api-key",
      });
      throw err;
    }
  }

  async function deleteAnthropicApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("anthropicApiKey");
      await store.save();
      anthropicApiKey.value = "";
      console.log("[useSettingsStore] Anthropic API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteAnthropicApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveGeminiApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("geminiApiKey", trimmedKey);
      await store.save();
      geminiApiKey.value = trimmedKey;
      // 通知其他視窗（HUD）重讀：Gemini 也可能是「轉錄」provider，
      // 舊 key 若不刷新會讓 HUD 繼續用過期憑證。payload 不含金鑰值。
      const payload: SettingsUpdatedPayload = { key: "geminiApiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log("[useSettingsStore] Gemini API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveGeminiApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-gemini-api-key",
      });
      throw err;
    }
  }

  async function deleteGeminiApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("geminiApiKey");
      await store.save();
      geminiApiKey.value = "";
      // 刪除同樣要廣播，否則 HUD 會繼續持有已刪除的 key 並送出請求
      const payload: SettingsUpdatedPayload = { key: "geminiApiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log("[useSettingsStore] Gemini API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteGeminiApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveAzureConnection(cfg: {
    enabled: boolean;
    endpoint: string;
    authMode: AzureAuthMode;
    apiKey: string;
    tenantId: string;
    clientId: string;
    clientSecret: string;
    apiVersion: string;
  }) {
    try {
      const store = await load(STORE_NAME);
      const normalizedEndpoint = normalizeAzureEndpoint(cfg.endpoint);
      // 切到使用者登入模式時清掉舊的 client secret：欄位在 UI 上會被隱藏，
      // 不主動清除的話仍會被原封不動寫回明文 store，也會混進設定備份。
      const clientSecret =
        cfg.authMode === "entraUser" ? "" : cfg.clientSecret;
      const nextTenantId = cfg.tenantId.trim();
      const nextClientId = cfg.clientId.trim();
      // 換掉 tenant/client 等於換一個登入身分：舊的 refresh token 若不清掉會
      // 長期留在 OS 憑證庫，日後切回舊值還會「自動已登入」。
      const identityChanged =
        nextTenantId !== azureTenantId.value ||
        nextClientId !== azureClientId.value;
      if (identityChanged) {
        await signOutAzureUserSilently();
      }
      await store.set("azureEnabled", cfg.enabled);
      await store.set("azureEndpoint", normalizedEndpoint);
      await store.set("azureAuthMode", cfg.authMode);
      await store.set("azureApiKey", cfg.apiKey.trim());
      await store.set("azureTenantId", nextTenantId);
      await store.set("azureClientId", nextClientId);
      await store.set("azureClientSecret", clientSecret);
      await store.set("azureApiVersion", cfg.apiVersion.trim());

      // 停用 Azure 時，把仍指向 azure 的 provider 切回 groq（避免無 UI 可切換而卡死）
      if (!cfg.enabled) {
        if (selectedLlmProviderId.value === "azure") {
          const groqModel = getDefaultModelIdForProvider("groq");
          await store.set("llmProviderId", "groq");
          await store.set("llmModelId", groqModel);
          selectedLlmProviderId.value = "groq";
          selectedLlmModelId.value = groqModel;
        }
        if (whisperProviderId.value === "azure") {
          await store.set("whisperProviderId", "groq");
          whisperProviderId.value = "groq";
        }
      }
      await store.save();

      azureEnabled.value = cfg.enabled;
      azureEndpoint.value = normalizedEndpoint;
      azureAuthMode.value = cfg.authMode;
      azureApiKey.value = cfg.apiKey.trim();
      azureTenantId.value = cfg.tenantId.trim();
      azureClientId.value = cfg.clientId.trim();
      azureClientSecret.value = clientSecret;
      azureApiVersion.value = cfg.apiVersion.trim();
      clearAzureTokenCache();
      // tenant/client 可能剛剛才變更 → 重新確認這組設定底下的登入狀態
      await refreshAzureUserAccount();

      const payload: SettingsUpdatedPayload = {
        key: "azureConnection",
        value: cfg.enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log("[useSettingsStore] Azure connection saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAzureConnection failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-azure-connection" });
      throw err;
    }
  }

  async function deleteAzureConnection() {
    try {
      // 先清 OS 憑證庫再刪設定：一旦 tenant/client 從 store 消失就再也算不出
      // 該用哪個 key 去刪，refresh token 會永久殘留在使用者機器上。
      await signOutAzureUserSilently();

      const store = await load(STORE_NAME);
      const keys = [
        "azureEnabled",
        "azureEndpoint",
        "azureAuthMode",
        "azureApiKey",
        "azureTenantId",
        "azureClientId",
        "azureClientSecret",
        "azureApiVersion",
        "azureOmitTemperature",
      ];
      for (const k of keys) {
        await store.delete(k);
      }

      // 把仍指向 azure 的 provider 切回 groq，否則轉錄/整理會卡在「未設定」
      if (selectedLlmProviderId.value === "azure") {
        const groqModel = getDefaultModelIdForProvider("groq");
        await store.set("llmProviderId", "groq");
        await store.set("llmModelId", groqModel);
        selectedLlmProviderId.value = "groq";
        selectedLlmModelId.value = groqModel;
      }
      if (whisperProviderId.value === "azure") {
        await store.set("whisperProviderId", "groq");
        whisperProviderId.value = "groq";
      }
      await store.save();

      azureEnabled.value = false;
      azureEndpoint.value = "";
      azureAuthMode.value = "key";
      azureApiKey.value = "";
      azureTenantId.value = "";
      azureClientId.value = "";
      azureClientSecret.value = "";
      azureApiVersion.value = "";
      azureOmitTemperature.value = false;
      clearAzureTokenCache();
      azureUserAccount.value = null;
      await emitAzureAuthStateChanged();

      const payload: SettingsUpdatedPayload = {
        key: "azureConnection",
        value: false,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log("[useSettingsStore] Azure connection deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteAzureConnection failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  // ── Entra 使用者委派登入 ──────────────────────────────────
  //
  // token 的真實來源在 Rust（記憶體快取 + OS 憑證庫）。這裡只維護一份給
  // UI 與 computed 用的帳號快照，並負責跨視窗同步。

  async function emitAzureAuthStateChanged() {
    const account = azureUserAccount.value;
    const payload: AzureAuthStateChangedPayload = {
      signedIn: account !== null,
      username: account?.username ?? null,
      accountKey: account
        ? `${account.tenantId}::${account.clientId}`
        : null,
    };
    await emitEvent(AZURE_AUTH_STATE_CHANGED, payload);
  }

  /** 依目前的 tenant/client 重讀登入狀態。憑證庫不可用時視為未登入，不中斷流程。 */
  async function refreshAzureUserAccount() {
    try {
      azureUserAccount.value = await getAzureUserAccount({
        tenantId: azureTenantId.value,
        clientId: azureClientId.value,
      });
    } catch (err) {
      console.warn(
        "[useSettingsStore] failed to read Azure user account:",
        extractErrorMessage(err),
      );
      azureUserAccount.value = null;
    }
  }

  /** 目前進行中的登入。帶 operationId 才不會取消到下一次登入。 */
  let pendingSignInOperationId: string | null = null;

  /**
   * 互動登入。刻意做成單一原子操作：設定頁的輸入框在按下登入前尚未寫入 store，
   * 若先登入再儲存，Rust 會拿到舊的（或空的）tenant/client。
   */
  async function signInAzureUserAccount(credentials: {
    tenantId: string;
    clientId: string;
  }): Promise<AzureUserAccount> {
    const tenantId = credentials.tenantId.trim();
    const clientId = credentials.clientId.trim();
    if (tenantId === "" || clientId === "") {
      throw new Error("Entra credentials incomplete");
    }

    // 先落地設定，Rust 與後續 computed 才會用到同一組值
    azureTenantId.value = tenantId;
    azureClientId.value = clientId;
    const store = await load(STORE_NAME);
    await store.set("azureTenantId", tenantId);
    await store.set("azureClientId", clientId);
    await store.save();

    const operationId = newSignInOperationId();
    pendingSignInOperationId = operationId;
    try {
      const account = await signInAzureUser({ tenantId, clientId }, operationId);
      azureUserAccount.value = account;
      clearAzureTokenCache();
      await emitAzureAuthStateChanged();
      return account;
    } finally {
      if (pendingSignInOperationId === operationId) {
        pendingSignInOperationId = null;
      }
    }
  }

  async function cancelAzureUserSignInFlow() {
    if (!pendingSignInOperationId) return;
    await cancelAzureUserSignIn(pendingSignInOperationId);
  }

  /** 內部用：清掉憑證庫但不動設定，失敗僅記錄（刪設定不該因憑證庫問題卡住）。 */
  async function signOutAzureUserSilently() {
    if (azureTenantId.value === "" || azureClientId.value === "") return;
    try {
      await signOutAzureUser({
        tenantId: azureTenantId.value,
        clientId: azureClientId.value,
      });
    } catch (err) {
      console.warn(
        "[useSettingsStore] Azure sign-out failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function signOutAzureUserAccount() {
    await signOutAzureUser({
      tenantId: azureTenantId.value,
      clientId: azureClientId.value,
    });
    azureUserAccount.value = null;
    clearAzureTokenCache();
    await emitAzureAuthStateChanged();
  }

  async function saveAzureChatDeployment(name: string) {
    try {
      const store = await load(STORE_NAME);
      await store.set("azureChatDeployment", name.trim());
      await store.save();
      azureChatDeployment.value = name.trim();
      const payload: SettingsUpdatedPayload = {
        key: "azureChatDeployment",
        value: name.trim(),
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAzureChatDeployment failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveAzureWhisperDeployment(name: string) {
    try {
      const store = await load(STORE_NAME);
      await store.set("azureWhisperDeployment", name.trim());
      await store.save();
      azureWhisperDeployment.value = name.trim();
      const payload: SettingsUpdatedPayload = {
        key: "azureWhisperDeployment",
        value: name.trim(),
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAzureWhisperDeployment failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  // gh-45/#25：Azure/Foundry 的 model 是不透明部署名，無法從名稱判斷是否推理模型。
  // 開啟此開關時，Azure chat 請求一律省略 temperature（GPT-5 系列部署送 temperature
  // 會回 400）。刻意不自動補 reasoning_effort（原始 GPT-5 部署未必支援 "none"）。
  async function saveAzureOmitTemperature(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("azureOmitTemperature", enabled);
      await store.save();
      azureOmitTemperature.value = enabled;
      const payload: SettingsUpdatedPayload = {
        key: "azureOmitTemperature",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAzureOmitTemperature failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveWhisperProvider(id: TranscriptionProviderId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("whisperProviderId", id);
      await store.save();
      whisperProviderId.value = id;
      const payload: SettingsUpdatedPayload = {
        key: "whisperProvider",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveWhisperProvider failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function refreshLlmApiKey() {
    try {
      const store = await load(STORE_NAME);
      switch (selectedLlmProviderId.value) {
        case "groq": {
          const savedApiKey = await store.get<string>("groqApiKey");
          apiKey.value = savedApiKey?.trim() ?? "";
          break;
        }
        case "openai": {
          const savedKey = await store.get<string>("openaiApiKey");
          openaiApiKey.value = savedKey?.trim() ?? "";
          break;
        }
        case "anthropic": {
          const savedKey = await store.get<string>("anthropicApiKey");
          anthropicApiKey.value = savedKey?.trim() ?? "";
          break;
        }
        case "gemini": {
          const savedKey = await store.get<string>("geminiApiKey");
          geminiApiKey.value = savedKey?.trim() ?? "";
          break;
        }
        case "azure": {
          azureEndpoint.value =
            (await store.get<string>("azureEndpoint"))?.trim() ?? "";
          azureAuthMode.value =
            toAzureAuthMode(await store.get("azureAuthMode"));
          azureApiKey.value =
            (await store.get<string>("azureApiKey"))?.trim() ?? "";
          azureTenantId.value =
            (await store.get<string>("azureTenantId"))?.trim() ?? "";
          azureClientId.value =
            (await store.get<string>("azureClientId"))?.trim() ?? "";
          azureClientSecret.value =
            (await store.get<string>("azureClientSecret")) ?? "";
          azureApiVersion.value =
            (await store.get<string>("azureApiVersion"))?.trim() ?? "";
          azureOmitTemperature.value =
            (await store.get<boolean>("azureOmitTemperature")) ?? false;
          azureChatDeployment.value =
            (await store.get<string>("azureChatDeployment"))?.trim() ?? "";
          break;
        }
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshLlmApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveWhisperModel(id: WhisperModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("whisperModelId", id);
      await store.save();
      selectedWhisperModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "whisperModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Whisper model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveWhisperModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function loadAutoStartStatus() {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      isAutoStartEnabled.value = await isEnabled();
    } catch (err) {
      console.error(
        "[useSettingsStore] loadAutoStartStatus failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function toggleAutoStart() {
    try {
      if (isAutoStartEnabled.value) {
        const { disable } = await import("@tauri-apps/plugin-autostart");
        await disable();
        isAutoStartEnabled.value = false;
      } else {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        isAutoStartEnabled.value = true;
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] toggleAutoStart failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveTheme(mode: ThemeMode) {
    try {
      const store = await load(STORE_NAME);
      await store.set("themeMode", mode);
      themeMode.value = mode;
      applyTheme(mode);
      await store.save();

      const payload: SettingsUpdatedPayload = { key: "theme", value: mode };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Theme saved: ${mode}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveTheme failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-theme" });
      throw err;
    }
  }

  async function saveLocale(locale: SupportedLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedLocale", locale);
      selectedLocale.value = locale;
      await switchLocale(locale);
      document.documentElement.lang = getHtmlLangForLocale(locale);

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "locale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-locale" });
      throw err;
    }
  }

  async function saveTranscriptionLocale(locale: TranscriptionLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedTranscriptionLocale", locale);
      selectedTranscriptionLocale.value = locale;

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "transcriptionLocale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Transcription locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveTranscriptionLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-transcription-locale",
      });
      throw err;
    }
  }

  function getWhisperLanguageCode(): string | null {
    return getWhisperCodeForTranscriptionLocale(
      selectedTranscriptionLocale.value,
    );
  }

  async function saveMuteOnRecording(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("muteOnRecording", enabled);
      await store.save();
      isMuteOnRecordingEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "muteOnRecording",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] muteOnRecording saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveMuteOnRecording failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-mute" });
      throw err;
    }
  }

  async function saveSoundEffectsEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("soundEffectsEnabled", enabled);
      await store.save();
      isSoundEffectsEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "soundEffectsEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] soundEffectsEnabled saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSoundEffectsEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-sound-effects" });
      throw err;
    }
  }

  // 僅 macOS 生效；失敗不影響已持久化設定，重啟後由 Rust 端（lib.rs setup）套用。
  async function applyDockVisibility(hidden: boolean) {
    if (!IS_MACOS) return;
    try {
      await setDockVisibility(!hidden);
    } catch (applyErr) {
      console.error(
        "[useSettingsStore] setDockVisibility failed:",
        extractErrorMessage(applyErr),
      );
    }
  }

  async function saveHideDockIcon(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hideDockIcon", enabled);
      await store.save();
      isHideDockIconEnabled.value = enabled;

      await applyDockVisibility(enabled);

      const payload: SettingsUpdatedPayload = {
        key: "hideDockIcon",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] hideDockIcon saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHideDockIcon failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hide-dock-icon" });
      throw err;
    }
  }

  async function saveSmartDictionaryEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("smartDictionaryEnabled", enabled);
      await store.save();
      isSmartDictionaryEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "smartDictionaryEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(
        `[useSettingsStore] smartDictionaryEnabled saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSmartDictionaryEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-smart-dictionary",
      });
      throw err;
    }
  }

  async function saveContextInjectionEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("contextInjectionEnabled", enabled);
      await store.save();
      contextInjectionEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "contextInjectionEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] contextInjectionEnabled saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveContextInjectionEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-context-injection",
      });
      throw err;
    }
  }

  async function saveRecordingAutoCleanup(enabled: boolean, days: number) {
    const validatedDays =
      !Number.isInteger(days) || days < 1
        ? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS
        : days;

    try {
      const store = await load(STORE_NAME);
      await store.set("recordingAutoCleanupEnabled", enabled);
      await store.set("recordingAutoCleanupDays", validatedDays);
      await store.save();

      isRecordingAutoCleanupEnabled.value = enabled;
      recordingAutoCleanupDays.value = validatedDays;

      console.log(
        `[useSettingsStore] Recording auto cleanup saved: enabled=${enabled}, days=${validatedDays}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveRecordingAutoCleanup failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-recording-auto-cleanup",
      });
      throw err;
    }
  }

  async function saveDebugLog(enabled: boolean, days: number) {
    const validatedDays =
      !Number.isInteger(days) || days < 1
        ? DEFAULT_DEBUG_LOG_RETENTION_DAYS
        : days;

    try {
      const store = await load(STORE_NAME);
      await store.set("debugLogEnabled", enabled);
      await store.set("debugLogRetentionDays", validatedDays);
      await store.save();

      isDebugLogEnabled.value = enabled;
      debugLogRetentionDays.value = validatedDays;

      // 即時通知 Rust 切換檔案 Log 開關
      await setFileLoggingEnabled(enabled);

      console.log(
        `[useSettingsStore] Debug log saved: enabled=${enabled}, days=${validatedDays}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveDebugLog failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-debug-log",
      });
      throw err;
    }
  }

  async function saveAudioInputDevice(deviceName: string) {
    try {
      const store = await load(STORE_NAME);
      await store.set("audioInputDeviceName", deviceName);
      await store.save();

      selectedAudioInputDeviceName.value = deviceName;

      const payload: SettingsUpdatedPayload = {
        key: "audioInputDevice",
        value: deviceName,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Audio input device saved: "${deviceName || "(system default)"}"`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAudioInputDevice failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-audio-input-device",
      });
      throw err;
    }
  }

  async function saveCopyTranscriptionToClipboard(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("copyTranscriptionToClipboard", enabled);
      await store.save();
      isCopyTranscriptionToClipboardEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "copyTranscriptionToClipboard",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] copyTranscriptionToClipboard saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCopyTranscriptionToClipboard failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-copy-transcription-to-clipboard",
      });
      throw err;
    }
  }

  async function refreshCrossWindowSettings() {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      const savedApiKey = await store.get<string>("groqApiKey");
      const savedPrompt = await store.get<string>("aiPrompt");
      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      const savedLlmProviderId =
        await store.get<LlmProviderId>("llmProviderId");
      const savedLlmModelId = await store.get<string>("llmModelId");
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const savedOpenaiKey = await store.get<string>("openaiApiKey");
      const savedAnthropicKey = await store.get<string>("anthropicApiKey");
      const savedGeminiKey = await store.get<string>("geminiApiKey");
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedHideDockIcon = await store.get<boolean>("hideDockIcon");
      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );
      const savedContextInjectionEnabled = await store.get<boolean>(
        "contextInjectionEnabled",
      );

      hotkeyConfig.value = {
        triggerKey: savedKey ?? getDefaultTriggerKey(),
        triggerMode: savedMode ?? "hold",
      };
      const isValidCustomOrCombo =
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        (isCustomTriggerKey(savedCustomKey) ||
          isComboTriggerKey(savedCustomKey));
      customTriggerKey.value = isValidCustomOrCombo ? savedCustomKey : null;
      customTriggerKeyDomCode.value = isValidCustomOrCombo
        ? (savedCustomDomCode ?? "")
        : "";
      // Locale + transcription locale must be synced first — aiPrompt fallback depends on them
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      selectedLocale.value = savedLocale ?? FALLBACK_LOCALE;
      await switchLocale(selectedLocale.value);
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      const savedTranscriptionLocale = await store.get<TranscriptionLocale>(
        "selectedTranscriptionLocale",
      );
      selectedTranscriptionLocale.value =
        savedTranscriptionLocale ?? selectedLocale.value;

      // Theme: sync persisted value back to reactive + apply (cross-window)
      const savedThemeMode = await store.get<ThemeMode>("themeMode");
      themeMode.value = isThemeMode(savedThemeMode)
        ? savedThemeMode
        : DEFAULT_THEME_MODE;
      applyTheme(themeMode.value);

      // Prompt mode (with runtime validation)
      const savedPromptMode = await store.get<string>("promptMode");
      promptMode.value =
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
          ? (savedPromptMode as PromptMode)
          : DEFAULT_PROMPT_MODE;

      apiKey.value = savedApiKey?.trim() ?? "";
      aiPrompt.value =
        savedPrompt?.trim() ||
        getMinimalPromptForLocale(getEffectivePromptLocale());
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      selectedLlmProviderId.value =
        savedLlmProviderId ?? DEFAULT_LLM_PROVIDER_ID;
      const effectiveCrossWindowModelId = getEffectiveLlmModelId(
        savedLlmModelId ?? null,
      );
      const crossWindowModelConfig = findLlmModelConfig(effectiveCrossWindowModelId);
      selectedLlmModelId.value =
        crossWindowModelConfig?.providerId === selectedLlmProviderId.value
          ? effectiveCrossWindowModelId
          : getDefaultModelIdForProvider(selectedLlmProviderId.value);
      openaiApiKey.value = savedOpenaiKey?.trim() ?? "";
      anthropicApiKey.value = savedAnthropicKey?.trim() ?? "";
      geminiApiKey.value = savedGeminiKey?.trim() ?? "";
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;
      contextInjectionEnabled.value =
        savedContextInjectionEnabled ?? DEFAULT_CONTEXT_INJECTION_ENABLED;
      const nextHideDockIcon = savedHideDockIcon ?? DEFAULT_HIDE_DOCK_ICON;
      if (nextHideDockIcon !== isHideDockIconEnabled.value) {
        void applyDockVisibility(nextHideDockIcon);
      }
      isHideDockIconEnabled.value = nextHideDockIcon;
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;

      const savedRecCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;
      const savedRecCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedDebugLogEnabledX = await store.get<boolean>("debugLogEnabled");
      isDebugLogEnabled.value =
        savedDebugLogEnabledX ?? DEFAULT_DEBUG_LOG_ENABLED;
      const savedDebugLogDaysX = await store.get<number>(
        "debugLogRetentionDays",
      );
      debugLogRetentionDays.value =
        savedDebugLogDaysX ?? DEFAULT_DEBUG_LOG_RETENTION_DAYS;

      const savedAudioDevice = await store.get<string>("audioInputDeviceName");
      selectedAudioInputDeviceName.value = savedAudioDevice ?? "";

      const savedCopyTranscriptionToClipboard = await store.get<boolean>(
        "copyTranscriptionToClipboard",
      );
      isCopyTranscriptionToClipboardEnabled.value =
        savedCopyTranscriptionToClipboard ??
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;

      // Azure / Microsoft Foundry（跨視窗同步）
      azureEnabled.value = (await store.get<boolean>("azureEnabled")) ?? false;
      azureEndpoint.value =
        (await store.get<string>("azureEndpoint"))?.trim() ?? "";
      azureAuthMode.value =
        toAzureAuthMode(await store.get("azureAuthMode"));
      azureApiKey.value = (await store.get<string>("azureApiKey"))?.trim() ?? "";
      azureTenantId.value =
        (await store.get<string>("azureTenantId"))?.trim() ?? "";
      azureClientId.value =
        (await store.get<string>("azureClientId"))?.trim() ?? "";
      azureClientSecret.value =
        (await store.get<string>("azureClientSecret")) ?? "";
      azureApiVersion.value =
        (await store.get<string>("azureApiVersion"))?.trim() ?? "";
      azureOmitTemperature.value =
        (await store.get<boolean>("azureOmitTemperature")) ?? false;
      azureChatDeployment.value =
        (await store.get<string>("azureChatDeployment"))?.trim() ?? "";
      azureWhisperDeployment.value =
        (await store.get<string>("azureWhisperDeployment"))?.trim() ?? "";
      whisperProviderId.value = getEffectiveTranscriptionProviderId(
        await store.get<string>("whisperProviderId"),
      );
      geminiFreeQuotaRequests.value =
        (await store.get<number>("geminiFreeQuotaRequests")) ?? 0;
      geminiFreeQuotaPeriod.value =
        (await store.get<QuotaPeriod>("geminiFreeQuotaPeriod")) ??
        DEFAULT_QUOTA_PERIOD;
      geminiTranscriptionModelId.value = getEffectiveGeminiTranscriptionModelId(
        await store.get<string>("geminiTranscriptionModelId"),
      );
      // 兜底：即使漏收 AZURE_AUTH_STATE_CHANGED，跨視窗設定刷新時也會同步登入狀態
      await refreshAzureUserAccount();
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshCrossWindowSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "refresh-cross-window" });
    }
  }

  async function initializeAutoStart() {
    try {
      const store = await load(STORE_NAME);
      const hasInitAutoStart = await store.get<boolean>("hasInitAutoStart");

      if (!hasInitAutoStart) {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        await store.set("hasInitAutoStart", true);
        await store.save();
        isAutoStartEnabled.value = true;
        console.log("[useSettingsStore] Auto-start enabled on first launch");
      } else {
        await loadAutoStartStatus();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] initializeAutoStart failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function applyAutoStartImported(desired: boolean) {
    try {
      if (desired === isAutoStartEnabled.value) return;
      const { enable, disable } = await import("@tauri-apps/plugin-autostart");
      if (desired) {
        await enable();
      } else {
        await disable();
      }
      isAutoStartEnabled.value = desired;
    } catch (err) {
      console.error(
        "[useSettingsStore] applyAutoStartImported failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "import-autostart" });
    }
  }

  /** 合成欄位：autostart 不在 settings.json，匯出/匯入時以此 key 代表。 */
  const AUTO_START_KEY = "autoStartEnabled";
  const EXPORTABLE_KEY_SET = new Set<string>(EXPORTABLE_SETTING_KEYS);

  /**
   * 讀出可匯出的設定（白名單 key + 合成 autoStartEnabled）。
   * @param excludeSecrets 為 true 時剔除敏感金鑰／密鑰。
   */
  async function exportSettings(
    excludeSecrets: boolean,
  ): Promise<SettingsPayload> {
    const store = await load(STORE_NAME);
    const result: SettingsPayload = {};
    for (const key of EXPORTABLE_SETTING_KEYS) {
      const value = await store.get(key);
      if (value !== undefined && value !== null) {
        result[key] = value;
      }
    }
    result[AUTO_START_KEY] = isAutoStartEnabled.value;
    if (!excludeSecrets) return result;

    const stripped = stripSensitiveKeys(result);
    // 排除金鑰時，避免在目標機產生「已啟用但缺憑證」的壞掉狀態：
    // Azure 同步停用，並把使用 Azure／Gemini 的 provider 退回預設（groq）——
    // geminiApiKey 也是敏感 key，被剔除後留著 gemini provider 同樣無法運作。
    if (stripped.azureEnabled === true) {
      stripped.azureEnabled = false;
    }
    if (
      stripped.whisperProviderId === "azure" ||
      stripped.whisperProviderId === "gemini"
    ) {
      stripped.whisperProviderId = "groq";
    }
    if (
      stripped.llmProviderId === "azure" ||
      stripped.llmProviderId === "gemini"
    ) {
      stripped.llmProviderId = "groq";
      delete stripped.llmModelId; // 讓目標機依 provider 套用預設模型
    }
    return stripped;
  }

  /**
   * 套用匯入的設定。
   * ⚠️ 純 store.set 不足以正確生效，因此：
   * 1) 白名單 key 寫回 store（autoStartEnabled 例外，改走 plugin）。
   * 2) refreshCrossWindowSettings() 把持久化值讀回 reactive（含 locale i18n + html lang、provider 修正）。
   * 3) 補 refresh 缺漏的副作用：熱鍵向 Rust 重新註冊、清 Azure token 快取、套用 autostart。
   * 4) emit 單一 SETTINGS_UPDATED 通知其他視窗。
   */
  async function importSettings(settings: SettingsPayload): Promise<void> {
    const store = await load(STORE_NAME);
    let autoStartDesired: boolean | null = null;

    for (const [key, value] of Object.entries(settings)) {
      if (key === AUTO_START_KEY) {
        if (typeof value === "boolean") autoStartDesired = value;
        continue;
      }
      // 防禦：忽略白名單外的未知 key（含內部 migration 旗標）
      if (!EXPORTABLE_KEY_SET.has(key)) continue;
      // 備份是使用者可任意編輯的 JSON。UI 儲存路徑會經過 normalizeAzureEndpoint
      // 壓成純 origin，匯入路徑若不做同樣正規化，被污染的 endpoint
      // （例如夾帶反斜線讓真實 host 落在攻擊者網域）就會直接進到請求。
      if (key === "azureEndpoint" && typeof value === "string") {
        await store.set(key, normalizeAzureEndpoint(value));
        continue;
      }
      await store.set(key as ExportableSettingKey, value);
    }
    await store.save();

    // 將持久化值讀回 reactive 狀態（locale / prompt / azure / provider 等）
    await refreshCrossWindowSettings();

    // refreshCrossWindowSettings 未涵蓋的副作用：
    if (hotkeyConfig.value) {
      await syncHotkeyConfigToRust(
        hotkeyConfig.value.triggerKey,
        hotkeyConfig.value.triggerMode,
      );
    }
    clearAzureTokenCache();
    // 匯入的備份不含 refresh token（在 OS 憑證庫），需重新確認登入狀態；
    // 換機匯入時這裡會是未登入，UI 應顯示「需要重新登入」而非已連線。
    await refreshAzureUserAccount();
    if (autoStartDesired !== null) {
      await applyAutoStartImported(autoStartDesired);
    }

    const payload: SettingsUpdatedPayload = { key: "imported", value: true };
    await emitEvent(SETTINGS_UPDATED, payload);
  }

  return {
    hotkeyConfig,
    triggerMode,
    hasApiKey,
    aiPrompt,
    promptMode,
    showPromptUpgradeNotice,
    isAutoStartEnabled,
    isEnhancementThresholdEnabled,
    enhancementThresholdCharCount,
    selectedLlmProviderId,
    selectedLlmModelId,
    selectedWhisperModelId,
    hasLlmApiKey,
    openaiApiKey: computed(() => openaiApiKey.value),
    anthropicApiKey: computed(() => anthropicApiKey.value),
    geminiApiKey: computed(() => geminiApiKey.value),
    getApiKey,
    getLlmApiKey,
    getLlmRequestConfig,
    getWhisperRequestConfig,
    getEffectiveChatModel,
    hasWhisperConfig,
    getAiPrompt,
    savePromptMode,
    consumeUpgradeNotice,
    saveAiPrompt,
    resetAiPrompt,
    refreshApiKey,
    refreshTranscriptionApiKey,
    loadSettings,
    saveHotkeyConfig,
    saveCustomTriggerKey,
    saveComboTriggerKey,
    switchToPresetMode,
    switchToCustomMode,
    getTriggerKeyDisplayName,
    customTriggerKey,
    customTriggerKeyDomCode,
    // Hotkey recording helpers (proxied from lib/ for views)
    getPlatformKeycode,
    getKeyDisplayName,
    isPresetEquivalentKey,
    getDangerousKeyWarning,
    getEscapeReservedMessage,
    getHotkeyRecordingTimeoutMessage,
    getHotkeyUnsupportedKeyMessage,
    getHotkeyPresetHint,
    saveApiKey,
    deleteApiKey,
    saveEnhancementThreshold,
    saveLlmModel,
    saveLlmProvider,
    saveOpenaiApiKey,
    deleteOpenaiApiKey,
    saveAnthropicApiKey,
    deleteAnthropicApiKey,
    saveGeminiApiKey,
    deleteGeminiApiKey,
    azureEnabled,
    azureEndpoint,
    azureAuthMode,
    azureApiKey: computed(() => azureApiKey.value),
    azureTenantId,
    azureClientId,
    azureClientSecret: computed(() => azureClientSecret.value),
    azureApiVersion,
    azureOmitTemperature,
    azureChatDeployment,
    azureWhisperDeployment,
    azureUserAccount: computed(() => azureUserAccount.value),
    isAzureUserSignedIn,
    hasAzureCredentials,
    signInAzureUserAccount,
    signOutAzureUserAccount,
    cancelAzureUserSignInFlow,
    refreshAzureUserAccount,
    whisperProviderId,
    geminiTranscriptionModelId,
    saveGeminiTranscriptionModel,
    geminiFreeQuotaRequests,
    geminiFreeQuotaPeriod,
    saveGeminiFreeQuota,
    saveAzureConnection,
    deleteAzureConnection,
    saveAzureChatDeployment,
    saveAzureWhisperDeployment,
    saveAzureOmitTemperature,
    saveWhisperProvider,
    refreshLlmApiKey,
    saveWhisperModel,
    isMuteOnRecordingEnabled,
    saveMuteOnRecording,
    isSoundEffectsEnabled,
    saveSoundEffectsEnabled,
    isHideDockIconEnabled,
    saveHideDockIcon,
    isSmartDictionaryEnabled,
    saveSmartDictionaryEnabled,
    contextInjectionEnabled,
    saveContextInjectionEnabled,
    isRecordingAutoCleanupEnabled,
    recordingAutoCleanupDays,
    saveRecordingAutoCleanup,
    isDebugLogEnabled,
    debugLogRetentionDays,
    saveDebugLog,
    selectedAudioInputDeviceName,
    saveAudioInputDevice,
    isCopyTranscriptionToClipboardEnabled,
    saveCopyTranscriptionToClipboard,
    selectedLocale,
    saveLocale,
    selectedTranscriptionLocale,
    saveTranscriptionLocale,
    themeMode,
    saveTheme,
    getWhisperLanguageCode,
    refreshCrossWindowSettings,
    loadAutoStartStatus,
    toggleAutoStart,
    initializeAutoStart,
    exportSettings,
    importSettings,
  };
});
