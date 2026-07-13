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
import { emitEvent, SETTINGS_UPDATED } from "../composables/useTauriEvents";
import type { SettingsUpdatedPayload } from "../types/events";
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
  EXPORTABLE_SETTING_KEYS,
  stripSensitiveKeys,
  type ExportableSettingKey,
  type SettingsPayload,
} from "../lib/settingsTransfer";

declare const __APP_VERSION__: string;

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_MUTE_ON_RECORDING = true;
const DEFAULT_SMART_DICTIONARY_ENABLED = navigator.userAgent.includes("Mac"); // macOS only — Windows 尚未支援 text field 讀取
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
          (azureAuthMode.value === "key"
            ? azureApiKey.value !== ""
            : azureTenantId.value !== "" &&
              azureClientId.value !== "" &&
              azureClientSecret.value !== "")
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
  // ── Azure / Microsoft Foundry ──
  const azureEnabled = ref<boolean>(false);
  const azureEndpoint = ref<string>("");
  const azureAuthMode = ref<"key" | "entra">("key");
  const azureApiKey = ref<string>("");
  const azureTenantId = ref<string>("");
  const azureClientId = ref<string>("");
  const azureClientSecret = ref<string>("");
  const azureApiVersion = ref<string>("");
  const azureOmitTemperature = ref<boolean>(false);
  const azureChatDeployment = ref<string>("");
  const azureWhisperDeployment = ref<string>("");
  const whisperProviderId = ref<"groq" | "azure">("groq");
  const hasWhisperConfig = computed(() => {
    if (whisperProviderId.value !== "azure") return apiKey.value !== "";
    return (
      azureEnabled.value &&
      azureEndpoint.value !== "" &&
      azureWhisperDeployment.value !== "" &&
      (azureAuthMode.value === "key"
        ? azureApiKey.value !== ""
        : azureTenantId.value !== "" &&
          azureClientId.value !== "" &&
          azureClientSecret.value !== "")
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

  function getAzureRequestOptions(authValue: string): AzureRequestOptions {
    return {
      endpoint: azureEndpoint.value,
      apiVersion: azureApiVersion.value || undefined,
      authMode: azureAuthMode.value,
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
        azure: getAzureRequestOptions(token),
      };
    }

    return {
      apiKey: azureApiKey.value,
      provider,
      modelId: azureChatDeployment.value,
      azure: getAzureRequestOptions(azureApiKey.value),
    };
  }

  /** 用於 usage 記錄/成本計算的有效 chat 模型：Azure 用部署名，其餘用 selectedLlmModelId。 */
  function getEffectiveChatModel(): string {
    return selectedLlmProviderId.value === "azure"
      ? azureChatDeployment.value
      : selectedLlmModelId.value;
  }

  /**
   * 解析語音轉錄所需的 auth + provider + Azure 連線參數。
   * Azure-Entra 用 cognitiveservices scope（deployments 路徑）。
   */
  async function getWhisperRequestConfig(): Promise<{
    apiKey: string;
    provider: "groq" | "azure";
    endpoint?: string;
    deployment?: string;
    apiVersion?: string;
    authMode?: "key" | "entra";
  }> {
    if (whisperProviderId.value !== "azure") {
      return { apiKey: apiKey.value, provider: "groq" };
    }

    if (
      !azureEnabled.value ||
      azureEndpoint.value === "" ||
      azureWhisperDeployment.value === ""
    ) {
      return { apiKey: "", provider: "azure" };
    }

    const base = {
      provider: "azure" as const,
      endpoint: azureEndpoint.value,
      deployment: azureWhisperDeployment.value,
      apiVersion: azureApiVersion.value || undefined,
    };

    // whisper 走傳統 deployments 路徑 → cognitiveservices 受眾
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
      return { ...base, apiKey: token, authMode: "entra" };
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
        (await store.get<"key" | "entra">("azureAuthMode")) ?? "key";
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
      whisperProviderId.value =
        (await store.get<"groq" | "azure">("whisperProviderId")) ?? "groq";

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

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[useSettingsStore] Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`,
      );
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

  async function saveLlmModel(id: LlmModelId) {
    try {
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
    authMode: "key" | "entra";
    apiKey: string;
    tenantId: string;
    clientId: string;
    clientSecret: string;
    apiVersion: string;
  }) {
    try {
      const store = await load(STORE_NAME);
      const normalizedEndpoint = normalizeAzureEndpoint(cfg.endpoint);
      await store.set("azureEnabled", cfg.enabled);
      await store.set("azureEndpoint", normalizedEndpoint);
      await store.set("azureAuthMode", cfg.authMode);
      await store.set("azureApiKey", cfg.apiKey.trim());
      await store.set("azureTenantId", cfg.tenantId.trim());
      await store.set("azureClientId", cfg.clientId.trim());
      await store.set("azureClientSecret", cfg.clientSecret);
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
      azureClientSecret.value = cfg.clientSecret;
      azureApiVersion.value = cfg.apiVersion.trim();
      clearAzureTokenCache();

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

  async function saveWhisperProvider(id: "groq" | "azure") {
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
            (await store.get<"key" | "entra">("azureAuthMode")) ?? "key";
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
        (await store.get<"key" | "entra">("azureAuthMode")) ?? "key";
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
      whisperProviderId.value =
        (await store.get<"groq" | "azure">("whisperProviderId")) ?? "groq";
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
    // 排除金鑰時，避免在目標機產生「已啟用但缺憑證」的壞掉 Azure 狀態：
    // 同步停用 Azure，並把使用 Azure 的 provider 退回預設（groq）。
    if (stripped.azureEnabled === true) {
      stripped.azureEnabled = false;
    }
    if (stripped.whisperProviderId === "azure") {
      stripped.whisperProviderId = "groq";
    }
    if (stripped.llmProviderId === "azure") {
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
    whisperProviderId,
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
