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
  isAzureUserAuthFailure,
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
  type MaiCandidateLocale,
  FALLBACK_LOCALE,
  detectSystemLocale,
  getHtmlLangForLocale,
  getWhisperCodeForTranscriptionLocale,
  normalizeMaiCandidateLocales,
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
  type TranscriptionProviderGroup,
  type FoundryTranscriptionProviderId,
  type QuotaPeriod,
  type GeminiTranscriptionModelId,
  type MaiTranscribeStyle,
  type AzureChatModelFamilyId,
  type AzureChatModelFamilySource,
  DEFAULT_QUOTA_PERIOD,
  DEFAULT_FOUNDRY_TRANSCRIPTION_PROVIDER,
  DEFAULT_AZURE_CHAT_MODEL_FAMILY_ID,
  getEffectiveAzureChatModelFamilySource,
  GEMINI_TRANSCRIPTION_MODEL,
  MAI_TRANSCRIPTION_MODEL_ID,
  getEffectiveAzureChatModelFamilyId,
  isAzureChatModelFamilyId,
  getEffectiveTranscriptionProviderId,
  getEffectiveGeminiTranscriptionModelId,
  getEffectiveMaiTranscribeStyle,
  isFoundryTranscriptionProvider,
  toTranscriptionProviderGroup,
} from "../lib/modelRegistry";
import type { AzureRequestOptions } from "../lib/llmProvider";
import {
  isValidAzureResourceName,
  migrateLegacyAzureEndpoints,
  normalizeAzureEndpointOverride,
  normalizeAzureResourceName,
  resolveAzureResourceOrigins,
} from "../lib/azureResource";
import {
  listAzureChatDeployments as fetchAzureChatDeployments,
  type AzureDeploymentListResult,
} from "../lib/foundryDeployments";
import {
  clearAzureTemperatureCapability,
  getAzureTemperatureCapability,
} from "../lib/azureTemperatureCapability";
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
  type AzureUserScopeKind,
} from "../lib/azureUserAuth";
import {
  EXPORTABLE_SETTING_KEYS,
  sanitizeSettingsPayload,
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
  const azureResourceName = ref<string>("");
  const azureWhisperResourceName = ref<string>("");
  const azureSpeechResourceName = ref<string>("");
  const azureEndpointOverride = ref<string>("");
  const azureWhisperEndpointOverride = ref<string>("");
  const azureSpeechEndpointOverride = ref<string>("");
  const azureProjectName = ref<string>("");
  const azureAuthMode = ref<AzureAuthMode>("key");
  const azureApiKey = ref<string>("");
  const azureTenantId = ref<string>("");
  const azureClientId = ref<string>("");
  const azureClientSecret = ref<string>("");
  const azureApiVersion = ref<string>("");
  const azureOmitTemperature = ref<boolean>(false);
  const azureChatDeployment = ref<string>("");
  const azureChatModelFamily = ref<AzureChatModelFamilyId>(
    DEFAULT_AZURE_CHAT_MODEL_FAMILY_ID,
  );
  const azureChatModelFamilySource = ref<AzureChatModelFamilySource>(
    "manual",
  );
  const azureWhisperDeployment = ref<string>("");
  const azureSpeechApiKey = ref<string>("");
  const azureOrigins = computed(() =>
    resolveAzureResourceOrigins({
      resourceName: azureResourceName.value,
      whisperResourceName: azureWhisperResourceName.value,
      speechResourceName: azureSpeechResourceName.value,
      endpointOverride: azureEndpointOverride.value,
      whisperEndpointOverride: azureWhisperEndpointOverride.value,
      speechEndpointOverride: azureSpeechEndpointOverride.value,
    }),
  );
  /** 已解析的 main endpoint，供既有聊天流程和外部 UI 顯示使用。 */
  const azureEndpoint = computed(() => azureOrigins.value.main);
  /** 已解析的 Azure OpenAI Whisper endpoint。 */
  const azureWhisperEndpoint = computed(() => azureOrigins.value.whisper);
  /** 已解析的 Azure AI Speech endpoint，供既有 MAI 流程使用。 */
  const azureSpeechEndpoint = computed(() => azureOrigins.value.speech);
  /**
   * `entraUser` 模式下目前已登入的帳號。真實來源在 Rust（OS 憑證庫），
   * 這裡只是給 UI 與 computed 用的快照，由 `refreshAzureUserAccount()` 同步。
   */
  const azureUserAccount = ref<AzureUserAccount | null>(null);

  /**
   * 這一輪執行期間偵測到「登入已失效、需要使用者重新互動」。
   *
   * 憑證此時**仍在**憑證庫裡（Entra 的 `invalid_grant` 只代表必須改用互動
   * 模式，不代表憑證永久失效），所以不能靠「憑證是否存在」推論可用性——
   * 否則使用者只要存個設定或觸發一次跨視窗同步，綠色的「已登入」就會回來，
   * 但每次實際使用還是失敗。
   *
   * 刻意**不持久化**：重開 App 後條件可能已解除（使用者已接受使用條款、
   * 已符合條件式存取政策等），那時應該讓它再試一次，而不是永久標成過期。
   */
  const azureUserReauthRequired = ref(false);

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

  /**
   * 給設定頁用：**輸入框裡**的這組身分是不是目前已登入的帳號。
   *
   * `isAzureUserSignedIn` 比對的是「已儲存」的值，使用者在輸入框改了
   * Tenant/Client ID 但還沒按儲存時，畫面會一邊顯示上一組帳號的「已登入」、
   * 一邊把登入按鈕藏起來，讓人以為新設定已經生效。
   */
  function matchesSignedInAccount(tenantId: string, clientId: string) {
    return matchesCredentials(azureUserAccount.value, {
      tenantId: tenantId.trim(),
      clientId: clientId.trim(),
    });
  }

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
  const effectiveTranscriptionApiKey = computed(
    () => azureSpeechApiKey.value || azureApiKey.value,
  );
  const hasAzureTranscriptionCredentials = computed(() => {
    switch (azureAuthMode.value) {
      case "key":
        return effectiveTranscriptionApiKey.value !== "";
      case "entra":
        return (
          azureTenantId.value !== "" &&
          azureClientId.value !== "" &&
          azureClientSecret.value !== ""
        );
      case "entraUser":
        return isAzureUserSignedIn.value;
      default:
        azureAuthMode.value satisfies never;
        return false;
    }
  });
  const whisperProviderId = ref<TranscriptionProviderId>("groq");
  const lastFoundryProvider = ref<FoundryTranscriptionProviderId>(
    DEFAULT_FOUNDRY_TRANSCRIPTION_PROVIDER,
  );
  const transcriptionProviderGroup = computed(() =>
    toTranscriptionProviderGroup(whisperProviderId.value),
  );
  const foundryTranscriptionProviderId =
    computed<FoundryTranscriptionProviderId>(() =>
      isFoundryTranscriptionProvider(whisperProviderId.value)
        ? whisperProviderId.value
        : lastFoundryProvider.value,
    );
  const maiCandidateLocales = ref<MaiCandidateLocale[]>([]);
  const maiTranscribeStyle = ref<MaiTranscribeStyle>("default");
  /** Gemini 轉錄模型（Flash-Lite 免費額度高、Flash 品質優先） */
  const geminiTranscriptionModelId = ref<GeminiTranscriptionModelId>(
    GEMINI_TRANSCRIPTION_MODEL,
  );
  /** Gemini 轉錄免費額度（0 = 未設定）；Google 不公開 Free tier 數字，只能由使用者填入。 */
  const geminiFreeQuotaRequests = ref<number>(0);
  const geminiFreeQuotaPeriod = ref<QuotaPeriod>(DEFAULT_QUOTA_PERIOD);
  const hasWhisperConfig = computed(() => {
    if (whisperProviderId.value === "gemini") return geminiApiKey.value !== "";
    if (whisperProviderId.value === "mai") {
      return (
        azureEnabled.value &&
        azureSpeechEndpoint.value !== "" &&
        hasAzureTranscriptionCredentials.value
      );
    }
    if (whisperProviderId.value !== "azure") return apiKey.value !== "";
    return (
      azureEnabled.value &&
      azureWhisperEndpoint.value !== "" &&
      azureWhisperDeployment.value !== "" &&
      hasAzureTranscriptionCredentials.value
    );
  });
  let isLoaded = false;
  /**
   * 設定載入狀態（三態）。
   *
   * 不能用單一布林：載入**失敗**時若標記為已載入，寫入守門就被解除，
   * 下一次儲存仍可能用預設空值覆寫使用者原有的 endpoint/tenant/client/secret。
   * 只有 `ready` 允許寫入；`failed` 需由使用者明確重試或重設。
   */
  const settingsLoadState = ref<"loading" | "ready" | "failed">("loading");
  const isSettingsLoaded = computed(() => settingsLoadState.value === "ready");
  const settingsLoadFailed = computed(
    () => settingsLoadState.value === "failed",
  );

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

  /**
   * 取一份 Azure 連線設定的 immutable 快照。
   *
   * 換 token 是 async 的，等待期間另一個視窗可能改掉 endpoint / deployment /
   * authMode。若 await 前後各讀一次 reactive 值，就可能把「帳號 A 的 token」
   * 配上「資源 B 的 endpoint」，把內容送到非預期的 Azure 資源。
   * 因此在任何 await 之前一次取完，後續只用這份快照。
   */
  function snapshotAzureConfig() {
    const origins = azureOrigins.value;
    return {
      enabled: azureEnabled.value,
      endpoint: origins.main,
      whisperEndpoint: origins.whisper,
      foundryEndpoint: origins.foundry,
      projectName: azureProjectName.value,
      apiVersion: azureApiVersion.value,
      authMode: azureAuthMode.value,
      apiKey: azureApiKey.value,
      tenantId: azureTenantId.value,
      clientId: azureClientId.value,
      clientSecret: azureClientSecret.value,
      chatDeployment: azureChatDeployment.value,
      chatModelFamily: azureChatModelFamily.value,
      whisperDeployment: azureWhisperDeployment.value,
      speechEndpoint: origins.speech,
      speechApiKey: azureSpeechApiKey.value,
      maiCandidateLocales: [...maiCandidateLocales.value],
      maiTranscribeStyle: maiTranscribeStyle.value,
      omitTemperature: azureOmitTemperature.value,
    };
  }

  type AzureConfigSnapshot = ReturnType<typeof snapshotAzureConfig>;

  /**
   * 取 Entra 使用者 token，並在登入失效時同步更新兩個視窗的顯示。
   *
   * 憑證失效時 Rust **不會**刪掉憑證（Entra 的 `invalid_grant` 只代表
   * 「必須改用互動模式」，不代表憑證永久失效），所以顯示狀態不能靠
   * 「憑證是否存在」推論——必須由這裡明確標記。
   */
  async function acquireAzureUserToken(
    credentials: { tenantId: string; clientId: string },
    scopeKind: AzureUserScopeKind,
  ): Promise<string> {
    try {
      const token = await getAzureUserToken(credentials, scopeKind);
      azureUserReauthRequired.value = false;
      return token;
    } catch (err) {
      if (isAzureUserAuthFailure(extractErrorMessage(err))) {
        azureUserReauthRequired.value = true;
        azureUserAccount.value = null;
        try {
          await emitAzureAuthStateChanged();
        } catch (emitErr) {
          // 廣播失敗不可蓋掉原本的錯誤：使用者要看到的是「請重新登入」
          console.warn(
            "[useSettingsStore] failed to broadcast Azure auth state:",
            extractErrorMessage(emitErr),
          );
        }
      }
      throw err;
    }
  }

  async function saveAzureChatDeploymentSelection({
    deployment,
    modelFamily,
    familySource,
  }: {
    deployment: string;
    modelFamily: AzureChatModelFamilyId;
    familySource: AzureChatModelFamilySource;
  }) {
    try {
      const normalizedDeployment = deployment.trim();
      const effectiveFamily = getEffectiveAzureChatModelFamilyId(modelFamily);
      const effectiveSource = getEffectiveAzureChatModelFamilySource(
        familySource,
      );
      const store = await load(STORE_NAME);
      await store.set("azureChatDeployment", normalizedDeployment);
      await store.set("azureChatModelFamily", effectiveFamily);
      await store.set("azureChatModelFamilySource", effectiveSource);
      await store.save();

      azureChatDeployment.value = normalizedDeployment;
      azureChatModelFamily.value = effectiveFamily;
      azureChatModelFamilySource.value = effectiveSource;
      await emitEvent(SETTINGS_UPDATED, {
        key: "azureChatDeployment",
        value: normalizedDeployment,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAzureChatDeploymentSelection failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  function azureOptionsFromSnapshot(
    snap: AzureConfigSnapshot,
    authValue: string,
    authMode: AzureAuthHeaderMode,
  ): AzureRequestOptions {
    return {
      endpoint: snap.endpoint,
      apiVersion: snap.apiVersion || undefined,
      authMode,
      authValue,
      modelFamily: snap.chatModelFamily,
      omitTemperature: snap.omitTemperature,
    };
  }

  async function resolveAzureChatAuth(
    snap: AzureConfigSnapshot,
  ): Promise<{ authValue: string; authMode: AzureAuthHeaderMode }> {
    if (snap.authMode === "entraUser") {
      const token = await acquireAzureUserToken(
        { tenantId: snap.tenantId, clientId: snap.clientId },
        "chat",
      );
      return { authValue: token, authMode: "bearer" };
    }

    if (snap.authMode === "entra") {
      const token = await getAzureAccessToken(
        {
          tenantId: snap.tenantId,
          clientId: snap.clientId,
          clientSecret: snap.clientSecret,
        },
        getAzureScopeForApiKind("chat"),
      );
      return { authValue: token, authMode: "bearer" };
    }

    return { authValue: snap.apiKey, authMode: "key" };
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

    // 任何 await 之前先定格，之後只用這份快照（見 snapshotAzureConfig 說明）
    const snap = snapshotAzureConfig();

    // Azure 設定不完整 → 回空 apiKey，呼叫端走「未設定」流程（不打 token / 不送請求）
    if (!snap.enabled || snap.endpoint === "" || snap.chatDeployment === "") {
      return { apiKey: "", provider, modelId: snap.chatDeployment };
    }

    const auth = await resolveAzureChatAuth(snap);
    let temperatureCapability: Awaited<
      ReturnType<typeof getAzureTemperatureCapability>
    > = undefined;
    try {
      temperatureCapability = await getAzureTemperatureCapability(
        snap.endpoint,
        snap.chatDeployment,
      );
    } catch (err) {
      console.warn(
        "[useSettingsStore] failed to read Azure temperature capability:",
        extractErrorMessage(err),
      );
    }
    return {
      apiKey: auth.authValue,
      provider,
      modelId: snap.chatDeployment,
      azure: {
        ...azureOptionsFromSnapshot(snap, auth.authValue, auth.authMode),
        supportsTemperature: temperatureCapability?.supportsTemperature,
      },
    };
  }

  async function listAzureChatDeployments(): Promise<AzureDeploymentListResult> {
    const snap = snapshotAzureConfig();
    if (!snap.enabled || snap.endpoint === "") {
      throw new Error("AZURE_CONNECTION_INCOMPLETE");
    }

    const auth = await resolveAzureChatAuth(snap);
    if (auth.authValue.trim() === "") {
      throw new Error("AZURE_CREDENTIALS_INCOMPLETE");
    }

    return fetchAzureChatDeployments({
      foundryEndpoint: snap.foundryEndpoint,
      v1Endpoint: snap.endpoint,
      projectName: snap.projectName,
      authMode: auth.authMode,
      authValue: auth.authValue,
    });
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
  type TranscriptionRequestConfig =
    | {
        apiKey: string;
        provider: "groq";
        modelId: WhisperModelId;
        endpoint?: undefined;
        deployment?: undefined;
        apiVersion?: undefined;
        authMode?: undefined;
      }
    | {
        apiKey: string;
        provider: "gemini";
        modelId: GeminiTranscriptionModelId;
        endpoint?: undefined;
        deployment?: undefined;
        apiVersion?: undefined;
        authMode?: undefined;
      }
    | {
        apiKey: string;
        provider: "azure";
        modelId: WhisperModelId;
        endpoint?: string;
        deployment?: string;
        apiVersion?: string;
        authMode?: AzureAuthHeaderMode;
      }
    | {
        apiKey: string;
        provider: "mai";
        modelId: typeof MAI_TRANSCRIPTION_MODEL_ID;
        endpoint?: string;
        deployment?: undefined;
        apiVersion?: undefined;
        authMode?: AzureAuthHeaderMode;
        candidateLocales: MaiCandidateLocale[];
        transcribeStyle: MaiTranscribeStyle;
      };

  async function getWhisperRequestConfig(): Promise<TranscriptionRequestConfig> {
    const provider = whisperProviderId.value;
    const whisperModelId = selectedWhisperModelId.value;

    // Gemini 走 generateContent，模型固定（沿用 whisper-large-v3 會打到不存在的端點）
    if (provider === "gemini") {
      return {
        apiKey: geminiApiKey.value,
        provider: "gemini",
        modelId: geminiTranscriptionModelId.value,
      };
    }

    if (provider === "groq") {
      return {
        apiKey: apiKey.value,
        provider: "groq",
        modelId: whisperModelId,
      };
    }

    // 任何 await 之前先定格（同 getLlmRequestConfig 的理由）
    const snap = snapshotAzureConfig();

    if (provider === "mai") {
      const base = {
        provider: "mai" as const,
        modelId: MAI_TRANSCRIPTION_MODEL_ID,
        endpoint: snap.speechEndpoint || undefined,
        candidateLocales: snap.maiCandidateLocales,
        transcribeStyle: snap.maiTranscribeStyle,
      };
      if (!snap.enabled || snap.speechEndpoint === "") {
        return { ...base, apiKey: "" };
      }

      if (snap.authMode === "entraUser") {
        const token = await acquireAzureUserToken(
          { tenantId: snap.tenantId, clientId: snap.clientId },
          "whisper",
        );
        return { ...base, apiKey: token, authMode: "bearer" };
      }

      if (snap.authMode === "entra") {
        const token = await getAzureAccessToken(
          {
            tenantId: snap.tenantId,
            clientId: snap.clientId,
            clientSecret: snap.clientSecret,
          },
          getAzureScopeForApiKind("whisper"),
        );
        return { ...base, apiKey: token, authMode: "bearer" };
      }

      return {
        ...base,
        apiKey: snap.speechApiKey || snap.apiKey,
        authMode: "key",
      };
    }

    if (
      !snap.enabled ||
      snap.whisperEndpoint === "" ||
      snap.whisperDeployment === ""
    ) {
      return {
        apiKey: "",
        provider: "azure",
        modelId: whisperModelId,
      };
    }

    const base = {
      provider: "azure" as const,
      modelId: whisperModelId,
      endpoint: snap.whisperEndpoint,
      deployment: snap.whisperDeployment,
      apiVersion: snap.apiVersion || undefined,
    };

    // whisper 走傳統 deployments 路徑 → cognitiveservices 受眾
    if (snap.authMode === "entraUser") {
      const token = await acquireAzureUserToken(
        { tenantId: snap.tenantId, clientId: snap.clientId },
        "whisper",
      );
      return { ...base, apiKey: token, authMode: "bearer" };
    }

    const scope = getAzureScopeForApiKind("whisper");
    if (snap.authMode === "entra") {
      const token = await getAzureAccessToken(
        {
          tenantId: snap.tenantId,
          clientId: snap.clientId,
          clientSecret: snap.clientSecret,
        },
        scope,
      );
      return { ...base, apiKey: token, authMode: "bearer" };
    }

    return {
      ...base,
      apiKey: snap.speechApiKey || snap.apiKey,
      authMode: "key",
    };
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

  async function migrateStoredAzureEndpointSettings(
    store: Awaited<ReturnType<typeof load>>,
  ): Promise<void> {
    const keys = [
      "azureEndpoint",
      "azureSpeechEndpoint",
      "azureResourceName",
      "azureWhisperResourceName",
      "azureSpeechResourceName",
      "azureEndpointOverride",
      "azureWhisperEndpointOverride",
      "azureSpeechEndpointOverride",
      "azureProjectName",
    ] as const;
    const entries = await Promise.all(
      keys.map(async (key) => [key, await store.get(key)] as const),
    );
    const current = Object.fromEntries(
      entries.filter(([, value]) => value !== undefined),
    ) as Record<string, unknown>;
    const migrated = migrateLegacyAzureEndpoints(current);
    if (migrated.legacyKeysToDelete.length === 0) return;

    for (const key of [
      "azureResourceName",
      "azureSpeechResourceName",
      "azureEndpointOverride",
      "azureSpeechEndpointOverride",
      "azureProjectName",
    ]) {
      if (
        Object.prototype.hasOwnProperty.call(migrated.settings, key) &&
        migrated.settings[key] !== current[key]
      ) {
        await store.set(key, migrated.settings[key]);
      }
    }
    for (const key of migrated.legacyKeysToDelete) {
      await store.delete(key);
    }
    await store.save();
  }

  async function loadSettings() {
    if (isLoaded) return;

    try {
      const store = await load(STORE_NAME);
      await migrateStoredAzureEndpointSettings(store);
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
      azureResourceName.value =
        (await store.get<string>("azureResourceName"))?.trim() ?? "";
      azureWhisperResourceName.value =
        (await store.get<string>("azureWhisperResourceName"))?.trim() ?? "";
      azureSpeechResourceName.value =
        (await store.get<string>("azureSpeechResourceName"))?.trim() ?? "";
      azureEndpointOverride.value =
        (await store.get<string>("azureEndpointOverride"))?.trim() ?? "";
      azureWhisperEndpointOverride.value =
        (await store.get<string>("azureWhisperEndpointOverride"))?.trim() ?? "";
      azureSpeechEndpointOverride.value =
        (await store.get<string>("azureSpeechEndpointOverride"))?.trim() ?? "";
      azureProjectName.value =
        (await store.get<string>("azureProjectName"))?.trim() ?? "";
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
      const savedAzureChatModelFamily = await store.get<string>(
        "azureChatModelFamily",
      );
      // 舊版只有 omitTemperature；以它推導相容的 profile，但不在 load 時寫回，
      // 避免兩個視窗同時啟動時對同一個 store 競寫。
      azureChatModelFamily.value = getEffectiveAzureChatModelFamilyId(
        savedAzureChatModelFamily ??
          (azureOmitTemperature.value
            ? "azure-openai-reasoning"
            : "azure-openai"),
      );
      azureChatModelFamilySource.value =
        getEffectiveAzureChatModelFamilySource(
          await store.get<string>("azureChatModelFamilySource"),
        );
      azureWhisperDeployment.value =
        (await store.get<string>("azureWhisperDeployment"))?.trim() ?? "";
      azureSpeechApiKey.value =
        (await store.get<string>("azureSpeechApiKey"))?.trim() ?? "";
      maiCandidateLocales.value = normalizeMaiCandidateLocales(
        await store.get("maiCandidateLocales"),
      );
      maiTranscribeStyle.value = getEffectiveMaiTranscribeStyle(
        await store.get<string>("maiTranscribeStyle"),
      );
      const savedWhisperProviderId = getEffectiveTranscriptionProviderId(
        await store.get<string>("whisperProviderId"),
      );
      if (isFoundryTranscriptionProvider(savedWhisperProviderId)) {
        lastFoundryProvider.value = savedWhisperProviderId;
      }
      whisperProviderId.value =
        !azureEnabled.value &&
        (savedWhisperProviderId === "azure" || savedWhisperProviderId === "mai")
          ? "groq"
          : savedWhisperProviderId;
      if (whisperProviderId.value !== savedWhisperProviderId) {
        await store.set("whisperProviderId", whisperProviderId.value);
        await store.save();
      }
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
      settingsLoadState.value = "ready";
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
      // 載入失敗**不可**視為已載入：此時 reactive 值是預設空值，若解除寫入
      // 守門，下一次儲存就會用空值覆寫使用者原有的設定。維持 failed，
      // 由 UI 提示使用者重試（`isLoaded` 保持 false 讓守門繼續生效）。
      settingsLoadState.value = "failed";
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

  function normalizeRequiredAzureResourceName(value: string): string {
    const normalized = normalizeAzureResourceName(value);
    if (value.trim() !== "" && !isValidAzureResourceName(value)) {
      throw new Error("INVALID_AZURE_RESOURCE_NAME");
    }
    return normalized;
  }

  function normalizeAzureOverrideInput(value: string): string {
    const normalized = normalizeAzureEndpointOverride(value);
    if (value.trim() !== "" && normalized === "") {
      throw new Error("INVALID_AZURE_ENDPOINT_OVERRIDE");
    }
    return normalized;
  }

  async function saveAzureConnection(cfg: {
    enabled: boolean;
    resourceName: string;
    projectName: string;
    endpointOverride: string;
    authMode: AzureAuthMode;
    apiKey: string;
    tenantId: string;
    clientId: string;
    clientSecret: string;
    apiVersion: string;
    transcriptionResources?: {
      whisperResourceName: string;
      whisperEndpointOverride: string;
      speechResourceName: string;
      speechEndpointOverride: string;
      apiKey: string;
    };
  }) {
    try {
      // 守門：設定尚未載入完成時，輸入欄位還是預設空值，把它們存回去等於把
      // 使用者的既有設定整批清空。成因是 main-window.ts 先 app.mount() 才
      // await loadSettings()，View 的 onMounted 可能早於載入完成。
      // 防線放在資料層而非個別 View，才能一次涵蓋所有呼叫端。
      if (!isLoaded) {
        throw new Error("SETTINGS_NOT_LOADED");
      }
      const store = await load(STORE_NAME);
      const previousEndpoint = azureEndpoint.value;
      const previousChatDeployment = azureChatDeployment.value;
      const resourceName = normalizeRequiredAzureResourceName(cfg.resourceName);
      const endpointOverride = normalizeAzureOverrideInput(
        cfg.endpointOverride,
      );
      const transcriptionResources = cfg.transcriptionResources
        ? {
            whisperResourceName: normalizeRequiredAzureResourceName(
              cfg.transcriptionResources.whisperResourceName,
            ),
            whisperEndpointOverride: normalizeAzureOverrideInput(
              cfg.transcriptionResources.whisperEndpointOverride,
            ),
            speechResourceName: normalizeRequiredAzureResourceName(
              cfg.transcriptionResources.speechResourceName,
            ),
            speechEndpointOverride: normalizeAzureOverrideInput(
              cfg.transcriptionResources.speechEndpointOverride,
            ),
            apiKey: cfg.transcriptionResources.apiKey.trim(),
          }
        : undefined;
      const nextTenantId = cfg.tenantId.trim();
      const nextClientId = cfg.clientId.trim();
      // 換掉 tenant/client 等於換一個登入身分：舊的 refresh token 若不清掉會
      // 長期留在 OS 憑證庫，日後切回舊值還會「自動已登入」。
      const identityChanged =
        nextTenantId !== azureTenantId.value ||
        nextClientId !== azureClientId.value;
      if (identityChanged && !(await signOutAzureUserSilently())) {
        // 清除失敗卻仍覆寫 tenant/client，舊憑證就會因為算不出 key 而永久殘留
        throw new Error("AZURE_CREDENTIAL_CLEANUP_FAILED");
      }
      // 換了身分 → 之前那組的「需要重新登入」不再適用
      if (identityChanged) azureUserReauthRequired.value = false;
      await store.set("azureEnabled", cfg.enabled);
      await store.set("azureResourceName", resourceName);
      await store.set("azureProjectName", cfg.projectName.trim());
      await store.set("azureEndpointOverride", endpointOverride);
      await store.set("azureAuthMode", cfg.authMode);
      await store.set("azureApiKey", cfg.apiKey.trim());
      await store.set("azureTenantId", nextTenantId);
      await store.set("azureClientId", nextClientId);
      // 不因切換驗證模式而清掉 client secret：那是不可逆的破壞，使用者要切回
      // Secret 模式就得回 Azure Portal 重新產生。備份端已有「排除金鑰」選項
      // （SENSITIVE_SETTING_KEYS 含 azureClientSecret）處理外流疑慮，
      // 真的要清除請走「清除連線」，那是使用者明確的意圖。
      await store.set("azureClientSecret", cfg.clientSecret);
      await store.set("azureApiVersion", cfg.apiVersion.trim());
      if (transcriptionResources) {
        await store.set(
          "azureWhisperResourceName",
          transcriptionResources.whisperResourceName,
        );
        await store.set(
          "azureWhisperEndpointOverride",
          transcriptionResources.whisperEndpointOverride,
        );
        await store.set(
          "azureSpeechResourceName",
          transcriptionResources.speechResourceName,
        );
        await store.set(
          "azureSpeechEndpointOverride",
          transcriptionResources.speechEndpointOverride,
        );
        await store.set("azureSpeechApiKey", transcriptionResources.apiKey);
      }
      // Once explicitly saved in the new model, old keys must not re-run a
      // migration and overwrite a subsequent user edit.
      await store.delete("azureEndpoint");
      await store.delete("azureSpeechEndpoint");

      // 停用 Azure 時，把仍指向 azure 的 provider 切回 groq（避免無 UI 可切換而卡死）
      if (!cfg.enabled) {
        if (selectedLlmProviderId.value === "azure") {
          const groqModel = getDefaultModelIdForProvider("groq");
          await store.set("llmProviderId", "groq");
          await store.set("llmModelId", groqModel);
          selectedLlmProviderId.value = "groq";
          selectedLlmModelId.value = groqModel;
        }
        if (
          whisperProviderId.value === "azure" ||
          whisperProviderId.value === "mai"
        ) {
          await store.set("whisperProviderId", "groq");
          whisperProviderId.value = "groq";
        }
      }
      await store.save();

      azureEnabled.value = cfg.enabled;
      azureResourceName.value = resourceName;
      azureProjectName.value = cfg.projectName.trim();
      azureEndpointOverride.value = endpointOverride;
      azureAuthMode.value = cfg.authMode;
      azureApiKey.value = cfg.apiKey.trim();
      azureTenantId.value = cfg.tenantId.trim();
      azureClientId.value = cfg.clientId.trim();
      azureClientSecret.value = cfg.clientSecret;
      azureApiVersion.value = cfg.apiVersion.trim();
      if (transcriptionResources) {
        azureWhisperResourceName.value =
          transcriptionResources.whisperResourceName;
        azureWhisperEndpointOverride.value =
          transcriptionResources.whisperEndpointOverride;
        azureSpeechResourceName.value =
          transcriptionResources.speechResourceName;
        azureSpeechEndpointOverride.value =
          transcriptionResources.speechEndpointOverride;
        azureSpeechApiKey.value = transcriptionResources.apiKey;
      }
      if (azureEndpoint.value !== previousEndpoint) {
        try {
          await clearAzureTemperatureCapability(
            previousEndpoint,
            previousChatDeployment,
          );
        } catch (err) {
          console.warn(
            "[useSettingsStore] failed to clear Azure temperature capability:",
            extractErrorMessage(err),
          );
        }
      }
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
      // 守門同 saveAzureConnection：設定尚未載入完成時，reactive 的
      // tenant/client 還是空值，signOutAzureUserSilently() 會直接回成功，
      // 接著就把使用者既有的 endpoint / client secret 全部刪掉，
      // 而憑證庫裡那筆 refresh token 反而清不掉。
      if (!isLoaded) {
        throw new Error("SETTINGS_NOT_LOADED");
      }
      // 先清 OS 憑證庫再刪設定：一旦 tenant/client 從 store 消失就再也算不出
      // 該用哪個 key 去刪，refresh token 會永久殘留在使用者機器上。
      // 因此清除失敗時**不繼續**刪設定，讓使用者能重試而不是留下清不掉的殘留。
      if (!(await signOutAzureUserSilently())) {
        throw new Error("AZURE_CREDENTIAL_CLEANUP_FAILED");
      }

      const store = await load(STORE_NAME);
      const previousEndpoint = azureEndpoint.value;
      const previousChatDeployment = azureChatDeployment.value;
      const keys = [
        "azureEnabled",
        "azureResourceName",
        "azureWhisperResourceName",
        "azureSpeechResourceName",
        "azureEndpointOverride",
        "azureWhisperEndpointOverride",
        "azureSpeechEndpointOverride",
        "azureEndpoint",
        "azureProjectName",
        "azureAuthMode",
        "azureApiKey",
        "azureTenantId",
        "azureClientId",
        "azureClientSecret",
        "azureApiVersion",
        "azureOmitTemperature",
        "azureSpeechEndpoint",
        "azureSpeechApiKey",
        "maiCandidateLocales",
        "maiTranscribeStyle",
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
      if (
        whisperProviderId.value === "azure" ||
        whisperProviderId.value === "mai"
      ) {
        await store.set("whisperProviderId", "groq");
        whisperProviderId.value = "groq";
      }
      await store.save();

      azureEnabled.value = false;
      azureResourceName.value = "";
      azureWhisperResourceName.value = "";
      azureSpeechResourceName.value = "";
      azureEndpointOverride.value = "";
      azureWhisperEndpointOverride.value = "";
      azureSpeechEndpointOverride.value = "";
      try {
        await clearAzureTemperatureCapability(
          previousEndpoint,
          previousChatDeployment,
        );
      } catch (err) {
        console.warn(
          "[useSettingsStore] failed to clear Azure temperature capability:",
          extractErrorMessage(err),
        );
      }
      azureProjectName.value = "";
      azureAuthMode.value = "key";
      azureApiKey.value = "";
      azureTenantId.value = "";
      azureClientId.value = "";
      azureClientSecret.value = "";
      azureApiVersion.value = "";
      azureOmitTemperature.value = false;
      azureSpeechApiKey.value = "";
      maiCandidateLocales.value = [];
      maiTranscribeStyle.value = "default";
      clearAzureTokenCache();
      azureUserAccount.value = null;
      azureUserReauthRequired.value = false;
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

  /**
   * 只清掉本視窗的帳號快照，不動憑證庫。
   * 用於接收「已登出／登入失效」的跨視窗通知：此時憑證可能仍在
   * （需要重新互動而已），回頭重讀只會把畫面又變回「已登入」。
   */
  function clearAzureUserAccountSnapshot() {
    azureUserAccount.value = null;
    azureUserReauthRequired.value = true;
  }

  /** 換了身分／重新登入時呼叫：讓下一次重讀能正常反映憑證庫。 */
  function clearAzureUserReauthFlag() {
    azureUserReauthRequired.value = false;
  }

  /**
   * 依目前的 tenant/client 重讀登入狀態。憑證庫不可用時視為未登入，不中斷流程。
   *
   * 已知需要重新互動時直接跳過：憑證確實還在，重讀會把畫面翻回「已登入」，
   * 但實際每次使用都失敗（見 azureUserReauthRequired 的說明）。
   */
  async function refreshAzureUserAccount() {
    if (azureUserReauthRequired.value) return;
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

    // 這個函式自己會覆寫 tenant/client，因此也必須自己負責舊身分的清理——
    // 不能倚賴「呼叫端一定先做過 saveAzureConnection」。目前唯一的呼叫端
    // 確實有做（於是這裡通常是 no-op），但只要有人新增第二個入口而未先存，
    // 舊身分的 refresh token 就會因為算不出 key 而變成永久孤兒。
    const identityChanged =
      tenantId !== azureTenantId.value || clientId !== azureClientId.value;
    if (identityChanged && !(await signOutAzureUserSilently())) {
      throw new Error("AZURE_CREDENTIAL_CLEANUP_FAILED");
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
      azureUserReauthRequired.value = false;
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

  /**
   * 內部用：清掉憑證庫但不動設定。
   * 回傳是否成功——呼叫端若接著要刪掉 tenant/client，必須先確認這裡成功，
   * 否則殘留的 refresh token 會因為算不出 key 而永遠清不掉。
   *
   * **會先取消進行中的登入**：否則使用者在瀏覽器登入的期間按了清除/儲存/匯入，
   * 稍後回來的 callback 仍會把 refresh token 寫回憑證庫，而此時 locator 已被
   * 覆寫或刪除，那筆憑證就再也對應不到、也清不掉。
   */
  async function signOutAzureUserSilently(): Promise<boolean> {
    await cancelAzureUserSignInFlow();
    if (azureTenantId.value === "" || azureClientId.value === "") return true;
    try {
      await signOutAzureUser({
        tenantId: azureTenantId.value,
        clientId: azureClientId.value,
      });
      return true;
    } catch (err) {
      console.warn(
        "[useSettingsStore] Azure sign-out failed:",
        extractErrorMessage(err),
      );
      return false;
    }
  }

  async function signOutAzureUserAccount() {
    // 先取消進行中的登入，否則稍後回來的 callback 會把使用者無聲地重新登入
    await cancelAzureUserSignInFlow();
    await signOutAzureUser({
      tenantId: azureTenantId.value,
      clientId: azureClientId.value,
    });
    azureUserAccount.value = null;
    azureUserReauthRequired.value = false;
    clearAzureTokenCache();
    await emitAzureAuthStateChanged();
  }

  async function saveAzureChatDeployment(name: string) {
    try {
      const normalizedName = name.trim();
      const store = await load(STORE_NAME);
      await store.set("azureChatDeployment", normalizedName);
      // 手動輸入沒有 Foundry metadata 可供驗證，不能繼續宣稱目前 profile
      // 來自上一個部署的自動判定。
      await store.set("azureChatModelFamilySource", "manual");
      await store.save();
      azureChatDeployment.value = normalizedName;
      azureChatModelFamilySource.value = "manual";
      const payload: SettingsUpdatedPayload = {
        key: "azureChatDeployment",
        value: normalizedName,
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

  async function saveAzureChatModelFamily(id: AzureChatModelFamilyId) {
    try {
      const effectiveId = getEffectiveAzureChatModelFamilyId(id);
      const store = await load(STORE_NAME);
      await store.set("azureChatModelFamily", effectiveId);
      await store.set("azureChatModelFamilySource", "manual");
      await store.save();
      azureChatModelFamily.value = effectiveId;
      azureChatModelFamilySource.value = "manual";
      await emitEvent(SETTINGS_UPDATED, {
        key: "azureChatModelFamily",
        value: effectiveId,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAzureChatModelFamily failed:",
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

  async function saveAzureTranscriptionResources(cfg: {
    whisperResourceName: string;
    whisperEndpointOverride: string;
    speechResourceName: string;
    speechEndpointOverride: string;
    apiKey: string;
  }) {
    try {
      if (!isLoaded) {
        throw new Error("SETTINGS_NOT_LOADED");
      }
      const store = await load(STORE_NAME);
      const whisperResourceName = normalizeRequiredAzureResourceName(
        cfg.whisperResourceName,
      );
      const speechResourceName = normalizeRequiredAzureResourceName(
        cfg.speechResourceName,
      );
      const whisperEndpointOverride = normalizeAzureOverrideInput(
        cfg.whisperEndpointOverride,
      );
      const speechEndpointOverride = normalizeAzureOverrideInput(
        cfg.speechEndpointOverride,
      );
      await store.set("azureWhisperResourceName", whisperResourceName);
      await store.set("azureWhisperEndpointOverride", whisperEndpointOverride);
      await store.set("azureSpeechResourceName", speechResourceName);
      await store.set("azureSpeechEndpointOverride", speechEndpointOverride);
      await store.set("azureSpeechApiKey", cfg.apiKey.trim());
      await store.delete("azureSpeechEndpoint");
      await store.save();
      azureWhisperResourceName.value = whisperResourceName;
      azureWhisperEndpointOverride.value = whisperEndpointOverride;
      azureSpeechResourceName.value = speechResourceName;
      azureSpeechEndpointOverride.value = speechEndpointOverride;
      azureSpeechApiKey.value = cfg.apiKey.trim();
      const payload: SettingsUpdatedPayload = {
        key: "azureTranscriptionResources",
        value: {
          whisperResourceName,
          speechResourceName,
        },
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAzureTranscriptionResources failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveMaiCandidateLocales(locales: MaiCandidateLocale[]) {
    try {
      const normalized = normalizeMaiCandidateLocales(locales);
      const store = await load(STORE_NAME);
      await store.set("maiCandidateLocales", normalized);
      await store.save();
      maiCandidateLocales.value = normalized;
      await emitEvent(SETTINGS_UPDATED, {
        key: "maiCandidateLocales",
        value: normalized,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] saveMaiCandidateLocales failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveMaiTranscribeStyle(style: MaiTranscribeStyle) {
    try {
      const normalized = getEffectiveMaiTranscribeStyle(style);
      const store = await load(STORE_NAME);
      await store.set("maiTranscribeStyle", normalized);
      await store.save();
      maiTranscribeStyle.value = normalized;
      await emitEvent(SETTINGS_UPDATED, {
        key: "maiTranscribeStyle",
        value: normalized,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] saveMaiTranscribeStyle failed:",
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
      const effectiveId =
        !azureEnabled.value && (id === "azure" || id === "mai") ? "groq" : id;
      const store = await load(STORE_NAME);
      await store.set("whisperProviderId", effectiveId);
      await store.save();
      whisperProviderId.value = effectiveId;
      const payload: SettingsUpdatedPayload = {
        key: "whisperProvider",
        value: effectiveId,
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

  async function saveTranscriptionProviderGroup(
    group: TranscriptionProviderGroup,
  ) {
    await saveWhisperProvider(
      group === "foundry" ? lastFoundryProvider.value : group,
    );
  }

  async function saveFoundryTranscriptionProvider(
    id: FoundryTranscriptionProviderId,
  ) {
    await saveWhisperProvider(id);
    lastFoundryProvider.value = id;
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
          azureResourceName.value =
            (await store.get<string>("azureResourceName"))?.trim() ?? "";
          azureWhisperResourceName.value =
            (await store.get<string>("azureWhisperResourceName"))?.trim() ??
            "";
          azureSpeechResourceName.value =
            (await store.get<string>("azureSpeechResourceName"))?.trim() ?? "";
          azureEndpointOverride.value =
            (await store.get<string>("azureEndpointOverride"))?.trim() ?? "";
          azureWhisperEndpointOverride.value =
            (await store.get<string>("azureWhisperEndpointOverride"))?.trim() ??
            "";
          azureSpeechEndpointOverride.value =
            (await store.get<string>("azureSpeechEndpointOverride"))?.trim() ??
            "";
          azureProjectName.value =
            (await store.get<string>("azureProjectName"))?.trim() ?? "";
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
          azureChatModelFamily.value = getEffectiveAzureChatModelFamilyId(
            (await store.get<string>("azureChatModelFamily")) ??
              (azureOmitTemperature.value
                ? "azure-openai-reasoning"
                : "azure-openai"),
          );
          azureChatModelFamilySource.value =
            getEffectiveAzureChatModelFamilySource(
              await store.get<string>("azureChatModelFamilySource"),
            );
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
      //
      // 這一段刻意「先讀完，再一次套用」：語音流程可能在任何一個 await 之間
      // 呼叫 snapshotAzureConfig()，若邊讀邊寫 ref，就會取到新 endpoint 配
      // 舊 authMode／舊 tenant 的混合設定，把內容送到非預期的 Azure 資源。
      // 下面的賦值區塊沒有 await，對其他協程而言是不可分割的。
      const nextAzureOmitTemperature =
        (await store.get<boolean>("azureOmitTemperature")) ?? false;
      const savedCrossWindowAzureChatModelFamily = await store.get<string>(
        "azureChatModelFamily",
      );
      const savedCrossWindowAzureChatModelFamilySource = await store.get<string>(
        "azureChatModelFamilySource",
      );
      const nextAzure = {
        enabled: (await store.get<boolean>("azureEnabled")) ?? false,
        resourceName:
          (await store.get<string>("azureResourceName"))?.trim() ?? "",
        whisperResourceName:
          (await store.get<string>("azureWhisperResourceName"))?.trim() ?? "",
        speechResourceName:
          (await store.get<string>("azureSpeechResourceName"))?.trim() ?? "",
        endpointOverride:
          (await store.get<string>("azureEndpointOverride"))?.trim() ?? "",
        whisperEndpointOverride:
          (await store.get<string>("azureWhisperEndpointOverride"))?.trim() ??
          "",
        speechEndpointOverride:
          (await store.get<string>("azureSpeechEndpointOverride"))?.trim() ??
          "",
        projectName:
          (await store.get<string>("azureProjectName"))?.trim() ?? "",
        authMode: toAzureAuthMode(await store.get("azureAuthMode")),
        apiKey: (await store.get<string>("azureApiKey"))?.trim() ?? "",
        tenantId: (await store.get<string>("azureTenantId"))?.trim() ?? "",
        clientId: (await store.get<string>("azureClientId"))?.trim() ?? "",
        clientSecret: (await store.get<string>("azureClientSecret")) ?? "",
        apiVersion: (await store.get<string>("azureApiVersion"))?.trim() ?? "",
        omitTemperature: nextAzureOmitTemperature,
        chatDeployment:
          (await store.get<string>("azureChatDeployment"))?.trim() ?? "",
        chatModelFamily: getEffectiveAzureChatModelFamilyId(
          savedCrossWindowAzureChatModelFamily ??
            (nextAzureOmitTemperature
              ? "azure-openai-reasoning"
              : "azure-openai"),
        ),
        chatModelFamilySource: getEffectiveAzureChatModelFamilySource(
          savedCrossWindowAzureChatModelFamilySource,
        ),
        whisperDeployment:
          (await store.get<string>("azureWhisperDeployment"))?.trim() ?? "",
        speechApiKey:
          (await store.get<string>("azureSpeechApiKey"))?.trim() ?? "",
        maiCandidateLocales: normalizeMaiCandidateLocales(
          await store.get("maiCandidateLocales"),
        ),
        maiTranscribeStyle: getEffectiveMaiTranscribeStyle(
          await store.get<string>("maiTranscribeStyle"),
        ),
        whisperProvider: getEffectiveTranscriptionProviderId(
          await store.get<string>("whisperProviderId"),
        ),
      };
      azureEnabled.value = nextAzure.enabled;
      azureResourceName.value = nextAzure.resourceName;
      azureWhisperResourceName.value = nextAzure.whisperResourceName;
      azureSpeechResourceName.value = nextAzure.speechResourceName;
      azureEndpointOverride.value = nextAzure.endpointOverride;
      azureWhisperEndpointOverride.value = nextAzure.whisperEndpointOverride;
      azureSpeechEndpointOverride.value = nextAzure.speechEndpointOverride;
      azureProjectName.value = nextAzure.projectName;
      azureAuthMode.value = nextAzure.authMode;
      azureApiKey.value = nextAzure.apiKey;
      azureTenantId.value = nextAzure.tenantId;
      azureClientId.value = nextAzure.clientId;
      azureClientSecret.value = nextAzure.clientSecret;
      azureApiVersion.value = nextAzure.apiVersion;
      azureOmitTemperature.value = nextAzure.omitTemperature;
      azureChatDeployment.value = nextAzure.chatDeployment;
      azureChatModelFamily.value = nextAzure.chatModelFamily;
      azureChatModelFamilySource.value = nextAzure.chatModelFamilySource;
      azureWhisperDeployment.value = nextAzure.whisperDeployment;
      azureSpeechApiKey.value = nextAzure.speechApiKey;
      maiCandidateLocales.value = nextAzure.maiCandidateLocales;
      maiTranscribeStyle.value = nextAzure.maiTranscribeStyle;
      whisperProviderId.value =
        !nextAzure.enabled &&
        (nextAzure.whisperProvider === "azure" ||
          nextAzure.whisperProvider === "mai")
          ? "groq"
          : nextAzure.whisperProvider;
      if (isFoundryTranscriptionProvider(nextAzure.whisperProvider)) {
        lastFoundryProvider.value = nextAzure.whisperProvider;
      }
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

  /**
   * 目前執行的是否為 debug 建置（Rust `cfg!(debug_assertions)`）。
   *
   * 查詢失敗時保守回 true：寧可不自動註冊開機自啟動（使用者仍可手動開啟），
   * 也不要誤把自啟動指向帶 console 的開發執行檔。
   */
  async function isDebugBuild(): Promise<boolean> {
    try {
      return await invoke<boolean>("is_debug_build");
    } catch (err) {
      console.warn(
        "[useSettingsStore] is_debug_build failed; assuming debug build:",
        extractErrorMessage(err),
      );
      return true;
    }
  }

  async function initializeAutoStart() {
    try {
      const store = await load(STORE_NAME);
      const hasInitAutoStart = await store.get<boolean>("hasInitAutoStart");

      if (!hasInitAutoStart) {
        // autostart 的登錄值名稱取自 productName，與 identifier 無關，所有建置共用
        // 同一把（Windows 為 `HKCU\...\Run\SayIt`）。debug 建置若在這裡自動註冊，
        // 會把開機自啟動指向帶 console 的開發執行檔、蓋掉正式版。
        // 因此 debug 只讀狀態、不自動註冊，也刻意不寫入 hasInitAutoStart，
        // 讓正式版之後仍能正常完成首次註冊；使用者仍可從設定頁手動開關。
        if (await isDebugBuild()) {
          await loadAutoStartStatus();
          console.log(
            "[useSettingsStore] Debug build: skipped first-launch auto-start registration",
          );
          return;
        }

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
      stripped.whisperProviderId === "gemini" ||
      stripped.whisperProviderId === "mai"
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
   * 3) 補 refresh 缺漏的副作用：熱鍵向 Rust 重新註冊、同步檔案記錄、清 Azure token 快取、套用 autostart。
   * 4) emit 單一 SETTINGS_UPDATED 通知其他視窗。
   */
  async function importSettings(settings: SettingsPayload): Promise<void> {
    // 守門同 saveAzureConnection：載入未完成時 reactive 的 tenant/client 是
    // 空值，identityChanged 會誤判、登出也會直接回成功，舊憑證因此變孤兒。
    if (!isLoaded) {
      throw new Error("SETTINGS_NOT_LOADED");
    }
    const store = await load(STORE_NAME);
    const migratedSettings = migrateLegacyAzureEndpoints(
      sanitizeSettingsPayload(settings),
    ).settings;
    let autoStartDesired: boolean | null = null;
    const importedDebugLogEnabled = migratedSettings["debugLogEnabled"];

    // 匯入會直接覆寫 tenant/client。若不先登出舊身分，舊帳號的 refresh token
    // 會留在 OS 憑證庫，而覆寫後再也算不出它的 key —— 永久孤兒。
    // （`saveAzureConnection` 的 identityChanged 分支有做，匯入路徑先前漏了。）
    const incomingTenant = migratedSettings["azureTenantId"];
    const incomingClient = migratedSettings["azureClientId"];
    const identityChanged =
      (typeof incomingTenant === "string" &&
        incomingTenant.trim() !== azureTenantId.value) ||
      (typeof incomingClient === "string" &&
        incomingClient.trim() !== azureClientId.value);
    if (identityChanged && !(await signOutAzureUserSilently())) {
      // 同 saveAzureConnection：清不掉就不可覆寫 locator，否則永久孤兒
      throw new Error("AZURE_CREDENTIAL_CLEANUP_FAILED");
    }
    // 匯入等於換一組設定 → 舊的「需要重新登入」標記不再適用
    azureUserReauthRequired.value = false;

    const importedAzureChatDeployment =
      migratedSettings["azureChatDeployment"];
    const importedAzureChatModelFamily =
      migratedSettings["azureChatModelFamily"];
    let importedAzureChatModelFamilyDefaulted = false;
    if (
      typeof importedAzureChatDeployment === "string" &&
      importedAzureChatDeployment.trim() !== "" &&
      !isAzureChatModelFamilyId(importedAzureChatModelFamily)
    ) {
      // 舊備份沒有 family 時不可沿用本機既有值，否則新的 deployment 會套錯
      // profile。仍以備份內既有 omitTemperature 維持舊版的參數行為。
      const importedOmitTemperature =
        migratedSettings["azureOmitTemperature"] === true;
      await store.set(
        "azureChatModelFamily",
        importedOmitTemperature
          ? "azure-openai-reasoning"
          : DEFAULT_AZURE_CHAT_MODEL_FAMILY_ID,
      );
      importedAzureChatModelFamilyDefaulted = true;
    }

    for (const [key, value] of Object.entries(migratedSettings)) {
      if (key === AUTO_START_KEY) {
        if (typeof value === "boolean") autoStartDesired = value;
        continue;
      }
      // 防禦：忽略白名單外的未知 key（含內部 migration 旗標）
      if (!EXPORTABLE_KEY_SET.has(key)) continue;
      if (
        key === "azureResourceName" ||
        key === "azureWhisperResourceName" ||
        key === "azureSpeechResourceName"
      ) {
        if (typeof value !== "string") {
          continue;
        }
        if (value.trim() === "") {
          await store.set(key as ExportableSettingKey, "");
          continue;
        }
        if (!isValidAzureResourceName(value)) {
          continue;
        }
        await store.set(
          key as ExportableSettingKey,
          normalizeAzureResourceName(value),
        );
        continue;
      }
      if (
        key === "azureEndpointOverride" ||
        key === "azureWhisperEndpointOverride" ||
        key === "azureSpeechEndpointOverride"
      ) {
        if (typeof value !== "string") continue;
        const endpoint = normalizeAzureEndpointOverride(value);
        if (value.trim() !== "" && endpoint === "") continue;
        await store.set(key as ExportableSettingKey, endpoint);
        continue;
      }
      await store.set(key as ExportableSettingKey, value);
    }
    if (importedAzureChatModelFamilyDefaulted) {
      // 舊備份的 deployment 沒有可信 family，不能保留目標機器原本的 auto
      // 標記，也不能採信備份中與無效 family 搭配的來源欄位。
      await store.set("azureChatModelFamilySource", "manual");
    }
    if (
      migratedSettings["azureEnabled"] === false &&
      (migratedSettings["whisperProviderId"] === "azure" ||
        migratedSettings["whisperProviderId"] === "mai")
    ) {
      await store.set("whisperProviderId", "groq");
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
    if (typeof importedDebugLogEnabled === "boolean") {
      try {
        await setFileLoggingEnabled(importedDebugLogEnabled);
      } catch (err) {
        console.error(
          "[useSettingsStore] failed to sync imported debug log setting:",
          extractErrorMessage(err),
        );
        captureError(err, { source: "settings", step: "import-debug-log" });
      }
    }
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
    azureWhisperEndpoint,
    azureResourceName,
    azureWhisperResourceName,
    azureSpeechResourceName,
    azureEndpointOverride,
    azureWhisperEndpointOverride,
    azureSpeechEndpointOverride,
    azureProjectName,
    azureAuthMode,
    azureApiKey: computed(() => azureApiKey.value),
    azureTenantId,
    azureClientId,
    azureClientSecret: computed(() => azureClientSecret.value),
    azureApiVersion,
    azureOmitTemperature,
    azureChatDeployment,
    azureChatModelFamily,
    azureChatModelFamilySource,
    azureWhisperDeployment,
    azureSpeechEndpoint,
    azureSpeechApiKey: computed(() => azureSpeechApiKey.value),
    effectiveTranscriptionApiKey,
    azureUserAccount: computed(() => azureUserAccount.value),
    isSettingsLoaded,
    settingsLoadFailed,
    isAzureUserSignedIn,
    matchesSignedInAccount,
    hasAzureCredentials,
    signInAzureUserAccount,
    signOutAzureUserAccount,
    cancelAzureUserSignInFlow,
    refreshAzureUserAccount,
    clearAzureUserAccountSnapshot,
    clearAzureUserReauthFlag,
    azureUserReauthRequired,
    whisperProviderId,
    transcriptionProviderGroup,
    foundryTranscriptionProviderId,
    geminiTranscriptionModelId,
    saveGeminiTranscriptionModel,
    geminiFreeQuotaRequests,
    geminiFreeQuotaPeriod,
    saveGeminiFreeQuota,
    maiCandidateLocales,
    maiTranscribeStyle,
    saveAzureConnection,
    deleteAzureConnection,
    listAzureChatDeployments,
    saveAzureChatDeployment,
    saveAzureChatModelFamily,
    saveAzureChatDeploymentSelection,
    saveAzureWhisperDeployment,
    saveAzureTranscriptionResources,
    saveMaiCandidateLocales,
    saveMaiTranscribeStyle,
    saveAzureOmitTemperature,
    saveWhisperProvider,
    saveTranscriptionProviderGroup,
    saveFoundryTranscriptionProvider,
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
