<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  useSettingsStore,
  DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
} from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import {
  useReplacementTableSort,
  type ReplacementSortKey,
} from "../composables/useReplacementTableSort";
import { useHistoryStore } from "../stores/useHistoryStore";
import { useVocabularyStore } from "../stores/useVocabularyStore";
import { useReplacementStore } from "../stores/useReplacementStore";
import {
  buildBackupFile,
  buildBackupFilename,
  serializeBackup,
  encryptBackup,
  parseBackup,
  getBackupPayload,
  isSupportedDictionaryBlock,
  sanitizeSettingsPayload,
  type BackupFile,
} from "../lib/settingsTransfer";
import { buildExportFile, parseImportContent } from "../lib/vocabularyTransfer";
import { captureError } from "../lib/sentry";
import {
  listenToEvent,
  HOTKEY_RECORDING_CAPTURED,
  HOTKEY_RECORDING_REJECTED,
} from "../composables/useTauriEvents";
import {
  isSignInCancelledError,
  isPolicyDeniedError,
  findSignInErrorKey,
} from "../lib/azureUserAuth";
import {
  type PresetTriggerKey,
  type ComboTriggerKey,
  isCustomTriggerKey,
  isComboTriggerKey,
} from "../types/settings";
import type {
  RecordingCapturedPayload,
  RecordingRejectedPayload,
} from "../types/events";
import type { TriggerMode } from "../types";
import type { ReplacementRule, ReplacementTiming } from "../types/replacement";
import {
  getDomCodeByKeycode,
  getKeyDisplayNameByKeycode,
} from "../lib/keycodeMap";
import {
  WHISPER_MODEL_LIST,
  AZURE_CHAT_MODEL_FAMILY_LIST,
  findLlmModelConfig,
  findAzureChatModelFamilyConfig,
  resolveAzureFamilyFromDeployment,
  suggestAzureChatModelFamily,
  findWhisperModelConfig,
  type AzureChatModelFamilyId,
  getModelListByProvider,
  type LlmModelId,
  type LlmProviderId,
  type WhisperModelId,
  type TranscriptionProviderId,
  type QuotaPeriod,
  type GeminiTranscriptionModelId,
  type MaiTranscribeStyle,
  MAI_TRANSCRIPTION_MODEL_ID,
  GEMINI_TRANSCRIPTION_MODEL_LIST,
  findGeminiTranscriptionModelConfig,
} from "../lib/modelRegistry";
import { LLM_PROVIDER_LIST, findProviderConfig } from "../lib/llmProvider";
import type {
  AzureChatDeployment,
  AzureDeploymentListResult,
} from "../lib/foundryDeployments";
import {
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  MAI_CANDIDATE_LOCALE_OPTIONS,
  type MaiCandidateLocale,
  type SupportedLocale,
  type TranscriptionLocale,
} from "../i18n/languageConfig";

import { PROMPT_MODE_VALUES, type PromptMode, THEME_MODE_VALUES, type ThemeMode } from "../types/settings";
import { AZURE_AUTH_MODE_VALUES, type AzureAuthMode } from "../types/settings";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AtSign,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bug,
  CircleAlert,
  Download,
  Facebook,
  FolderOpen,
  Github,
  Globe,
  Instagram,
  Linkedin,
  Lock,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Upload,
  CircleCheck,
  LoaderCircle,
} from "lucide-vue-next";
import { openLogFolder } from "../lib/logger";
import type { AudioInputDeviceInfo } from "../types/audio";
import { useAudioPreview } from "../composables/useAudioPreview";
import ConnectionTestButton from "../components/ConnectionTestButton.vue";
import InlineFeedback from "../components/InlineFeedback.vue";
import SettingsActionRow from "../components/SettingsActionRow.vue";
import SettingsControlRow from "../components/SettingsControlRow.vue";
import {
  testLlmConnection,
  testWhisperConnection,
} from "../lib/connectionTest";

const settingsStore = useSettingsStore();
const historyStore = useHistoryStore();
const vocabularyStore = useVocabularyStore();
const replacementStore = useReplacementStore();
const { t, locale } = useI18n();

declare const __APP_VERSION__: string;

// ── 快捷鍵設定 ──────────────────────────────────────────────
const isMac = navigator.userAgent.includes("Mac");

const triggerKeyOptions = computed<{ value: PresetTriggerKey; label: string }[]>(() =>
  isMac
    ? [
        { value: "fn", label: t("settings.hotkey.keys.fn") },
        { value: "option", label: t("settings.hotkey.keys.leftOption") },
        { value: "rightOption", label: t("settings.hotkey.keys.rightOption") },
        { value: "control", label: t("settings.hotkey.keys.leftControl") },
        { value: "rightControl", label: t("settings.hotkey.keys.rightControl") },
        { value: "command", label: t("settings.hotkey.keys.command") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
    : [
        { value: "rightAlt", label: t("settings.hotkey.keys.rightAlt") },
        { value: "leftAlt", label: t("settings.hotkey.keys.leftAlt") },
        { value: "control", label: t("settings.hotkey.keys.control") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
);

const hotkeyKeyFeedback = useFeedbackMessage();
const hotkeyModeFeedback = useFeedbackMessage();
const hotkeyRecordingFeedback = useFeedbackMessage();

// ── 兩層模式切換 ──────────────────────────────────────────
const isCustomMode = ref(false);
const isRecording = ref(false);
const recordingWarning = ref("");
const recordingHint = ref("");
let recordingTimeoutId: ReturnType<typeof setTimeout> | undefined;

const RECORDING_TIMEOUT_MS = 10_000;

const currentCustomKeyDisplay = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (key && isComboTriggerKey(key)) {
    return settingsStore.getTriggerKeyDisplayName(key);
  }
  if (!settingsStore.customTriggerKeyDomCode) return "";
  return settingsStore.getKeyDisplayName(settingsStore.customTriggerKeyDomCode);
});

const hasCustomKey = computed(() => settingsStore.customTriggerKey !== null);

const currentPresetKey = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (!key || isCustomTriggerKey(key) || isComboTriggerKey(key)) return isMac ? "fn" : "rightAlt";
  return key;
});

let recordingUnlisteners: UnlistenFn[] = [];

async function handleRecordingCaptured(payload: RecordingCapturedPayload) {
  const { keycode, modifiers } = payload;
  recordingWarning.value = "";
  recordingHint.value = "";

  const currentMode = settingsStore.triggerMode;
  stopKeyRecording();

  const domCode = getDomCodeByKeycode(keycode);

  if (modifiers.length > 0) {
    // Combo key: modifier(s) + primary key
    if (domCode) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    const comboKey: ComboTriggerKey = {
      combo: { modifiers, keycode },
    };
    try {
      await settingsStore.saveComboTriggerKey(comboKey, domCode ?? "", currentMode);
      hotkeyRecordingFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: settingsStore.getTriggerKeyDisplayName(comboKey) }),
      );
    } catch (err) {
      hotkeyRecordingFeedback.show("error", extractErrorMessage(err));
    }
  } else {
    // Single key
    const isPresetEquivalent = domCode ? settingsStore.isPresetEquivalentKey(domCode) : false;

    if (domCode && !isPresetEquivalent) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    if (isPresetEquivalent) {
      recordingHint.value = settingsStore.getHotkeyPresetHint();
    }

    try {
      await settingsStore.saveCustomTriggerKey(keycode, domCode ?? "", currentMode);
      const displayName = domCode
        ? settingsStore.getKeyDisplayName(domCode)
        : getKeyDisplayNameByKeycode(keycode);
      hotkeyRecordingFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: displayName }),
      );
    } catch (err) {
      hotkeyRecordingFeedback.show("error", extractErrorMessage(err));
    }
  }
}

function handleRecordingRejected(payload: RecordingRejectedPayload) {
  stopKeyRecording();
  if (payload.reason === "esc_reserved") {
    hotkeyRecordingFeedback.show("error", settingsStore.getEscapeReservedMessage());
  }
}

async function startRecording() {
  isRecording.value = true;
  recordingWarning.value = "";
  recordingHint.value = "";

  // Tell Rust to enter recording mode
  try {
    await invoke("start_hotkey_recording");
  } catch (err) {
    hotkeyRecordingFeedback.show("error", extractErrorMessage(err));
    isRecording.value = false;
    return;
  }

  // Listen for Rust recording events
  const [unlistenCaptured, unlistenRejected] = await Promise.all([
    listenToEvent<RecordingCapturedPayload>(
      HOTKEY_RECORDING_CAPTURED,
      (event) => void handleRecordingCaptured(event.payload),
    ),
    listenToEvent<RecordingRejectedPayload>(
      HOTKEY_RECORDING_REJECTED,
      (event) => handleRecordingRejected(event.payload),
    ),
  ]);
  recordingUnlisteners = [unlistenCaptured, unlistenRejected];

  // 10s timeout
  recordingTimeoutId = setTimeout(() => {
    if (isRecording.value) {
      hotkeyRecordingFeedback.show("error", settingsStore.getHotkeyRecordingTimeoutMessage());
      stopKeyRecording();
    }
  }, RECORDING_TIMEOUT_MS);
}

function stopKeyRecording() {
  if (!isRecording.value) return;
  isRecording.value = false;
  clearTimeout(recordingTimeoutId);
  // Cancel Rust recording mode
  void invoke("cancel_hotkey_recording").catch(() => {});
  // Clean up event listeners
  for (const unlisten of recordingUnlisteners) {
    unlisten();
  }
  recordingUnlisteners = [];
}

function switchToCustom() {
  isCustomMode.value = true;
  if (hasCustomKey.value) {
    // Restore saved custom key as active
    settingsStore
      .switchToCustomMode(settingsStore.triggerMode)
      .catch((err: unknown) => {
        hotkeyRecordingFeedback.show("error", extractErrorMessage(err));
      });
  }
}

function switchToPreset() {
  isCustomMode.value = false;
  stopKeyRecording();
  recordingWarning.value = "";
  recordingHint.value = "";
  settingsStore
    .switchToPresetMode(currentPresetKey.value, settingsStore.triggerMode)
    .catch((err: unknown) => {
      hotkeyKeyFeedback.show("error", extractErrorMessage(err));
    });
}

async function handleTriggerKeyChange(newKey: PresetTriggerKey) {
  const currentMode = settingsStore.triggerMode;
  try {
    await settingsStore.saveHotkeyConfig(newKey, currentMode);
    hotkeyKeyFeedback.show("success", t("settings.hotkey.updated"));
  } catch (err) {
    hotkeyKeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleTriggerModeChange(newMode: TriggerMode) {
  const currentKey =
    settingsStore.hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
  try {
    await settingsStore.saveHotkeyConfig(currentKey, newMode);
    hotkeyModeFeedback.show("success", t("settings.hotkey.modeUpdated"));
  } catch (err) {
    hotkeyModeFeedback.show("error", extractErrorMessage(err));
  }
}

// ── API Key ─────────────────────────────────────────────────
const apiKeyInput = ref("");
const isApiKeyVisible = ref(false);
const isSubmittingApiKey = ref(false);
const apiKeyFeedback = useFeedbackMessage();

const isConfirmingDeleteApiKey = ref(false);
let deleteConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const promptInput = ref("");
const isSubmittingPrompt = ref(false);
const promptFeedback = useFeedbackMessage();
const selectedPromptMode = ref<PromptMode>("minimal");
const isPresetDirty = ref(false);

const isConfirmingResetPrompt = ref(false);

// Preset 模式下切語言時即時更新 textarea
watch(
  [() => settingsStore.selectedLocale, () => settingsStore.selectedTranscriptionLocale],
  () => {
    if (selectedPromptMode.value !== "custom" && !isPresetDirty.value) {
      promptInput.value = settingsStore.getAiPrompt();
    }
  },
);
let resetPromptConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const apiKeyStatusLabel = computed(() =>
  settingsStore.hasApiKey ? t("settings.apiKey.set") : t("settings.apiKey.notSet"),
);
const apiKeyStatusClass = computed(() =>
  settingsStore.hasApiKey
    ? "bg-success/20 text-success"
    : "bg-destructive/20 text-destructive",
);
const shouldShowOnboardingHint = computed(() => !settingsStore.hasApiKey);

function toggleApiKeyVisibility() {
  isApiKeyVisible.value = !isApiKeyVisible.value;
}

async function handleSaveApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.saveApiKey(apiKeyInput.value);
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

function requestDeleteApiKey() {
  if (!isConfirmingDeleteApiKey.value) {
    isConfirmingDeleteApiKey.value = true;
    deleteConfirmTimeoutId = setTimeout(() => {
      isConfirmingDeleteApiKey.value = false;
    }, 3000);
    return;
  }
  clearTimeout(deleteConfirmTimeoutId);
  isConfirmingDeleteApiKey.value = false;
  handleDeleteApiKey();
}

async function handleDeleteApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.deleteApiKey();
    apiKeyInput.value = "";
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

async function handleSavePrompt() {
  const wasModeSwitch = selectedPromptMode.value !== "custom" && isPresetDirty.value;
  const previousMode = selectedPromptMode.value;
  try {
    isSubmittingPrompt.value = true;
    // preset 模式下編輯 → 切到 custom
    if (wasModeSwitch) {
      await settingsStore.savePromptMode("custom");
      selectedPromptMode.value = "custom";
      isPresetDirty.value = false;
    }
    await settingsStore.saveAiPrompt(promptInput.value);
    promptFeedback.show("success", t("settings.prompt.saved"));
  } catch (err) {
    if (wasModeSwitch) {
      await settingsStore.savePromptMode(previousMode).catch(() => {});
      selectedPromptMode.value = previousMode;
    }
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

async function handlePromptModeChange(mode: unknown) {
  if (typeof mode !== "string" || !(PROMPT_MODE_VALUES as readonly string[]).includes(mode)) return;
  const newMode = mode as PromptMode;
  const previousMode = selectedPromptMode.value;
  selectedPromptMode.value = newMode;
  try {
    await settingsStore.savePromptMode(newMode);
    promptInput.value = settingsStore.getAiPrompt();
    isPresetDirty.value = false;
  } catch (err) {
    selectedPromptMode.value = previousMode;
    promptFeedback.show("error", extractErrorMessage(err));
  }
}

function handlePromptInput() {
  if (selectedPromptMode.value !== "custom" && !isPresetDirty.value) {
    isPresetDirty.value = true;
  }
}

function requestResetPrompt() {
  if (!isConfirmingResetPrompt.value) {
    isConfirmingResetPrompt.value = true;
    resetPromptConfirmTimeoutId = setTimeout(() => {
      isConfirmingResetPrompt.value = false;
    }, 3000);
    return;
  }
  clearTimeout(resetPromptConfirmTimeoutId);
  isConfirmingResetPrompt.value = false;
  handleResetPrompt();
}

async function handleResetPrompt() {
  try {
    isSubmittingPrompt.value = true;
    await settingsStore.resetAiPrompt();
    selectedPromptMode.value = "minimal";
    promptInput.value = settingsStore.getAiPrompt();
    isPresetDirty.value = false;
    promptFeedback.show("success", t("settings.prompt.resetDone"));
  } catch (err) {
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

// ── AI 整理門檻 ──────────────────────────────────────────────
const thresholdEnabled = ref(DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED);
const thresholdCharCount = ref(DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT);
const thresholdToggleFeedback = useFeedbackMessage();
const thresholdCharCountFeedback = useFeedbackMessage();

async function handleToggleEnhancementThreshold() {
  thresholdEnabled.value = !thresholdEnabled.value;
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    thresholdToggleFeedback.show(
      "success",
      thresholdEnabled.value ? t("settings.threshold.enabledFeedback") : t("settings.threshold.disabledFeedback"),
    );
  } catch (err) {
    thresholdEnabled.value = !thresholdEnabled.value;
    thresholdToggleFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveThresholdCharCount() {
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
    thresholdCharCountFeedback.show("success", t("settings.threshold.charCountSaved"));
  } catch (err) {
    thresholdCharCountFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 取代規則 ──────────────────────────────────────────────
type ReplacementFormState = {
  patternsText: string;
  replacement: string;
  isRegex: boolean;
  timing: ReplacementTiming;
  enabled: boolean;
};

const REPLACEMENT_TIMINGS: readonly ReplacementTiming[] = [
  "beforeAI",
  "afterAI",
  "both",
];

const replacementFormFeedback = useFeedbackMessage();
const replacementListFeedback = useFeedbackMessage();
const isSavingReplacementRule = ref(false);
const editingReplacementRuleId = ref<string | null>(null);
const replacementForm = ref<ReplacementFormState>({
  patternsText: "",
  replacement: "",
  isRegex: false,
  timing: "beforeAI",
  enabled: true,
});

const isEditingReplacementRule = computed(
  () => editingReplacementRuleId.value !== null,
);

const replacementTimingOptions = computed(() =>
  REPLACEMENT_TIMINGS.map((value) => ({
    value,
    label: t(`settings.replacements.timing.${value}`),
  })),
);

const {
  sortState: replacementSortState,
  toggleSort: toggleReplacementSort,
  sortedList: sortedReplacementRules,
} = useReplacementTableSort(
  () => replacementStore.rules,
  () => locale.value,
);

function replacementSortIconFor(key: ReplacementSortKey) {
  if (replacementSortState.value.key !== key) return ArrowUpDown;
  return replacementSortState.value.direction === "asc" ? ArrowUp : ArrowDown;
}

function replacementAriaSortFor(
  key: ReplacementSortKey,
): "ascending" | "descending" | "none" {
  if (replacementSortState.value.key !== key) return "none";
  return replacementSortState.value.direction === "asc"
    ? "ascending"
    : "descending";
}

/**
 * `createdAt` 是 ISO 8601 UTC（帶 `Z`），可直接 `new Date()` 解析，
 * 不像 SQLite 的 `created_at` 需要自行補 "Z"。
 */
function formatReplacementCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString(locale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isReplacementTiming(value: unknown): value is ReplacementTiming {
  return (
    typeof value === "string" &&
    REPLACEMENT_TIMINGS.includes(value as ReplacementTiming)
  );
}

function parseReplacementPatterns(input: string): string[] {
  return input
    .split(/\r?\n/u)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

function replacementErrorMessage(code?: string): string {
  if (!code) return t("settings.replacements.errors.unknown");
  const key = `settings.replacements.errors.${code}`;
  const message = t(key);
  return message === key ? t("settings.replacements.errors.unknown") : message;
}

function resetReplacementForm() {
  editingReplacementRuleId.value = null;
  replacementForm.value = {
    patternsText: "",
    replacement: "",
    isRegex: false,
    timing: "beforeAI",
    enabled: true,
  };
}

function startEditingReplacementRule(rule: ReplacementRule) {
  editingReplacementRuleId.value = rule.id;
  replacementForm.value = {
    patternsText: rule.patterns.join("\n"),
    replacement: rule.replacement,
    isRegex: rule.isRegex,
    timing: rule.timing,
    enabled: rule.enabled,
  };
}

function handleReplacementTimingChange(value: unknown) {
  if (!isReplacementTiming(value)) return;
  replacementForm.value.timing = value;
}

async function handleSubmitReplacementRule() {
  const patterns = parseReplacementPatterns(replacementForm.value.patternsText);
  const validation = replacementStore.validateRuleInput(
    patterns,
    replacementForm.value.replacement,
    replacementForm.value.isRegex,
  );
  if (!validation.valid) {
    replacementFormFeedback.show("error", replacementErrorMessage(validation.error));
    return;
  }

  try {
    isSavingReplacementRule.value = true;
    const input = {
      patterns,
      replacement: replacementForm.value.replacement,
      isRegex: replacementForm.value.isRegex,
      timing: replacementForm.value.timing,
      enabled: replacementForm.value.enabled,
    };
    const result = editingReplacementRuleId.value
      ? await replacementStore.updateRule(editingReplacementRuleId.value, input)
      : await replacementStore.addRule(input);

    if (!result.valid) {
      replacementFormFeedback.show("error", replacementErrorMessage(result.error));
      return;
    }

    replacementFormFeedback.show(
      "success",
      editingReplacementRuleId.value
        ? t("settings.replacements.updated")
        : t("settings.replacements.added"),
    );
    resetReplacementForm();
  } catch (err) {
    replacementFormFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSavingReplacementRule.value = false;
  }
}

async function handleToggleReplacementRule(rule: ReplacementRule, enabled: boolean) {
  const result = await replacementStore.updateRule(rule.id, { enabled });
  if (!result.valid) {
    replacementListFeedback.show("error", replacementErrorMessage(result.error));
  }
}

async function handleDeleteReplacementRule(rule: ReplacementRule) {
  try {
    const result = await replacementStore.removeRule(rule.id);
    if (!result.valid) {
      replacementListFeedback.show("error", replacementErrorMessage(result.error));
      return;
    }
    if (editingReplacementRuleId.value === rule.id) resetReplacementForm();
    replacementListFeedback.show("success", t("settings.replacements.deleted"));
  } catch (err) {
    replacementListFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 模型選擇 ──────────────────────────────────────────────
const whisperProviderFeedback = useFeedbackMessage();
const whisperModelFeedback = useFeedbackMessage();
const geminiTranscriptionModelFeedback = useFeedbackMessage();
const geminiQuotaFeedback = useFeedbackMessage();
const azureWhisperDeploymentFeedback = useFeedbackMessage();
const azureSpeechFeedback = useFeedbackMessage();
const maiOptionsFeedback = useFeedbackMessage();
const llmModelFeedback = useFeedbackMessage();

const whisperModelDescription = computed(() => {
  const config = findWhisperModelConfig(settingsStore.selectedWhisperModelId);
  if (!config) return "";
  const cost = t("settings.model.costPerHour", { cost: config.costPerHour });
  return `${t(config.descriptionKey)} · ${cost}`;
});

const llmModelDescription = computed(() => {
  const config = findLlmModelConfig(settingsStore.selectedLlmModelId);
  if (!config) return "";
  const tpsInfo = config.speedTps > 0 ? `${config.speedTps} TPS · ` : "";
  const cost = `${tpsInfo}$${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
  return `${t(config.descriptionKey)} · ${cost}`;
});

const providerModelList = computed(() =>
  getModelListByProvider(settingsStore.selectedLlmProviderId),
);

async function handleWhisperModelChange(newId: WhisperModelId) {
  try {
    await settingsStore.saveWhisperModel(newId);
    whisperModelFeedback.show("success", t("settings.model.whisperUpdated"));
  } catch (err) {
    whisperModelFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleLlmModelChange(newId: LlmModelId) {
  try {
    await settingsStore.saveLlmModel(newId);
    llmModelFeedback.show("success", t("settings.model.llmUpdated"));
  } catch (err) {
    llmModelFeedback.show("error", extractErrorMessage(err));
  }
}

// ── LLM Provider ────────────────────────────────────────────
const llmProviderFeedback = useFeedbackMessage();
const openaiApiKeyFeedback = useFeedbackMessage();
const anthropicApiKeyFeedback = useFeedbackMessage();
const geminiWhisperApiKeyFeedback = useFeedbackMessage();
const geminiLlmApiKeyFeedback = useFeedbackMessage();
const azureChatDeploymentFeedback = useFeedbackMessage();
const azureModelFamilyFeedback = useFeedbackMessage();
const azureOmitTemperatureFeedback = useFeedbackMessage();
const openaiApiKeyInput = ref("");
const anthropicApiKeyInput = ref("");
const geminiApiKeyInput = ref("");
const isOpenaiApiKeyVisible = ref(false);
const isAnthropicApiKeyVisible = ref(false);
const isGeminiApiKeyVisible = ref(false);

async function handleProviderChange(providerId: LlmProviderId) {
  try {
    await settingsStore.saveLlmProvider(providerId);
    llmProviderFeedback.show("success", t("settings.model.llmUpdated"));
  } catch (err) {
    llmProviderFeedback.show("error", extractErrorMessage(err));
  }
}

// ── Azure / Microsoft Foundry ───────────────────────────────
const azureLifecycleFeedback = useFeedbackMessage();
const azureConnectionFeedback = useFeedbackMessage();
const azureSignInFeedback = useFeedbackMessage();
const azureEnabledInput = ref(false);
const azureEndpointInput = ref("");
const azureAuthModeInput = ref<AzureAuthMode>("key");
const azureApiKeyInput = ref("");
const azureTenantIdInput = ref("");
const azureClientIdInput = ref("");
const azureClientSecretInput = ref("");
const azureApiVersionInput = ref("");
const isAzureApiKeyVisible = ref(false);
const isAzureClientSecretVisible = ref(false);
const isSubmittingAzure = ref(false);
const azureChatDeploymentInput = ref("");
const azureWhisperDeploymentInput = ref("");
const azureSpeechEndpointInput = ref("");
const azureSpeechApiKeyInput = ref("");
const isAzureSpeechApiKeyVisible = ref(false);
const isLoadingAzureDeployments = ref(false);
const azureDeploymentList = ref<AzureChatDeployment[]>([]);
const azureDeploymentListResult = ref<AzureDeploymentListResult | null>(null);
const isManualAzureChatDeploymentInputVisible = ref(false);
const hasAttemptedAzureAutoLoad = ref(false);
const azureChatModelFamilyConfig = computed(() =>
  findAzureChatModelFamilyConfig(settingsStore.azureChatModelFamily),
);
const azureDeploymentOptions = computed(() => {
  const savedDeployment = azureChatDeploymentInput.value.trim();
  if (
    savedDeployment === "" ||
    azureDeploymentList.value.some(
      (deployment) => deployment.name === savedDeployment,
    )
  ) {
    return azureDeploymentList.value;
  }

  return [
    {
      name: savedDeployment,
      source: "v1" as const,
    },
    ...azureDeploymentList.value,
  ];
});
const selectedAzureDeployment = computed(() =>
  azureDeploymentList.value.find(
    (deployment) => deployment.name === azureChatDeploymentInput.value,
  ),
);
const azureDetectedModelFamily = computed(() => {
  const deployment = selectedAzureDeployment.value;
  return deployment?.source === "foundry" && deployment.modelName
    ? resolveAzureFamilyFromDeployment(deployment)
    : null;
});
const azureModelFamilySuggestion = computed(() => {
  if (azureDetectedModelFamily.value) return null;
  const familyId = suggestAzureChatModelFamily(
    selectedAzureDeployment.value?.name ?? azureChatDeploymentInput.value,
  );
  if (!familyId) return null;
  return {
    familyId,
  };
});
const isStoredAzureDeploymentMissingFromList = computed(
  () =>
    azureDeploymentListResult.value !== null &&
    azureChatDeploymentInput.value.trim() !== "" &&
    selectedAzureDeployment.value === undefined,
);
const isAzureDetectedFamilyDifferent = computed(
  () =>
    azureDetectedModelFamily.value !== null &&
    azureDetectedModelFamily.value.familyId !==
      settingsStore.azureChatModelFamily,
);
const canAutoLoadAzureDeployments = computed(
  () =>
    settingsStore.selectedLlmProviderId === "azure" &&
    settingsStore.azureEnabled &&
    settingsStore.azureEndpoint !== "" &&
    settingsStore.hasAzureCredentials,
);

function loadAzureInputsFromStore() {
  azureEnabledInput.value = settingsStore.azureEnabled;
  azureEndpointInput.value = settingsStore.azureProjectName
    ? `${settingsStore.azureEndpoint}/api/projects/${encodeURIComponent(settingsStore.azureProjectName)}`
    : settingsStore.azureEndpoint;
  azureAuthModeInput.value = settingsStore.azureAuthMode;
  azureApiKeyInput.value = settingsStore.azureApiKey;
  azureTenantIdInput.value = settingsStore.azureTenantId;
  azureClientIdInput.value = settingsStore.azureClientId;
  azureClientSecretInput.value = settingsStore.azureClientSecret;
  azureApiVersionInput.value = settingsStore.azureApiVersion;
  azureChatDeploymentInput.value = settingsStore.azureChatDeployment;
  azureWhisperDeploymentInput.value = settingsStore.azureWhisperDeployment;
  azureSpeechEndpointInput.value = settingsStore.azureSpeechEndpoint;
  azureSpeechApiKeyInput.value = settingsStore.azureSpeechApiKey;
  // Gemini 免費額度：0 視為「未設定」，輸入框留空而非顯示 0
  geminiFreeQuotaInput.value =
    settingsStore.geminiFreeQuotaRequests > 0
      ? String(settingsStore.geminiFreeQuotaRequests)
      : "";
  geminiFreeQuotaPeriodInput.value = settingsStore.geminiFreeQuotaPeriod;
}

async function handleSaveAzureConnection() {
  try {
    isSubmittingAzure.value = true;
    await handleSaveAzureConnectionOrThrow();
    azureConnectionFeedback.show("success", t("settings.azure.saved"));
    hasAttemptedAzureAutoLoad.value = false;
    void tryAutoLoadAzureDeployments();
  } catch (err) {
    azureConnectionFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingAzure.value = false;
  }
}

/** 儲存連線設定但**不**吞錯——供需要「失敗就中止」的呼叫端使用（例如登入前置）。 */
async function handleSaveAzureConnectionOrThrow() {
  await settingsStore.saveAzureConnection({
    enabled: azureEnabledInput.value,
    endpoint: azureEndpointInput.value,
    authMode: azureAuthModeInput.value,
    apiKey: azureApiKeyInput.value,
    tenantId: azureTenantIdInput.value,
    clientId: azureClientIdInput.value,
    clientSecret: azureClientSecretInput.value,
    apiVersion: azureApiVersionInput.value,
  });
}

async function handleToggleAzureEnabled(value: boolean) {
  azureEnabledInput.value = value;
  try {
    isSubmittingAzure.value = true;
    await handleSaveAzureConnectionOrThrow();
    azureLifecycleFeedback.show("success", t("settings.azure.saved"));
    hasAttemptedAzureAutoLoad.value = false;
    void tryAutoLoadAzureDeployments();
  } catch (err) {
    azureLifecycleFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingAzure.value = false;
  }
}

async function handleDeleteAzureConnection() {
  try {
    isSubmittingAzure.value = true;
    await settingsStore.deleteAzureConnection();
    loadAzureInputsFromStore();
    azureLifecycleFeedback.show("success", t("settings.azure.deleted"));
  } catch (err) {
    azureLifecycleFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingAzure.value = false;
  }
}

// ── Entra 使用者登入 ────────────────────────────────────────
const isAzureSigningIn = ref(false);

/**
 * 登入前先把連線設定落地，再開瀏覽器登入。
 *
 * 順序刻意是「先存後登入」：若反過來，儲存失敗時登入已經成功，UI 會顯示
 * 已登入但持久化的 endpoint/deployment 其實沒寫進去，狀態不一致。先存的話
 * 任一步失敗都只會停在「設定已存、尚未登入」這個一致且可重試的狀態。
 */
async function handleAzureUserSignIn() {
  // 在第一個 await 之前定格：等待瀏覽器登入期間輸入框仍可編輯，
  // 若之後再讀一次，就會用「設定 A」的 endpoint 去配「身分 B」的 token。
  const tenantId = azureTenantIdInput.value;
  const clientId = azureClientIdInput.value;
  try {
    isAzureSigningIn.value = true;
    await handleSaveAzureConnectionOrThrow();
    azureSignInFeedback.show("success", t("settings.azure.signInWaiting"));
    const account = await settingsStore.signInAzureUserAccount({
      tenantId,
      clientId,
    });
    azureSignInFeedback.show(
      "success",
      t("settings.azure.signInSuccess", {
        account: account.username ?? account.name ?? "",
      }),
    );
  } catch (err) {
    const message = extractErrorMessage(err);
    if (isSignInCancelledError(message)) {
      azureSignInFeedback.show("error", t("settings.azure.signInCancelled"));
    } else if (isPolicyDeniedError(message)) {
      // 保留 AADSTS 原文：使用者需要它去跟 IT 說明是哪條政策擋下的
      azureSignInFeedback.show(
        "error",
        `${t("settings.azure.signInPolicyDenied")} ${message}`,
        { persistent: true },
      );
    } else {
      // 訊息固定的錯誤翻成使用者看得懂的說明；其餘（含帶 AADSTS 說明的）
      // 保留原文，那才是使用者拿去找 IT 的依據。
      const key = findSignInErrorKey(message);
      azureSignInFeedback.show("error", key === null ? message : t(key), {
        persistent: key === null,
      });
    }
  } finally {
    isAzureSigningIn.value = false;
  }
}

async function handleAzureUserCancelSignIn() {
  try {
    await settingsStore.cancelAzureUserSignInFlow();
  } catch (err) {
    azureSignInFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleAzureUserSignOut() {
  try {
    isSubmittingAzure.value = true;
    await settingsStore.signOutAzureUserAccount();
    azureSignInFeedback.show("success", t("settings.azure.signOutSuccess"));
  } catch (err) {
    azureSignInFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingAzure.value = false;
  }
}

const azureSignedInLabel = computed(() => {
  const account = settingsStore.azureUserAccount;
  if (!account) return "";
  return account.username ?? account.name ?? "";
});

/**
 * 「已登入」區塊只在輸入框與已登入帳號一致時顯示。
 * 否則使用者改了 Tenant/Client ID 之後，畫面仍顯示上一組帳號的「已登入」，
 * 而登入按鈕被藏起來，會誤以為新的設定已經生效。
 */
const isSignedInForCurrentInput = computed(() =>
  settingsStore.matchesSignedInAccount(
    azureTenantIdInput.value,
    azureClientIdInput.value,
  ),
);

async function handleSaveAzureChatDeployment() {
  try {
    await settingsStore.saveAzureChatDeployment(azureChatDeploymentInput.value);
    azureChatDeploymentFeedback.show("success", t("settings.azure.deploymentSaved"));
  } catch (err) {
    azureChatDeploymentFeedback.show("error", extractErrorMessage(err));
  }
}

async function loadAzureDeployments({
  saveConnection,
  showFeedback,
}: {
  saveConnection: boolean;
  showFeedback: boolean;
}) {
  try {
    isLoadingAzureDeployments.value = true;
    if (saveConnection) {
      await handleSaveAzureConnectionOrThrow();
    }
    const result = await settingsStore.listAzureChatDeployments();
    azureDeploymentList.value = result.deploymentList;
    azureDeploymentListResult.value = result;
    if (showFeedback) {
      azureChatDeploymentFeedback.show(
        "success",
        result.deploymentList.length === 0
          ? t("settings.azure.deploymentListEmpty")
          : t("settings.azure.deploymentListLoaded", {
              count: result.deploymentList.length,
            }),
      );
    }
  } catch (err) {
    if (showFeedback) {
      azureDeploymentList.value = [];
      azureDeploymentListResult.value = null;
      azureChatDeploymentFeedback.show("error", extractErrorMessage(err));
    } else {
      console.warn(
        "[SettingsView] automatic Azure deployment load failed:",
        extractErrorMessage(err),
      );
    }
  } finally {
    isLoadingAzureDeployments.value = false;
  }
}

async function handleLoadAzureDeployments() {
  await loadAzureDeployments({ saveConnection: true, showFeedback: true });
}

async function tryAutoLoadAzureDeployments() {
  if (
    hasAttemptedAzureAutoLoad.value ||
    isLoadingAzureDeployments.value ||
    !canAutoLoadAzureDeployments.value
  ) {
    return;
  }

  hasAttemptedAzureAutoLoad.value = true;
  await loadAzureDeployments({ saveConnection: false, showFeedback: false });
}

async function handleAzureDeploymentSelection(name: string) {
  const previousDeployment = azureChatDeploymentInput.value;
  azureChatDeploymentInput.value = name;
  try {
    const deployment = azureDeploymentList.value.find(
      (item) => item.name === name,
    );
    if (deployment?.source === "foundry" && deployment.modelName) {
      const resolution = resolveAzureFamilyFromDeployment(deployment);
      await settingsStore.saveAzureChatDeploymentSelection({
        deployment: name,
        modelFamily: resolution.familyId,
        familySource: "auto",
      });
    } else {
      await settingsStore.saveAzureChatDeployment(name);
    }
    azureChatDeploymentFeedback.show("success", t("settings.azure.deploymentSaved"));
  } catch (err) {
    azureChatDeploymentInput.value = previousDeployment;
    azureChatDeploymentFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleAzureChatModelFamilyChange(
  modelFamily: AzureChatModelFamilyId,
) {
  try {
    await settingsStore.saveAzureChatModelFamily(modelFamily);
    azureModelFamilyFeedback.show("success", t("settings.azure.deploymentSaved"));
  } catch (err) {
    azureModelFamilyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleRestoreAzureModelFamilyAuto() {
  const resolution = azureDetectedModelFamily.value;
  if (!resolution) return;
  try {
    await settingsStore.saveAzureChatDeploymentSelection({
      deployment: azureChatDeploymentInput.value,
      modelFamily: resolution.familyId,
      familySource: "auto",
    });
    azureModelFamilyFeedback.show("success", t("settings.azure.deploymentSaved"));
  } catch (err) {
    azureModelFamilyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleToggleAzureOmitTemperature(newValue: boolean) {
  try {
    await settingsStore.saveAzureOmitTemperature(newValue);
    azureOmitTemperatureFeedback.show(
      "success",
      newValue
        ? t("settings.azure.omitTemperatureEnabled")
        : t("settings.azure.omitTemperatureDisabled"),
    );
  } catch (err) {
    azureOmitTemperatureFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveAzureWhisperDeployment() {
  try {
    await settingsStore.saveAzureWhisperDeployment(
      azureWhisperDeploymentInput.value,
    );
    azureWhisperDeploymentFeedback.show("success", t("settings.azure.deploymentSaved"));
  } catch (err) {
    azureWhisperDeploymentFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveAzureSpeechConnection() {
  try {
    await settingsStore.saveAzureSpeechConnection(
      azureSpeechEndpointInput.value,
      azureSpeechApiKeyInput.value,
    );
    azureSpeechFeedback.show("success", t("settings.azure.speechSaved"));
  } catch (err) {
    azureSpeechFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleMaiInputLocaleChange(value: string) {
  try {
    await settingsStore.saveMaiCandidateLocales(
      value === "auto" ? [] : [value as MaiCandidateLocale],
    );
  } catch (err) {
    maiOptionsFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleMaiTranscribeStyleChange(style: MaiTranscribeStyle) {
  try {
    await settingsStore.saveMaiTranscribeStyle(style);
    maiOptionsFeedback.show("success", t("settings.model.whisperUpdated"));
  } catch (err) {
    maiOptionsFeedback.show("error", extractErrorMessage(err));
  }
}

// 當 Azure 測試連線按鈕被禁用時，回報缺少的設定項（不會是空字串才顯示）。
function azureConnectionIssue(deployment: string): string {
  if (!settingsStore.azureEnabled) return t("settings.azure.issueNotEnabled");
  if (settingsStore.azureEndpoint === "")
    return t("settings.azure.issueEndpoint");
  if (settingsStore.azureAuthMode === "entraUser") {
    if (!settingsStore.isAzureUserSignedIn)
      return t("settings.azure.issueNotSignedIn");
  } else if (settingsStore.azureAuthMode === "entra") {
    if (
      settingsStore.azureTenantId === "" ||
      settingsStore.azureClientId === "" ||
      settingsStore.azureClientSecret === ""
    )
      return t("settings.azure.issueCredentials");
  } else if (settingsStore.azureApiKey === "") {
    return t("settings.azure.issueApiKey");
  }
  if (deployment.trim() === "") return t("settings.azure.issueDeployment");
  return "";
}

async function handleWhisperProviderChange(id: TranscriptionProviderId) {
  try {
    await settingsStore.saveWhisperProvider(id);
    whisperProviderFeedback.show("success", t("settings.model.whisperUpdated"));
  } catch (err) {
    whisperProviderFeedback.show("error", extractErrorMessage(err));
  }
}

const geminiTranscriptionModelDescription = computed(() => {
  const config = findGeminiTranscriptionModelConfig(
    settingsStore.geminiTranscriptionModelId,
  );
  if (!config) return "";
  return t(config.descriptionKey);
});

async function handleGeminiTranscriptionModelChange(
  id: GeminiTranscriptionModelId,
) {
  try {
    await settingsStore.saveGeminiTranscriptionModel(id);
    geminiTranscriptionModelFeedback.show("success", t("settings.model.whisperUpdated"));
  } catch (err) {
    geminiTranscriptionModelFeedback.show("error", extractErrorMessage(err));
  }
}

const geminiFreeQuotaInput = ref("");

/** 未填時的提示：顯示目前模型的內建預設額度 */
const geminiQuotaPlaceholder = computed(() => {
  const config = findGeminiTranscriptionModelConfig(
    settingsStore.geminiTranscriptionModelId,
  );
  return t("settings.model.geminiQuotaPlaceholder", {
    count: config?.typicalFreeRpd ?? 0,
  });
});
const geminiFreeQuotaPeriodInput = ref<QuotaPeriod>("daily");

async function handleSaveGeminiFreeQuota() {
  try {
    const parsed = Number(geminiFreeQuotaInput.value);
    await settingsStore.saveGeminiFreeQuota(
      Number.isFinite(parsed) ? parsed : 0,
      geminiFreeQuotaPeriodInput.value,
    );
    geminiQuotaFeedback.show("success", t("settings.model.geminiQuotaSaved"));
  } catch (err) {
    geminiQuotaFeedback.show("error", extractErrorMessage(err));
  }
}

async function testGeminiWhisperConnection() {  try {
    const cfg = await settingsStore.getWhisperRequestConfig();
    return await testWhisperConnection(cfg.modelId, cfg.apiKey, {
      provider: cfg.provider,
    });
  } catch (err) {
    return {
      ok: false as const,
      durationMs: 0,
      errorMessage: extractErrorMessage(err),
    };
  }
}

async function testAzureChatConnection() {
  try {
    const cfg = await settingsStore.getLlmRequestConfig();
    return await testLlmConnection(cfg.modelId, cfg.apiKey, {
      provider: cfg.provider,
      azure: cfg.azure,
    });
  } catch (err) {
    return {
      ok: false as const,
      durationMs: 0,
      errorMessage: extractErrorMessage(err),
    };
  }
}

async function testAzureWhisperConnection() {
  try {
    const cfg = await settingsStore.getWhisperRequestConfig();
    return await testWhisperConnection(
      settingsStore.selectedWhisperModelId,
      cfg.apiKey,
      {
        provider: cfg.provider,
        endpoint: cfg.endpoint,
        deployment: cfg.deployment,
        apiVersion: cfg.apiVersion,
        authMode: cfg.authMode,
      },
    );
  } catch (err) {
    return {
      ok: false as const,
      durationMs: 0,
      errorMessage: extractErrorMessage(err),
    };
  }
}

async function testMaiConnection() {
  try {
    const cfg = await settingsStore.getWhisperRequestConfig();
    if (cfg.provider !== "mai") {
      throw new Error("MAI_TRANSCRIPTION_CONFIG_UNAVAILABLE");
    }
    return await testWhisperConnection(cfg.modelId, cfg.apiKey, {
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      authMode: cfg.authMode,
      candidateLocales: cfg.candidateLocales,
      transcribeStyle: cfg.transcribeStyle,
    });
  } catch (err) {
    return {
      ok: false as const,
      durationMs: 0,
      errorMessage: extractErrorMessage(err),
    };
  }
}

async function handleSaveOpenaiApiKey() {
  try {
    await settingsStore.saveOpenaiApiKey(openaiApiKeyInput.value);
    openaiApiKeyInput.value = "";
    openaiApiKeyFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    openaiApiKeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteOpenaiApiKey() {
  try {
    await settingsStore.deleteOpenaiApiKey();
    openaiApiKeyFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    openaiApiKeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveAnthropicApiKey() {
  try {
    await settingsStore.saveAnthropicApiKey(anthropicApiKeyInput.value);
    anthropicApiKeyInput.value = "";
    anthropicApiKeyFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    anthropicApiKeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteAnthropicApiKey() {
  try {
    await settingsStore.deleteAnthropicApiKey();
    anthropicApiKeyFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    anthropicApiKeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveGeminiApiKey(scope: "whisper" | "llm") {
  const feedback =
    scope === "whisper" ? geminiWhisperApiKeyFeedback : geminiLlmApiKeyFeedback;
  try {
    await settingsStore.saveGeminiApiKey(geminiApiKeyInput.value);
    geminiApiKeyInput.value = "";
    feedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteGeminiApiKey(scope: "whisper" | "llm") {
  const feedback =
    scope === "whisper" ? geminiWhisperApiKeyFeedback : geminiLlmApiKeyFeedback;
  try {
    await settingsStore.deleteGeminiApiKey();
    feedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  }
}

// ── 錄音自動靜音 ──────────────────────────────────────────────
const muteOnRecordingFeedback = useFeedbackMessage();

async function handleToggleMuteOnRecording(newValue: boolean) {
  try {
    await settingsStore.saveMuteOnRecording(newValue);
    muteOnRecordingFeedback.show(
      "success",
      newValue ? t("settings.app.muteEnabled") : t("settings.app.muteDisabled"),
    );
  } catch (err) {
    muteOnRecordingFeedback.show("error", extractErrorMessage(err));
  }
}

const soundFeedbackFeedback = useFeedbackMessage();

async function handleToggleSoundFeedback(newValue: boolean) {
  try {
    await settingsStore.saveSoundEffectsEnabled(newValue);
    soundFeedbackFeedback.show(
      "success",
      newValue
        ? t("settings.app.soundFeedbackEnabled")
        : t("settings.app.soundFeedbackDisabled"),
    );
  } catch (err) {
    soundFeedbackFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 隱藏 Dock 圖示 (gh-56，僅 macOS) ──────────────────────────
const hideDockIconFeedback = useFeedbackMessage();
// macOS 對「Dock 顯示後 1 秒內的隱藏請求」會靜默忽略（Tao 防重複圖示守衛），
// 切換後短暫鎖住開關，避免快速連按造成 UI 與實際 Dock 狀態脫節
const isHideDockIconPending = ref(false);
let hideDockIconPendingTimeoutId: ReturnType<typeof setTimeout> | undefined;

async function handleToggleHideDockIcon(newValue: boolean) {
  isHideDockIconPending.value = true;
  try {
    await settingsStore.saveHideDockIcon(newValue);
    hideDockIconFeedback.show(
      "success",
      newValue
        ? t("settings.app.hideDockIconEnabled")
        : t("settings.app.hideDockIconDisabled"),
    );
  } catch (err) {
    hideDockIconFeedback.show("error", extractErrorMessage(err));
  } finally {
    hideDockIconPendingTimeoutId = setTimeout(() => {
      isHideDockIconPending.value = false;
    }, 1200);
  }
}

// ── 轉錄文字是否複製到剪貼簿 (gh-35) ──────────────────────────
const copyTranscriptionToClipboardFeedback = useFeedbackMessage();

async function handleToggleCopyTranscriptionToClipboard(newValue: boolean) {
  try {
    await settingsStore.saveCopyTranscriptionToClipboard(newValue);
    copyTranscriptionToClipboardFeedback.show(
      "success",
      newValue
        ? t("settings.app.copyTranscriptionToClipboard.enabled")
        : t("settings.app.copyTranscriptionToClipboard.disabled"),
    );
  } catch (err) {
    copyTranscriptionToClipboardFeedback.show(
      "error",
      extractErrorMessage(err),
    );
  }
}

// ── 介面語言 ──────────────────────────────────────────────
const localeFeedback = useFeedbackMessage();

// ── 佈景主題 ──────────────────────────────────────────────
const themeFeedback = useFeedbackMessage();

async function handleThemeChange(mode: ThemeMode) {
  try {
    await settingsStore.saveTheme(mode);
    themeFeedback.show("success", t("settings.app.themeUpdated"));
  } catch (err) {
    themeFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleLocaleChange(newLocale: SupportedLocale) {
  try {
    await settingsStore.saveLocale(newLocale);
    localeFeedback.show("success", t("settings.app.languageUpdated"));
  } catch (err) {
    localeFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 轉錄語言 ──────────────────────────────────────────────
const transcriptionLocaleFeedback = useFeedbackMessage();

async function handleTranscriptionLocaleChange(newLocale: TranscriptionLocale) {
  try {
    await settingsStore.saveTranscriptionLocale(newLocale);
    transcriptionLocaleFeedback.show("success", t("settings.app.transcriptionLanguageUpdated"));
  } catch (err) {
    transcriptionLocaleFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 智慧字典學習 ────────────────────────────────────────────
const smartDictionaryFeedback = useFeedbackMessage();

async function handleToggleSmartDictionary(newValue: boolean) {
  try {
    await settingsStore.saveSmartDictionaryEnabled(newValue);
    smartDictionaryFeedback.show("success", t("common.save"));
  } catch (err) {
    smartDictionaryFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 情境注入 ────────────────────────────────────────────────
const contextInjectionFeedback = useFeedbackMessage();

async function handleToggleContextInjection(newValue: boolean) {
  try {
    await settingsStore.saveContextInjectionEnabled(newValue);
    contextInjectionFeedback.show("success", t("common.save"));
  } catch (err) {
    contextInjectionFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 錄音儲存管理 ──────────────────────────────────────────
const recordingAutoCleanupFeedback = useFeedbackMessage();
const recordingCleanupDaysFeedback = useFeedbackMessage();
const recordingDeleteFeedback = useFeedbackMessage();
const recordingAutoCleanupEnabled = ref(false);
const recordingAutoCleanupDays = ref(7);
const isDeletingRecordings = ref(false);

async function handleToggleRecordingAutoCleanup() {
  recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingAutoCleanupFeedback.show(
      "success",
      recordingAutoCleanupEnabled.value
        ? t("settings.recording.autoCleanupEnabled")
        : t("settings.recording.autoCleanupDisabled"),
    );
  } catch (err) {
    recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
    recordingAutoCleanupFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveCleanupDays() {
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
    recordingCleanupDaysFeedback.show("success", t("settings.recording.daysSaved"));
  } catch (err) {
    recordingCleanupDaysFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteAllRecordings() {
  try {
    isDeletingRecordings.value = true;
    const deletedCount = await historyStore.deleteAllRecordingFiles();

    recordingDeleteFeedback.show(
      "success",
      t("settings.recording.deleteSuccess", { count: deletedCount }),
    );
  } catch (err) {
    recordingDeleteFeedback.show("error", extractErrorMessage(err));
  } finally {
    isDeletingRecordings.value = false;
  }
}

// ── 進階：除錯記錄（Debug Log）────────────────────────────────
const debugLogToggleFeedback = useFeedbackMessage();
const debugLogDaysFeedback = useFeedbackMessage();
const debugLogFolderFeedback = useFeedbackMessage();
const debugLogEnabled = ref(false);
const debugLogRetentionDays = ref(7);

async function handleToggleDebugLog() {
  debugLogEnabled.value = !debugLogEnabled.value;
  try {
    await settingsStore.saveDebugLog(
      debugLogEnabled.value,
      debugLogRetentionDays.value,
    );
    debugLogToggleFeedback.show(
      "success",
      debugLogEnabled.value
        ? t("settings.debugLog.enabledMessage")
        : t("settings.debugLog.disabledMessage"),
    );
  } catch (err) {
    debugLogEnabled.value = !debugLogEnabled.value;
    debugLogToggleFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveDebugLogDays() {
  try {
    await settingsStore.saveDebugLog(
      debugLogEnabled.value,
      debugLogRetentionDays.value,
    );
    debugLogRetentionDays.value = settingsStore.debugLogRetentionDays;
    debugLogDaysFeedback.show("success", t("settings.debugLog.daysSaved"));
  } catch (err) {
    debugLogDaysFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleOpenLogFolder() {
  try {
    await openLogFolder();
  } catch (err) {
    debugLogFolderFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 應用程式 ────────────────────────────────────────────────
const autoStartFeedback = useFeedbackMessage();
const isTogglingAutoStart = ref(false);

async function handleToggleAutoStart() {
  try {
    isTogglingAutoStart.value = true;
    await settingsStore.toggleAutoStart();
    autoStartFeedback.show(
      "success",
      settingsStore.isAutoStartEnabled ? t("settings.app.autoStartEnabled") : t("settings.app.autoStartDisabled"),
    );
  } catch (err) {
    autoStartFeedback.show("error", extractErrorMessage(err));
  } finally {
    isTogglingAutoStart.value = false;
  }
}

// ── 輸入裝置 ──────────────────────────────────────────────
const audioInputDeviceList = ref<AudioInputDeviceInfo[]>([]);
const defaultInputDeviceName = ref<string | null>(null);
const isRefreshingDeviceList = ref(false);
const audioInputFeedback = useFeedbackMessage();
const { previewLevel, isPreviewActive, startPreview, stopPreview } =
  useAudioPreview();

async function loadAudioInputDeviceList() {
  try {
    audioInputDeviceList.value =
      await invoke<AudioInputDeviceInfo[]>("list_audio_input_devices");
    defaultInputDeviceName.value =
      await invoke<string | null>("get_default_input_device_name");
  } catch (err) {
    console.error(
      "[SettingsView] Failed to list audio input devices:",
      extractErrorMessage(err),
    );
  }
}

async function handleRefreshAudioInputDeviceList() {
  isRefreshingDeviceList.value = true;
  try {
    await loadAudioInputDeviceList();
    audioInputFeedback.show(
      "success",
      t("settings.audioInput.refreshed", {
        count: audioInputDeviceList.value.length,
      }),
    );
    void startPreview(settingsStore.selectedAudioInputDeviceName);
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  } finally {
    isRefreshingDeviceList.value = false;
  }
}

async function handleAudioInputDeviceChange(deviceName: string) {
  try {
    await settingsStore.saveAudioInputDevice(deviceName);
    audioInputFeedback.show("success", t("settings.audioInput.updated"));
    void startPreview(deviceName);
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 備份與還原（匯出／匯入完整設定）────────────────────────
const backupExportFeedback = useFeedbackMessage();
const backupImportFeedback = useFeedbackMessage();
const backupDictionaryImportFeedback = useFeedbackMessage();

const exportSettingsSelected = ref(true);
const exportDictionarySelected = ref(true);
const excludeKeysSelected = ref(false);
const encryptEnabled = ref(false);
const exportPassword = ref("");
const exportPasswordConfirm = ref("");
const isExporting = ref(false);
const isImporting = ref(false);
const isDictionaryImporting = ref(false);
const parsedBackup = ref<BackupFile | null>(null);
const importSettingsSelected = ref(false);
const importDictionarySelected = ref(false);
const importPassword = ref("");

const exportPasswordMismatch = computed(
  () =>
    encryptEnabled.value &&
    exportPasswordConfirm.value !== "" &&
    exportPassword.value !== exportPasswordConfirm.value,
);

// 明文（未加密）且包含設定金鑰時，顯示外洩警告
const showPlaintextKeyWarning = computed(
  () =>
    exportSettingsSelected.value &&
    !excludeKeysSelected.value &&
    !encryptEnabled.value,
);

const canExport = computed(() => {
  if (!exportSettingsSelected.value && !exportDictionarySelected.value) {
    return false;
  }
  if (encryptEnabled.value) {
    if (exportPassword.value === "") return false;
    if (exportPassword.value !== exportPasswordConfirm.value) return false;
  }
  return true;
});

const importedIsEncrypted = computed(
  () => parsedBackup.value?.encryption != null,
);
const importHasSettings = computed(
  () => parsedBackup.value?.contents.settings === true,
);
const importHasDictionary = computed(
  () => parsedBackup.value?.contents.dictionary === true,
);

const canApplyImport = computed(() => {
  if (!parsedBackup.value) return false;
  const anySelected =
    (importHasSettings.value && importSettingsSelected.value) ||
    (importHasDictionary.value && importDictionarySelected.value);
  if (!anySelected) return false;
  if (importedIsEncrypted.value && importPassword.value === "") return false;
  return true;
});

function resyncLocalInputsFromStore() {
  selectedPromptMode.value = settingsStore.promptMode;
  promptInput.value = settingsStore.getAiPrompt();
  isPresetDirty.value = false;
  apiKeyInput.value = settingsStore.hasApiKey
    ? settingsStore.getApiKey()
    : "";
  loadAzureInputsFromStore();
  thresholdEnabled.value = settingsStore.isEnhancementThresholdEnabled;
  thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
  recordingAutoCleanupEnabled.value =
    settingsStore.isRecordingAutoCleanupEnabled;
  recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
  debugLogEnabled.value = settingsStore.isDebugLogEnabled;
  debugLogRetentionDays.value = settingsStore.debugLogRetentionDays;
  const currentKey = settingsStore.hotkeyConfig?.triggerKey;
  isCustomMode.value = !!(
    currentKey &&
    (isCustomTriggerKey(currentKey) || isComboTriggerKey(currentKey))
  );
}

function getBackupErrorMessage(
  code: string,
  operation: "import" | "export" = "import",
): string {
  switch (code) {
    case "INVALID_JSON":
    case "INVALID_FORMAT":
      return t("settings.backup.errorInvalidFile");
    case "UNSUPPORTED_VERSION":
      return t("settings.backup.errorUnsupportedVersion");
    case "CORRUPT_FILE":
      return t("settings.backup.errorCorruptFile");
    case "DECRYPT_FAILED":
      return t("settings.backup.errorDecryptFailed");
    case "PASSWORD_REQUIRED":
      return t("settings.backup.errorPasswordRequired");
    case "CRYPTO_UNAVAILABLE":
      return t("settings.backup.errorCryptoUnavailable");
    case "REPLACEMENTS_LOAD_FAILED":
      return t("settings.backup.errorReplacementsLoadFailed");
    default:
      return t(
        operation === "export"
          ? "settings.backup.errorExportFailed"
          : "settings.backup.errorImportFailed",
      );
  }
}

async function handleBackupExport() {
  if (isExporting.value || !canExport.value) return;
  try {
    isExporting.value = true;
    const settings = exportSettingsSelected.value
      ? await settingsStore.exportSettings(excludeKeysSelected.value)
      : null;
    const iso = new Date().toISOString();
    const dictionary = exportDictionarySelected.value
      ? buildExportFile(await vocabularyStore.exportEntries(), iso)
      : null;
    // 文字取代規則屬設定類（存於 replacements.json）→ 隨「設定」一起備份
    const replacements = exportSettingsSelected.value
      ? await replacementStore.exportRules()
      : null;

    let file = buildBackupFile({
      settings,
      dictionary,
      replacements,
      appVersion: __APP_VERSION__,
      exportedAt: iso,
    });
    if (encryptEnabled.value) {
      file = await encryptBackup(file, exportPassword.value);
    }
    const path = await save({
      defaultPath: buildBackupFilename(new Date()),
      filters: [{ name: "SayIt Backup", extensions: ["json"] }],
    });
    if (!path) return;
    await invoke("save_text_file", { path, content: serializeBackup(file) });
    backupExportFeedback.show("success", t("settings.backup.exportSuccess"));
    exportPassword.value = "";
    exportPasswordConfirm.value = "";
  } catch (err) {
    backupExportFeedback.show(
      "error",
      getBackupErrorMessage(extractErrorMessage(err), "export"),
    );
    captureError(err, { source: "settings-backup-export" });
  } finally {
    isExporting.value = false;
  }
}

async function triggerBackupImport() {
  try {
    const path = await open({
      multiple: false,
      filters: [{ name: "SayIt Backup", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    parsedBackup.value = null;
    importPassword.value = "";
    const content = await invoke<string>("read_text_file", { path });
    const parsed = parseBackup(content);
    parsedBackup.value = parsed;
    importSettingsSelected.value = parsed.contents.settings;
    importDictionarySelected.value = parsed.contents.dictionary;
  } catch (err) {
    const code = extractErrorMessage(err);
    backupImportFeedback.show(
      "error",
      code === "FILE_TOO_LARGE"
        ? t("settings.backup.errorTooLarge")
        : getBackupErrorMessage(code),
    );
    captureError(err, { source: "settings-backup-parse" });
  }
}

async function handleExternalDictionaryImport() {
  if (isDictionaryImporting.value) return;
  isDictionaryImporting.value = true;
  try {
    const path = await open({
      multiple: false,
      filters: [
        { name: "Dictionary / Wordlist", extensions: ["json", "txt", "csv"] },
      ],
    });
    if (typeof path !== "string") return;
    const content = await invoke<string>("read_text_file", { path });
    const entries = parseImportContent(path, content);
    if (entries.length === 0) {
      backupDictionaryImportFeedback.show("error", t("settings.backup.dictImportEmpty"));
      return;
    }
    const result = await vocabularyStore.importEntries(entries);
    backupDictionaryImportFeedback.show(
      "success",
      t("settings.backup.dictImportSuccess", {
        added: result.added,
        merged: result.merged,
        skipped: result.skipped,
      }),
    );
  } catch (err) {
    const code = extractErrorMessage(err);
    const msg =
      code === "FILE_TOO_LARGE"
        ? t("settings.backup.dictImportTooLarge")
        : code === "INVALID_JSON" ||
            code === "INVALID_FORMAT" ||
            code.includes("Invalid UTF-8")
          ? t("settings.backup.dictImportInvalid")
          : t("settings.backup.dictImportFailed");
    backupDictionaryImportFeedback.show("error", msg);
    captureError(err, { source: "settings-dictionary-import" });
  } finally {
    isDictionaryImporting.value = false;
  }
}

async function applyBackupImport() {
  if (
    isImporting.value ||
    isRecording.value ||
    !parsedBackup.value ||
    !canApplyImport.value
  )
    return;
  try {
    isImporting.value = true;
    const payload = await getBackupPayload(
      parsedBackup.value,
      importedIsEncrypted.value ? importPassword.value : undefined,
    );

    // 預檢：在寫入任何設定前，先驗證所有選定的區塊，避免 half-applied 狀態
    const willImportSettings = importSettingsSelected.value && !!payload.settings;
    const willImportDictionary =
      importDictionarySelected.value && !!payload.dictionary;
    if (willImportDictionary && !isSupportedDictionaryBlock(payload.dictionary)) {
      throw new Error("UNSUPPORTED_VERSION");
    }
    const cleanSettings = willImportSettings
      ? sanitizeSettingsPayload(payload.settings as Record<string, unknown>)
      : null;

    const deviceBeforeImport = settingsStore.selectedAudioInputDeviceName;
    let settingsApplied = false;
    let replacementsFailed = false;
    let dictionaryResult: {
      added: number;
      merged: number;
      skipped: number;
    } | null = null;

    if (cleanSettings) {
      await settingsStore.importSettings(cleanSettings);
      resyncLocalInputsFromStore();
      settingsApplied = true;
      // 取代規則隨設定一起還原（舊備份沒有此區塊 → 維持現有規則不動）
      if (payload.replacements) {
        const replacementsResult = await replacementStore.importRules(
          payload.replacements,
        );
        // 不 throw：設定確實已套用，統一報「匯入失敗」會誤導使用者以為什麼都沒變。
        // 改為分項回報，讓使用者知道要重試哪一部分。
        if (!replacementsResult.valid) {
          replacementsFailed = true;
          captureError(
            new Error(replacementsResult.error ?? "unknown"),
            { source: "settings-backup-import-replacements" },
          );
        }
      }
      // 音訊裝置若有變更，重啟預覽以對齊新裝置
      if (
        settingsStore.selectedAudioInputDeviceName !== deviceBeforeImport
      ) {
        await stopPreview();
        void startPreview(settingsStore.selectedAudioInputDeviceName);
      }
    }
    if (willImportDictionary && payload.dictionary) {
      dictionaryResult = await vocabularyStore.importEntries(
        payload.dictionary.terms,
      );
    }

    const parts: string[] = [];
    if (settingsApplied) parts.push(t("settings.backup.resultSettings"));
    if (dictionaryResult) {
      parts.push(
        t("settings.backup.resultDictionary", {
          added: dictionaryResult.added,
          merged: dictionaryResult.merged,
          skipped: dictionaryResult.skipped,
        }),
      );
    }
    if (replacementsFailed) {
      backupImportFeedback.show(
        "error",
        t("settings.backup.importReplacementsFailed", {
          detail: parts.join("；"),
        }),
      );
      // 保留已解析的備份與密碼，讓使用者可直接重試，不必重新選檔／重打密碼
    } else {
      backupImportFeedback.show(
        "success",
        t("settings.backup.importSuccess", { detail: parts.join("；") }),
      );
      parsedBackup.value = null;
      importPassword.value = "";
    }
  } catch (err) {
    const code = extractErrorMessage(err);
    backupImportFeedback.show("error", getBackupErrorMessage(code));
    // 密碼錯誤／需要密碼屬常態使用者操作，不上報 Sentry 噪音
    if (code !== "DECRYPT_FAILED" && code !== "PASSWORD_REQUIRED") {
      captureError(err, { source: "settings-backup-import" });
    }
  } finally {
    isImporting.value = false;
  }
}

// 設定可能在本 View mount 之後才載入完成（main-window.ts 先 app.mount()
// 才 await loadSettings()）。載入完成時重新把持久化值同步進輸入欄位，
// 否則畫面會停在空白，使用者也無從得知那不是真正的設定值。
watch(
  () => settingsStore.isSettingsLoaded,
  (loaded) => {
    if (loaded) {
      loadAzureInputsFromStore();
      void tryAutoLoadAzureDeployments();
    }
  },
);

watch(
  () => settingsStore.selectedLlmProviderId,
  (providerId) => {
    if (providerId !== "azure") {
      hasAttemptedAzureAutoLoad.value = false;
      return;
    }
    void tryAutoLoadAzureDeployments();
  },
);

onMounted(async () => {
  await replacementStore.ensureLoaded();
  // F5 fix: 先載入裝置列表，完成後再啟動預覽（避免 cpal 並行 host 查詢）
  void loadAudioInputDeviceList().then(() => {
    void startPreview(settingsStore.selectedAudioInputDeviceName);
  });
  selectedPromptMode.value = settingsStore.promptMode;
  promptInput.value = settingsStore.getAiPrompt();
  isPresetDirty.value = false;

  if (settingsStore.hasApiKey) {
    apiKeyInput.value = settingsStore.getApiKey();
  }
  loadAzureInputsFromStore();
  void tryAutoLoadAzureDeployments();
  thresholdEnabled.value = settingsStore.isEnhancementThresholdEnabled;
  thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
  recordingAutoCleanupEnabled.value =
    settingsStore.isRecordingAutoCleanupEnabled;
  recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
  debugLogEnabled.value = settingsStore.isDebugLogEnabled;
  debugLogRetentionDays.value = settingsStore.debugLogRetentionDays;
  await settingsStore.loadAutoStartStatus();

  // Detect if current key is custom or combo
  const currentKey = settingsStore.hotkeyConfig?.triggerKey;
  if (currentKey && (isCustomTriggerKey(currentKey) || isComboTriggerKey(currentKey))) {
    isCustomMode.value = true;
  }
});

onBeforeUnmount(() => {
  void stopPreview();
  stopKeyRecording();
  clearTimeout(deleteConfirmTimeoutId);
  clearTimeout(resetPromptConfirmTimeoutId);
  clearTimeout(hideDockIconPendingTimeoutId);
});
</script>

<template>
  <div class="p-6 space-y-6 text-foreground">
    <!-- 關於 SayIt -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.about.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{ $t("settings.about.description") }}
        </p>

        <!-- 作者：Money Yu（主要資訊，顯眼） -->
        <div class="space-y-3">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="text-sm text-muted-foreground">{{ $t("settings.about.author") }}</span>
            <a href="https://github.com/lettucebo" target="_blank" rel="noopener noreferrer" class="text-base font-semibold text-foreground hover:text-primary transition-colors">Money Yu</a>
          </div>

          <div class="flex flex-wrap gap-x-4 gap-y-2">
            <a href="https://github.com/lettucebo" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
              <Globe class="size-4" />
              <span>{{ $t("settings.about.website") }}</span>
            </a>
            <a href="https://www.facebook.com/lettucebo" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
              <Facebook class="size-4" />
              <span>Facebook</span>
            </a>
            <a href="https://www.instagram.com/moneyyu816/" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
              <Instagram class="size-4" />
              <span>Instagram</span>
            </a>
            <a href="https://www.threads.com/@moneyyu816" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
              <AtSign class="size-4" />
              <span>Threads</span>
            </a>
            <a href="https://www.linkedin.com/in/abc12207/" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
              <Linkedin class="size-4" />
              <span>LinkedIn</span>
            </a>
          </div>
        </div>

        <Separator />

        <div class="flex flex-wrap gap-x-4 gap-y-2">
          <a href="https://github.com/lettucebo/SayIt" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Github class="size-4" />
            <span>{{ $t("settings.about.sourceCode") }}</span>
          </a>
          <a href="https://github.com/lettucebo/SayIt/issues" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <CircleAlert class="size-4" />
            <span>{{ $t("settings.about.reportIssue") }}</span>
          </a>
        </div>

        <!-- 原作者（不起眼小字 credit） -->
        <p class="text-xs text-muted-foreground/60">
          {{ $t("settings.about.originalAuthor") }}
          <a href="https://jackle.pro" target="_blank" rel="noopener noreferrer" class="underline-offset-2 hover:text-muted-foreground hover:underline">Jackle Chen</a>
        </p>
      </CardContent>
    </Card>

    <!-- 快捷鍵設定 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.hotkey.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 簡易 / 自訂 模式切換 -->
        <div class="flex items-center justify-between">
          <Label>{{ $t("settings.hotkey.triggerKeyMode") }}</Label>
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                !isCustomMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="switchToPreset"
            >
              {{ $t("settings.hotkey.preset") }}
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                isCustomMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="switchToCustom"
            >
              {{ $t("settings.hotkey.custom") }}
            </button>
          </div>
        </div>

        <!-- 簡易模式：Select 下拉 -->
        <div v-if="!isCustomMode" class="flex items-center justify-between">
          <div class="flex items-baseline">
            <Label for="trigger-key">{{ $t("settings.hotkey.triggerKey") }}</Label>
            <InlineFeedback :feedback="hotkeyKeyFeedback.state.value" class="ms-2" />
          </div>
          <Select
            :model-value="currentPresetKey"
            @update:model-value="handleTriggerKeyChange($event as PresetTriggerKey)"
          >
            <SelectTrigger id="trigger-key" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in triggerKeyOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 自訂模式：錄製按鍵 -->
        <div v-else class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-baseline">
              <Label>{{ $t("settings.hotkey.customTriggerKey") }}</Label>
              <InlineFeedback :feedback="hotkeyRecordingFeedback.state.value" class="ms-2" />
            </div>
            <div class="flex items-center gap-3">
              <span v-if="hasCustomKey" class="text-sm font-medium text-foreground">
                {{ currentCustomKeyDisplay }}
              </span>
              <span v-else class="text-sm text-muted-foreground">{{ $t("settings.hotkey.notSet") }}</span>
              <Button
                :variant="isRecording ? 'destructive' : 'outline'"
                size="sm"
                :class="{ 'animate-pulse': isRecording }"
                @click="isRecording ? stopKeyRecording() : startRecording()"
              >
                {{ isRecording ? $t('settings.hotkey.pressKey') : $t('settings.hotkey.record') }}
              </Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.hotkey.systemKeyHint") }}
          </p>

          <!-- 警告訊息（黃色） -->
          <p v-if="recordingWarning" class="text-sm text-destructive">
            {{ recordingWarning }}
          </p>

          <!-- 提示訊息（藍色） -->
          <p v-if="recordingHint" class="text-sm text-muted-foreground">
            {{ recordingHint }}
          </p>
        </div>

        <!-- 觸發模式 -->
        <div class="flex items-center justify-between">
          <div class="flex items-baseline">
            <Label for="trigger-mode">{{ $t("settings.hotkey.triggerMode") }}</Label>
            <InlineFeedback :feedback="hotkeyModeFeedback.state.value" class="ms-2" />
          </div>
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                settingsStore.triggerMode === 'hold'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="handleTriggerModeChange('hold')"
            >
              Hold
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                settingsStore.triggerMode === 'toggle'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="handleTriggerModeChange('toggle')"
            >
              Toggle
            </button>
          </div>
        </div>

        <p class="text-sm text-muted-foreground leading-relaxed">
          {{
            settingsStore.triggerMode === "hold"
              ? $t("settings.hotkey.holdDescription")
              : $t("settings.hotkey.toggleDescription")
          }}
        </p>

        <p class="text-xs text-muted-foreground">
          {{
            settingsStore.triggerMode === "hold"
              ? $t("settings.hotkey.doubleTapHint")
              : $t("settings.hotkey.longPressHint")
          }}
        </p>
      </CardContent>
    </Card>

    <!-- Groq API Key -->
    <Card>
      <CardHeader class="flex-row items-center justify-between border-b border-border">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base">Groq API Key</CardTitle>
          <Badge
            :class="apiKeyStatusClass"
            class="border-0"
          >
            {{ apiKeyStatusLabel }}
          </Badge>
        </div>
        <a
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noreferrer"
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {{ $t("settings.apiKey.goToConsole") }} &rarr;
        </a>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.apiKey.instruction") }}
        </p>

        <p
          v-if="shouldShowOnboardingHint"
          class="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200"
        >
          {{ $t("settings.apiKey.onboarding") }}
        </p>

        <div class="flex gap-2">
          <div class="flex flex-1 gap-2">
            <Input
              v-model="apiKeyInput"
              :type="isApiKeyVisible ? 'text' : 'password'"
              placeholder="gsk_..."
              autocomplete="off"
              class="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              @click="toggleApiKeyVisibility"
            >
              {{ isApiKeyVisible ? $t("settings.apiKey.hide") : $t("settings.apiKey.show") }}
            </Button>
          </div>
          <Button
            :disabled="isSubmittingApiKey"
            @click="handleSaveApiKey"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <SettingsActionRow :feedback="apiKeyFeedback.state.value">
          <Button
            v-if="settingsStore.hasApiKey"
            variant="outline"
            :class="
              isConfirmingDeleteApiKey
                ? 'bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90'
                : 'text-destructive border-destructive hover:bg-destructive/10'
            "
            :disabled="isSubmittingApiKey"
            @click="requestDeleteApiKey"
          >
            {{ isConfirmingDeleteApiKey ? $t('settings.apiKey.confirmDelete') : $t('settings.apiKey.delete') }}
          </Button>
        </SettingsActionRow>
      </CardContent>
    </Card>

    <!-- Azure / Microsoft Foundry 連線 -->
    <Card>
      <CardHeader class="flex-row items-center justify-between border-b border-border">
        <div class="flex min-w-0 items-baseline">
          <CardTitle class="text-base">{{ $t("settings.azure.title") }}</CardTitle>
          <InlineFeedback :feedback="azureLifecycleFeedback.state.value" class="ms-2" />
        </div>
        <Switch
          :model-value="azureEnabledInput"
          :disabled="isSubmittingAzure"
          @update:model-value="handleToggleAzureEnabled"
        />
      </CardHeader>
      <CardContent v-if="azureEnabledInput" class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.azure.description") }}
        </p>

        <div class="space-y-2">
          <Label for="azure-endpoint">{{ $t("settings.azure.endpointLabel") }}</Label>
          <Input
            id="azure-endpoint"
            v-model="azureEndpointInput"
            :placeholder="$t('settings.azure.endpointPlaceholder')"
            class="font-mono text-xs"
          />
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.azure.endpointHint") }}
          </p>
        </div>

        <div class="space-y-2">
          <Label>{{ $t("settings.azure.authModeLabel") }}</Label>
          <RadioGroup
            :model-value="azureAuthModeInput"
            class="grid gap-2 sm:grid-cols-3"
            @update:model-value="(v: unknown) => {
              if (AZURE_AUTH_MODE_VALUES.includes(v as AzureAuthMode)) azureAuthModeInput = v as AzureAuthMode;
            }"
          >
            <Label
              for="azure-auth-key"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="azureAuthModeInput === 'key' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="azure-auth-key" value="key" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">{{ $t("settings.azure.authKey") }}</span>
            </Label>
            <Label
              for="azure-auth-entra-user"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="azureAuthModeInput === 'entraUser' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="azure-auth-entra-user" value="entraUser" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="min-w-0 truncate text-sm font-medium">{{ $t("settings.azure.authEntraUser") }}</span>
              <Badge variant="secondary" class="ml-auto shrink-0">{{ $t("settings.azure.recommended") }}</Badge>
            </Label>
            <Label
              for="azure-auth-entra"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="azureAuthModeInput === 'entra' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="azure-auth-entra" value="entra" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">{{ $t("settings.azure.authEntra") }}</span>
            </Label>
          </RadioGroup>
        </div>

        <div v-if="azureAuthModeInput === 'key'" class="space-y-2">
          <Label for="azure-api-key">{{ $t("settings.azure.apiKeyLabel") }}</Label>
          <div class="flex gap-2">
            <Input
              id="azure-api-key"
              v-model="azureApiKeyInput"
              :type="isAzureApiKeyVisible ? 'text' : 'password'"
              class="flex-1 font-mono text-xs"
            />
            <Button variant="outline" size="sm" @click="isAzureApiKeyVisible = !isAzureApiKeyVisible">
              {{ isAzureApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
          </div>
        </div>

        <div v-else-if="azureAuthModeInput === 'entraUser'" class="space-y-2">
          <p class="text-sm text-muted-foreground leading-relaxed">
            {{ $t("settings.azure.entraUserDescription") }}
          </p>
          <Label for="azure-user-tenant-id">{{ $t("settings.azure.tenantIdLabel") }}</Label>
          <Input id="azure-user-tenant-id" v-model="azureTenantIdInput" class="font-mono text-xs" />
          <Label for="azure-user-client-id">{{ $t("settings.azure.clientIdLabel") }}</Label>
          <Input id="azure-user-client-id" v-model="azureClientIdInput" class="font-mono text-xs" />

          <div
            v-if="isSignedInForCurrentInput"
            class="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3"
          >
            <div class="flex items-center gap-2">
              <CircleCheck class="size-4 text-success" />
              <span class="text-sm">{{ $t("settings.azure.signedInAs", { account: azureSignedInLabel }) }}</span>
            </div>
            <Button variant="outline" size="sm" :disabled="isSubmittingAzure" @click="handleAzureUserSignOut">
              {{ $t("settings.azure.signOut") }}
            </Button>
          </div>
          <div v-else-if="isAzureSigningIn" class="flex items-center justify-between rounded-md border border-border p-3">
            <div class="flex items-center gap-2">
              <LoaderCircle class="size-4 animate-spin text-muted-foreground" />
              <span class="text-sm text-muted-foreground">{{ $t("settings.azure.signInWaiting") }}</span>
            </div>
            <Button variant="outline" size="sm" @click="handleAzureUserCancelSignIn">
              {{ $t("settings.azure.signInCancel") }}
            </Button>
          </div>
          <SettingsActionRow
            v-else
          >
            <Button
              :disabled="azureTenantIdInput.trim() === '' || azureClientIdInput.trim() === ''"
              @click="handleAzureUserSignIn"
            >
              {{ $t("settings.azure.signIn") }}
            </Button>
          </SettingsActionRow>
        </div>

        <div v-else class="space-y-2">
          <Label for="azure-tenant-id">{{ $t("settings.azure.tenantIdLabel") }}</Label>
          <Input id="azure-tenant-id" v-model="azureTenantIdInput" class="font-mono text-xs" />
          <Label for="azure-client-id">{{ $t("settings.azure.clientIdLabel") }}</Label>
          <Input id="azure-client-id" v-model="azureClientIdInput" class="font-mono text-xs" />
          <Label for="azure-client-secret">{{ $t("settings.azure.clientSecretLabel") }}</Label>
          <div class="flex gap-2">
            <Input
              id="azure-client-secret"
              v-model="azureClientSecretInput"
              :type="isAzureClientSecretVisible ? 'text' : 'password'"
              class="flex-1 font-mono text-xs"
            />
            <Button variant="outline" size="sm" @click="isAzureClientSecretVisible = !isAzureClientSecretVisible">
              {{ isAzureClientSecretVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
          </div>
          <p class="text-xs text-amber-400">{{ $t("settings.azure.secretWarning") }}</p>
        </div>

        <InlineFeedback
          :feedback="azureSignInFeedback.state.value"
          :assertive="azureSignInFeedback.state.value?.type === 'error'"
          class="block"
        />

        <div class="space-y-2">
          <Label for="azure-api-version">{{ $t("settings.azure.apiVersionLabel") }}</Label>
          <Input
            id="azure-api-version"
            v-model="azureApiVersionInput"
            :placeholder="$t('settings.azure.apiVersionPlaceholder')"
            class="font-mono text-xs"
          />
        </div>

        <SettingsActionRow :feedback="azureConnectionFeedback.state.value">
          <Button
            variant="outline"
            class="text-destructive border-destructive hover:bg-destructive/10"
            :disabled="isSubmittingAzure"
            @click="handleDeleteAzureConnection"
          >
            {{ $t('settings.azure.clear') }}
          </Button>
          <Button :disabled="isSubmittingAzure" @click="handleSaveAzureConnection">
            {{ $t('common.save') }}
          </Button>
        </SettingsActionRow>
      </CardContent>
    </Card>

    <!-- 模型選擇 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.model.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-5">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.model.description") }}
        </p>

        <!-- Whisper 模型 -->
        <div class="space-y-2">
          <Label for="whisper-model">{{ $t("settings.model.whisperLabel") }}</Label>

          <!-- 轉錄 provider 切換：Groq / Gemini 常駐，Azure 啟用時顯示兩種 Azure 服務 -->
          <RadioGroup
            :model-value="settingsStore.whisperProviderId"
            class="grid gap-2"
            :class="settingsStore.azureEnabled ? 'grid-cols-4' : 'grid-cols-2'"
            @update:model-value="(v: unknown) => handleWhisperProviderChange(v as TranscriptionProviderId)"
          >
            <Label
              for="whisper-provider-groq"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="settingsStore.whisperProviderId === 'groq' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="whisper-provider-groq" value="groq" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">Groq</span>
            </Label>
            <Label
              for="whisper-provider-gemini"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="settingsStore.whisperProviderId === 'gemini' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="whisper-provider-gemini" value="gemini" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">Gemini</span>
            </Label>
            <Label
              v-if="settingsStore.azureEnabled"
              for="whisper-provider-azure"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="settingsStore.whisperProviderId === 'azure' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="whisper-provider-azure" value="azure" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">Azure OpenAI</span>
            </Label>
            <Label
              v-if="settingsStore.azureEnabled"
              for="whisper-provider-mai"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="settingsStore.whisperProviderId === 'mai' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="whisper-provider-mai" value="mai" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">MAI-Transcribe</span>
            </Label>
          </RadioGroup>
          <InlineFeedback :feedback="whisperProviderFeedback.state.value" class="block" />

          <!-- Groq Whisper 模型下拉 -->
          <template v-if="settingsStore.whisperProviderId === 'groq'">
            <Select
              :model-value="settingsStore.selectedWhisperModelId"
              @update:model-value="handleWhisperModelChange($event as WhisperModelId)"
            >
              <SelectTrigger id="whisper-model" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="model in WHISPER_MODEL_LIST"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.displayName }}
                  <template #extra>
                    <Badge variant="secondary" class="ml-2 text-xs">{{ $t(model.badgeKey) }}</Badge>
                    <Badge v-if="model.isDefault" variant="outline" class="ml-1 text-xs">{{ $t("settings.model.default") }}</Badge>
                  </template>
                </SelectItem>
              </SelectContent>
            </Select>
            <InlineFeedback :feedback="whisperModelFeedback.state.value" class="block" />
            <p class="text-xs text-muted-foreground">{{ whisperModelDescription }}</p>
            <ConnectionTestButton
              :on-test="() => testWhisperConnection(settingsStore.selectedWhisperModelId, settingsStore.getApiKey())"
              :disabled="!settingsStore.hasApiKey"
            />
          </template>

          <!-- Gemini 轉錄（模型固定，需 Gemini API Key；與 LLM 共用同一把 key） -->
          <template v-else-if="settingsStore.whisperProviderId === 'gemini'">
            <Select
              :model-value="settingsStore.geminiTranscriptionModelId"
              @update:model-value="handleGeminiTranscriptionModelChange($event as GeminiTranscriptionModelId)"
            >
              <SelectTrigger id="whisper-model" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="model in GEMINI_TRANSCRIPTION_MODEL_LIST"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.displayName }}
                  <template #extra>
                    <Badge variant="secondary" class="ml-2 text-xs">{{ $t(model.badgeKey) }}</Badge>
                    <Badge v-if="model.isDefault" variant="outline" class="ml-1 text-xs">{{ $t("settings.model.default") }}</Badge>
                  </template>
                </SelectItem>
              </SelectContent>
            </Select>
            <InlineFeedback :feedback="geminiTranscriptionModelFeedback.state.value" class="block" />
            <p class="text-xs text-muted-foreground">{{ geminiTranscriptionModelDescription }}</p>
            <p class="text-xs text-muted-foreground">
              {{ $t("settings.model.geminiTranscriptionHint") }}
            </p>
            <div class="flex items-baseline">
              <Label for="gemini-whisper-api-key">{{ $t("settings.providerApiKey.geminiTitle") }}</Label>
              <InlineFeedback :feedback="geminiWhisperApiKeyFeedback.state.value" class="ms-2" />
            </div>
            <div v-if="settingsStore.geminiApiKey" class="flex items-center gap-2">
              <Input
                id="gemini-whisper-api-key"
                :model-value="isGeminiApiKeyVisible ? settingsStore.geminiApiKey : '••••••••••'"
                readonly
                class="flex-1 font-mono text-xs"
              />
              <Button variant="ghost" size="sm" @click="isGeminiApiKeyVisible = !isGeminiApiKeyVisible">
                {{ isGeminiApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
              </Button>
              <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteGeminiApiKey('whisper')">
                {{ $t('settings.apiKey.delete') }}
              </Button>
            </div>
            <div v-else class="flex gap-2">
              <Input
                id="gemini-whisper-api-key"
                v-model="geminiApiKeyInput"
                type="password"
                :placeholder="findProviderConfig('gemini')?.apiKeyPrefix + '...'"
                class="flex-1 font-mono text-xs"
              />
              <Button size="sm" :disabled="!geminiApiKeyInput.trim()" @click="handleSaveGeminiApiKey('whisper')">
                {{ $t('common.save') }}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              {{ $t("settings.providerApiKey.geminiInstruction") }}
              ·
              <a :href="findProviderConfig('gemini')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToGemini") }}</a>
            </p>
            <ConnectionTestButton
              :on-test="testGeminiWhisperConnection"
              :disabled="!settingsStore.hasWhisperConfig"
            />

            <!-- 免費額度（Google 未公開，只能由使用者自 AI Studio 查得後填入） -->
            <div class="flex items-baseline">
              <Label for="gemini-free-quota">{{ $t("settings.model.geminiQuotaLabel") }}</Label>
              <InlineFeedback :feedback="geminiQuotaFeedback.state.value" class="ms-2" />
            </div>
            <div class="flex gap-2">
              <Input
                id="gemini-free-quota"
                v-model="geminiFreeQuotaInput"
                type="number"
                min="0"
                :placeholder="geminiQuotaPlaceholder"
                class="flex-1"
              />
              <Select
                :model-value="geminiFreeQuotaPeriodInput"
                @update:model-value="geminiFreeQuotaPeriodInput = $event as QuotaPeriod"
              >
                <SelectTrigger class="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{{ $t("settings.model.quotaPeriodDaily") }}</SelectItem>
                  <SelectItem value="monthly">{{ $t("settings.model.quotaPeriodMonthly") }}</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" @click="handleSaveGeminiFreeQuota">
                {{ $t('common.save') }}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              {{ $t("settings.model.geminiQuotaHint") }}
              ·
              <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.model.geminiQuotaLink") }}</a>
            </p>
          </template>

          <!-- Azure OpenAI Whisper 部署 -->
          <template v-else-if="settingsStore.whisperProviderId === 'azure'">
            <div class="flex items-baseline">
              <Label for="azure-whisper-deployment">{{ $t("settings.azure.whisperDeploymentLabel") }}</Label>
              <InlineFeedback :feedback="azureWhisperDeploymentFeedback.state.value" class="ms-2" />
            </div>
            <div class="flex gap-2">
              <Input
                id="azure-whisper-deployment"
                v-model="azureWhisperDeploymentInput"
                :placeholder="$t('settings.azure.whisperDeploymentPlaceholder')"
                class="flex-1 font-mono text-xs"
              />
              <Button size="sm" :disabled="!azureWhisperDeploymentInput.trim()" @click="handleSaveAzureWhisperDeployment">
                {{ $t('common.save') }}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ $t("settings.azure.whisperHint") }}</p>
            <ConnectionTestButton
              :on-test="testAzureWhisperConnection"
              :disabled="!settingsStore.hasWhisperConfig"
            />
            <p
              v-if="!settingsStore.hasWhisperConfig"
              class="text-xs text-amber-400"
            >
              {{ azureConnectionIssue(settingsStore.azureWhisperDeployment) }}
            </p>
          </template>

          <!-- Azure AI Speech MAI-Transcribe -->
          <template v-else>
            <div class="flex items-center gap-2">
              <Label for="mai-transcribe-model">{{ $t("settings.azure.maiModelLabel") }}</Label>
              <Badge variant="secondary">{{ $t("settings.azure.preview") }}</Badge>
            </div>
            <Input
              id="mai-transcribe-model"
              :model-value="MAI_TRANSCRIPTION_MODEL_ID"
              readonly
              class="font-mono text-xs"
            />
            <p class="text-xs text-muted-foreground">{{ $t("settings.azure.maiHint") }}</p>
            <InlineFeedback :feedback="maiOptionsFeedback.state.value" class="block" />

            <div class="space-y-2">
              <Label for="azure-speech-endpoint">{{ $t("settings.azure.speechEndpointLabel") }}</Label>
              <Input
                id="azure-speech-endpoint"
                v-model="azureSpeechEndpointInput"
                :placeholder="$t('settings.azure.speechEndpointPlaceholder')"
                class="font-mono text-xs"
              />
            </div>
            <div v-if="azureAuthModeInput === 'key'" class="space-y-2">
              <Label for="azure-speech-api-key">{{ $t("settings.azure.speechApiKeyLabel") }}</Label>
              <div class="flex gap-2">
                <Input
                  id="azure-speech-api-key"
                  v-model="azureSpeechApiKeyInput"
                  :type="isAzureSpeechApiKeyVisible ? 'text' : 'password'"
                  class="flex-1 font-mono text-xs"
                />
                <Button variant="ghost" size="sm" @click="isAzureSpeechApiKeyVisible = !isAzureSpeechApiKeyVisible">
                  {{ isAzureSpeechApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
                </Button>
              </div>
            </div>
            <SettingsActionRow :feedback="azureSpeechFeedback.state.value">
              <Button
                size="sm"
                :disabled="!azureSpeechEndpointInput.trim() || (azureAuthModeInput === 'key' && !azureSpeechApiKeyInput.trim())"
                @click="handleSaveAzureSpeechConnection"
              >
                {{ $t("common.save") }}
              </Button>
            </SettingsActionRow>

            <div class="space-y-2">
              <Label for="mai-input-locale">{{ $t("settings.azure.maiCandidateLocalesLabel") }}</Label>
              <p class="text-xs text-muted-foreground">{{ $t("settings.azure.maiCandidateLocalesHint") }}</p>
              <Select
                :model-value="settingsStore.maiCandidateLocales[0] ?? 'auto'"
                @update:model-value="(value: unknown) => handleMaiInputLocaleChange(value as string)"
              >
                <SelectTrigger id="mai-input-locale" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{{ $t("settings.app.autoDetect") }}</SelectItem>
                  <SelectItem
                    v-for="option in MAI_CANDIDATE_LOCALE_OPTIONS"
                    :key="option.locale"
                    :value="option.locale"
                  >
                    {{ option.displayName }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2">
              <Label for="mai-transcribe-style">{{ $t("settings.azure.maiTranscribeStyleLabel") }}</Label>
              <Select
                :model-value="settingsStore.maiTranscribeStyle"
                @update:model-value="(style: unknown) => handleMaiTranscribeStyleChange(style as MaiTranscribeStyle)"
              >
                <SelectTrigger id="mai-transcribe-style" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{{ $t("settings.azure.maiTranscribeStyleDefault") }}</SelectItem>
                  <SelectItem value="verbatim">{{ $t("settings.azure.maiTranscribeStyleVerbatim") }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p class="text-xs text-muted-foreground">{{ $t("settings.azure.maiRbacHint") }}</p>
            <ConnectionTestButton
              :on-test="testMaiConnection"
              :disabled="!settingsStore.hasWhisperConfig"
            />
          </template>
        </div>

        <Separator />

        <!-- LLM Provider 選擇 -->
        <div class="space-y-3">
          <Label>{{ $t("settings.provider.title") }}</Label>
          <p class="text-xs text-muted-foreground">{{ $t("settings.provider.description") }}</p>
          <RadioGroup
            :model-value="settingsStore.selectedLlmProviderId"
            class="grid grid-cols-2 gap-2"
            @update:model-value="(v: unknown) => handleProviderChange(v as LlmProviderId)"
          >
            <Label
              v-for="provider in LLM_PROVIDER_LIST"
              :key="provider.id"
              :for="`provider-${provider.id}`"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="settingsStore.selectedLlmProviderId === provider.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem :id="`provider-${provider.id}`" :value="provider.id" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">{{ $t(`settings.provider.${provider.id}`) }}</span>
            </Label>
          </RadioGroup>
          <InlineFeedback :feedback="llmProviderFeedback.state.value" class="block" />
        </div>

        <!-- Provider-specific API Key -->
        <div v-if="settingsStore.selectedLlmProviderId === 'groq'" class="rounded-md bg-muted/50 p-3">
          <p class="text-xs text-muted-foreground">{{ $t("settings.provider.groqNote") }}</p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'openai'" class="space-y-2">
          <div class="flex items-baseline">
            <Label for="openai-api-key">{{ $t("settings.providerApiKey.openaiTitle") }}</Label>
            <InlineFeedback :feedback="openaiApiKeyFeedback.state.value" class="ms-2" />
          </div>
          <div v-if="settingsStore.openaiApiKey" class="flex items-center gap-2">
            <Input
              id="openai-api-key"
              :model-value="isOpenaiApiKeyVisible ? settingsStore.openaiApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isOpenaiApiKeyVisible = !isOpenaiApiKeyVisible">
              {{ isOpenaiApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteOpenaiApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="openai-api-key"
              v-model="openaiApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('openai')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!openaiApiKeyInput.trim()" @click="handleSaveOpenaiApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.openaiInstruction") }}
            ·
            <a :href="findProviderConfig('openai')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToOpenai") }}</a>
          </p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'anthropic'" class="space-y-2">
          <div class="flex items-baseline">
            <Label for="anthropic-api-key">{{ $t("settings.providerApiKey.anthropicTitle") }}</Label>
            <InlineFeedback :feedback="anthropicApiKeyFeedback.state.value" class="ms-2" />
          </div>
          <div v-if="settingsStore.anthropicApiKey" class="flex items-center gap-2">
            <Input
              id="anthropic-api-key"
              :model-value="isAnthropicApiKeyVisible ? settingsStore.anthropicApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isAnthropicApiKeyVisible = !isAnthropicApiKeyVisible">
              {{ isAnthropicApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteAnthropicApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="anthropic-api-key"
              v-model="anthropicApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('anthropic')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!anthropicApiKeyInput.trim()" @click="handleSaveAnthropicApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.anthropicInstruction") }}
            ·
            <a :href="findProviderConfig('anthropic')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToAnthropic") }}</a>
          </p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'gemini'" class="space-y-2">
          <div class="flex items-baseline">
            <Label for="gemini-api-key">{{ $t("settings.providerApiKey.geminiTitle") }}</Label>
            <InlineFeedback :feedback="geminiLlmApiKeyFeedback.state.value" class="ms-2" />
          </div>
          <div v-if="settingsStore.geminiApiKey" class="flex items-center gap-2">
            <Input
              id="gemini-api-key"
              :model-value="isGeminiApiKeyVisible ? settingsStore.geminiApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isGeminiApiKeyVisible = !isGeminiApiKeyVisible">
              {{ isGeminiApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteGeminiApiKey('llm')">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="gemini-api-key"
              v-model="geminiApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('gemini')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!geminiApiKeyInput.trim()" @click="handleSaveGeminiApiKey('llm')">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.geminiInstruction") }}
            ·
            <a :href="findProviderConfig('gemini')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToGemini") }}</a>
          </p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'azure'" class="space-y-2">
          <div class="flex items-baseline">
            <Label for="azure-chat-deployment-list">{{ $t("settings.azure.chatDeploymentLabel") }}</Label>
            <InlineFeedback :feedback="azureChatDeploymentFeedback.state.value" class="ms-2" />
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="isLoadingAzureDeployments || !azureEndpointInput.trim()"
              @click="handleLoadAzureDeployments"
            >
              <LoaderCircle v-if="isLoadingAzureDeployments" class="mr-1 size-4 animate-spin" />
              {{ $t(azureDeploymentListResult ? "settings.azure.reloadDeployments" : "settings.azure.loadDeployments") }}
            </Button>
            <span
              v-if="azureDeploymentListResult?.source === 'foundry'"
              class="text-xs text-muted-foreground"
            >
              {{ azureDeploymentListResult.capabilityFiltered
                ? $t("settings.azure.deploymentListVerified")
                : $t("settings.azure.deploymentListUnverified") }}
            </span>
          </div>
          <div v-if="azureDeploymentList.length > 0" class="space-y-2">
            <Select
              :model-value="azureChatDeploymentInput"
              @update:model-value="handleAzureDeploymentSelection(String($event))"
            >
              <SelectTrigger id="azure-chat-deployment-list" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="deployment in azureDeploymentOptions"
                  :key="deployment.name"
                  :value="deployment.name"
                >
                  {{ deployment.name }}<template v-if="deployment.modelName"> — {{ deployment.modelPublisher }} {{ deployment.modelName }}</template><template v-else-if="isStoredAzureDeploymentMissingFromList && deployment.name === azureChatDeploymentInput"> — {{ $t("settings.azure.deploymentMissingFromList") }}</template>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div
            v-if="azureDeploymentList.length === 0 || isManualAzureChatDeploymentInputVisible"
            class="space-y-2"
          >
            <Label for="azure-chat-deployment">{{ $t("settings.azure.manualChatDeploymentLabel") }}</Label>
            <div class="flex gap-2">
              <Input
                id="azure-chat-deployment"
                v-model="azureChatDeploymentInput"
                :placeholder="$t('settings.azure.chatDeploymentPlaceholder')"
                class="flex-1 font-mono text-xs"
              />
              <Button size="sm" :disabled="!azureChatDeploymentInput.trim()" @click="handleSaveAzureChatDeployment">
                {{ $t('common.save') }}
              </Button>
            </div>
          </div>
          <Button
            v-else
            variant="link"
            size="sm"
            class="h-auto w-fit px-0 text-muted-foreground"
            @click="isManualAzureChatDeploymentInputVisible = true"
          >
            {{ $t("settings.azure.enterDeploymentManually") }}
          </Button>
          <p
            v-if="azureDeploymentListResult?.fallbackReason && azureDeploymentListResult.fallbackReason !== 'capability-unverified'"
            class="text-xs text-amber-400"
          >
            {{ azureDeploymentListResult.fallbackReason === 'project-not-configured' ? $t("settings.azure.deploymentListFallbackProject") : $t("settings.azure.deploymentListFallbackRequest") }}
          </p>
          <div
            v-if="azureDetectedModelFamily"
            class="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-2"
          >
            <p class="text-xs text-muted-foreground">
              {{ azureDetectedModelFamily.confidence === "high"
                ? $t("settings.azure.modelFamilyDetected", {
                  publisher: selectedAzureDeployment?.modelPublisher ?? "",
                  model: selectedAzureDeployment?.modelName ?? "",
                  family: findAzureChatModelFamilyConfig(azureDetectedModelFamily.familyId)?.displayName ?? "",
                })
                : $t("settings.azure.modelFamilyDetectedLowConfidence", {
                  model: selectedAzureDeployment?.modelName ?? "",
                  family: findAzureChatModelFamilyConfig(azureDetectedModelFamily.familyId)?.displayName ?? "",
                }) }}
            </p>
            <Button
              v-if="isAzureDetectedFamilyDifferent"
              variant="outline"
              size="sm"
              @click="handleRestoreAzureModelFamilyAuto"
            >
              {{ $t("settings.azure.restoreAutoModelFamily") }}
            </Button>
          </div>
          <p
            v-else-if="azureModelFamilySuggestion"
            class="text-xs text-muted-foreground"
          >
            {{ $t("settings.azure.modelFamilySuggested", {
              family: findAzureChatModelFamilyConfig(azureModelFamilySuggestion.familyId)?.displayName ?? "",
            }) }}
          </p>
          <p v-if="!settingsStore.azureEnabled" class="text-xs text-amber-400">
            {{ $t("settings.azure.notConfiguredHint") }}
          </p>
          <p v-else class="text-xs text-muted-foreground">{{ $t("settings.azure.chatHint") }}</p>

          <div class="space-y-2 pt-2">
            <div class="flex items-baseline">
              <Label for="azure-chat-model-family">{{ $t("settings.azure.modelFamilyLabel") }}</Label>
              <InlineFeedback :feedback="azureModelFamilyFeedback.state.value" class="ms-2" />
            </div>
            <Select
              :model-value="settingsStore.azureChatModelFamily"
              @update:model-value="handleAzureChatModelFamilyChange($event as AzureChatModelFamilyId)"
            >
              <SelectTrigger id="azure-chat-model-family" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="modelFamily in AZURE_CHAT_MODEL_FAMILY_LIST"
                  :key="modelFamily.id"
                  :value="modelFamily.id"
                >
                  {{ modelFamily.displayName }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ azureChatModelFamilyConfig ? $t(azureChatModelFamilyConfig.descriptionKey) : $t("settings.azure.modelFamilyHint") }}
            </p>
            <p
              v-if="settingsStore.azureChatModelFamilySource === 'auto' && !isAzureDetectedFamilyDifferent"
              class="text-xs text-muted-foreground"
            >
              {{ $t("settings.azure.modelFamilySourceAuto") }}
            </p>
            <p
              v-else-if="settingsStore.azureChatModelFamilySource === 'manual'"
              class="text-xs text-muted-foreground"
            >
              {{ $t("settings.azure.modelFamilySourceManual") }}
            </p>
          </div>

          <SettingsControlRow :feedback="azureOmitTemperatureFeedback.state.value">
            <template #label>
              <Label for="azure-omit-temperature">{{ $t("settings.azure.omitTemperatureLabel") }}</Label>
            </template>
            <template #description>
              <p class="text-sm text-muted-foreground">{{ $t("settings.azure.omitTemperatureDescription") }}</p>
            </template>
            <Switch
              id="azure-omit-temperature"
              :model-value="settingsStore.azureOmitTemperature"
              @update:model-value="handleToggleAzureOmitTemperature"
            />
          </SettingsControlRow>
        </div>

        <ConnectionTestButton
          :on-test="settingsStore.selectedLlmProviderId === 'azure' ? testAzureChatConnection : () => testLlmConnection(settingsStore.selectedLlmModelId, settingsStore.getLlmApiKey())"
          :disabled="!settingsStore.hasLlmApiKey"
        />
        <p
          v-if="settingsStore.selectedLlmProviderId === 'azure' && !settingsStore.hasLlmApiKey"
          class="text-xs text-amber-400"
        >
          {{ azureConnectionIssue(settingsStore.azureChatDeployment) }}
        </p>

        <template v-if="settingsStore.selectedLlmProviderId !== 'azure' && (settingsStore.selectedLlmProviderId === 'groq' || settingsStore.hasLlmApiKey)">
          <Separator />

          <!-- LLM 模型 -->
          <div class="space-y-2">
            <div class="flex items-baseline">
              <Label for="llm-model">{{ $t("settings.model.llmLabel") }}</Label>
              <InlineFeedback :feedback="llmModelFeedback.state.value" class="ms-2" />
            </div>
            <Select
              :model-value="settingsStore.selectedLlmModelId"
              @update:model-value="handleLlmModelChange($event as LlmModelId)"
            >
              <SelectTrigger id="llm-model" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="model in providerModelList"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.displayName }}
                  <template #extra>
                    <Badge variant="secondary" class="ml-2 text-xs">{{ $t(model.badgeKey) }}</Badge>
                  </template>
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">{{ llmModelDescription }}</p>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- AI 整理 Prompt -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.prompt.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{ $t("settings.prompt.description") }}
        </p>

        <!-- 模式選擇器 -->
        <div class="space-y-2">
          <Label>{{ $t("settings.prompt.modeTitle") }}</Label>
          <RadioGroup
            :model-value="selectedPromptMode"
            class="grid grid-cols-3 gap-2"
            @update:model-value="handlePromptModeChange"
          >
            <Label
              for="mode-minimal"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'minimal' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-minimal" value="minimal" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeMinimal") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeMinimalDescription") }}</p>
              </div>
            </Label>
            <Label
              for="mode-active"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'active' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-active" value="active" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeActive") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeActiveDescription") }}</p>
              </div>
            </Label>
            <Label
              for="mode-custom"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'custom' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-custom" value="custom" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeCustom") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeCustomDescription") }}</p>
              </div>
            </Label>
          </RadioGroup>
        </div>

        <Textarea
          v-model="promptInput"
          class="font-mono min-h-[120px]"
          @input="handlePromptInput"
        />

        <SettingsActionRow :feedback="promptFeedback.state.value">
          <Button
            :disabled="isSubmittingPrompt || (selectedPromptMode !== 'custom' && !isPresetDirty)"
            @click="handleSavePrompt"
          >
            {{ $t("common.save") }}
          </Button>
          <Button
            variant="outline"
            :class="
              isConfirmingResetPrompt
                ? 'border-destructive text-destructive hover:bg-destructive/10'
                : ''
            "
            :disabled="isSubmittingPrompt"
            @click="requestResetPrompt"
          >
            {{ isConfirmingResetPrompt ? $t('settings.prompt.confirmReset') : $t('settings.prompt.reset') }}
          </Button>
        </SettingsActionRow>
      </CardContent>
    </Card>

    <!-- 短文字門檻 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.threshold.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.threshold.description") }}
        </p>

        <SettingsControlRow :feedback="thresholdToggleFeedback.state.value">
          <template #label>
            <Label for="threshold-toggle">{{ thresholdEnabled ? $t('settings.threshold.enabled') : $t('settings.threshold.disabled') }}</Label>
          </template>
          <Switch
            id="threshold-toggle"
            :model-value="thresholdEnabled"
            @update:model-value="handleToggleEnhancementThreshold"
          />
        </SettingsControlRow>

        <SettingsActionRow
          v-if="thresholdEnabled"
          :feedback="thresholdCharCountFeedback.state.value"
          align="start"
        >
          <Label for="threshold-char-count">{{ $t("settings.threshold.charCount") }}</Label>
          <Input
            id="threshold-char-count"
            v-model.number="thresholdCharCount"
            type="number"
            min="1"
            class="w-24"
          />
          <Button
            size="sm"
            @click="handleSaveThresholdCharCount"
          >
            {{ $t("common.save") }}
          </Button>
        </SettingsActionRow>
      </CardContent>
    </Card>

    <!-- 取代規則 -->
    <Card>
      <CardHeader class="flex-row items-center justify-between border-b border-border">
        <div class="space-y-1">
          <CardTitle class="text-base">{{ $t("settings.replacements.title") }}</CardTitle>
          <p class="text-sm text-muted-foreground">
            {{ $t("settings.replacements.description") }}
          </p>
        </div>
        <Badge variant="secondary" data-testid="replacement-rule-count">
          {{ $t("settings.replacements.ruleCount", { count: replacementStore.ruleCount }) }}
        </Badge>
      </CardHeader>
      <CardContent class="space-y-5">
        <div class="rounded-lg border border-border p-4 space-y-4">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-sm font-medium">
              {{ isEditingReplacementRule ? $t("settings.replacements.editTitle") : $t("settings.replacements.addTitle") }}
            </h3>
            <Button
              v-if="isEditingReplacementRule"
              type="button"
              variant="ghost"
              size="sm"
              data-testid="replacement-cancel-edit"
              @click="resetReplacementForm"
            >
              <X class="mr-1 size-4" />
              {{ $t("common.cancel") }}
            </Button>
          </div>

          <div class="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div class="space-y-2">
              <Label for="replacement-patterns">
                {{ $t("settings.replacements.patternsLabel") }}
              </Label>
              <Textarea
                id="replacement-patterns"
                v-model="replacementForm.patternsText"
                class="min-h-[84px]"
                :placeholder="$t('settings.replacements.patternsPlaceholder')"
                data-testid="replacement-patterns-input"
              />
              <p class="text-xs text-muted-foreground">
                {{ $t("settings.replacements.patternsHint") }}
              </p>
            </div>

            <div class="space-y-2">
              <Label for="replacement-target">
                {{ $t("settings.replacements.replacementLabel") }}
              </Label>
              <Input
                id="replacement-target"
                v-model="replacementForm.replacement"
                :placeholder="$t('settings.replacements.replacementPlaceholder')"
                data-testid="replacement-target-input"
              />
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <div class="space-y-2">
              <Label for="replacement-timing">
                {{ $t("settings.replacements.timingLabel") }}
              </Label>
              <Select
                :model-value="replacementForm.timing"
                @update:model-value="handleReplacementTimingChange"
              >
                <SelectTrigger id="replacement-timing" data-testid="replacement-timing-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in replacementTimingOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div class="space-y-1">
                <Label for="replacement-regex">
                  {{ $t("settings.replacements.regexLabel") }}
                </Label>
                <p class="text-xs text-muted-foreground">
                  {{ $t("settings.replacements.regexHint") }}
                </p>
              </div>
              <Switch
                id="replacement-regex"
                :model-value="replacementForm.isRegex"
                data-testid="replacement-regex-switch"
                @update:model-value="replacementForm.isRegex = $event"
              />
            </div>

            <div class="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div class="space-y-1">
                <Label for="replacement-enabled">
                  {{ $t("settings.replacements.enabledLabel") }}
                </Label>
                <p class="text-xs text-muted-foreground">
                  {{ $t("settings.replacements.enabledHint") }}
                </p>
              </div>
              <Switch
                id="replacement-enabled"
                :model-value="replacementForm.enabled"
                data-testid="replacement-enabled-switch"
                @update:model-value="replacementForm.enabled = $event"
              />
            </div>
          </div>

          <SettingsActionRow :feedback="replacementFormFeedback.state.value">
            <Button
              type="button"
              :disabled="isSavingReplacementRule"
              data-testid="replacement-save-button"
              @click="handleSubmitReplacementRule"
            >
              <Pencil v-if="isEditingReplacementRule" class="mr-1 size-4" />
              <Plus v-else class="mr-1 size-4" />
              {{ isEditingReplacementRule ? $t("settings.replacements.updateButton") : $t("settings.replacements.addButton") }}
            </Button>
          </SettingsActionRow>
        </div>

        <InlineFeedback
          :feedback="replacementListFeedback.state.value"
          class="block"
          data-testid="replacement-list-feedback"
        />

        <div v-if="replacementStore.rules.length === 0" class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="replacement-empty-state">
          {{ $t("settings.replacements.emptyState") }}
        </div>

        <div v-else class="rounded-lg border border-border">
          <p class="border-b border-border px-4 py-2 text-xs text-muted-foreground" data-testid="replacement-apply-order-hint">
            {{ $t("settings.replacements.applyOrderHint") }}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead :aria-sort="replacementAriaSortFor('patterns')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="replacement-sort-patterns"
                    @click="toggleReplacementSort('patterns')"
                  >
                    {{ $t("settings.replacements.patternsHeader") }}
                    <component :is="replacementSortIconFor('patterns')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead :aria-sort="replacementAriaSortFor('replacement')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="replacement-sort-replacement"
                    @click="toggleReplacementSort('replacement')"
                  >
                    {{ $t("settings.replacements.replacementHeader") }}
                    <component :is="replacementSortIconFor('replacement')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead :aria-sort="replacementAriaSortFor('timing')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="replacement-sort-timing"
                    @click="toggleReplacementSort('timing')"
                  >
                    {{ $t("settings.replacements.timingHeader") }}
                    <component :is="replacementSortIconFor('timing')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead :aria-sort="replacementAriaSortFor('isRegex')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="replacement-sort-type"
                    @click="toggleReplacementSort('isRegex')"
                  >
                    {{ $t("settings.replacements.typeHeader") }}
                    <component :is="replacementSortIconFor('isRegex')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead :aria-sort="replacementAriaSortFor('enabled')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="replacement-sort-enabled"
                    @click="toggleReplacementSort('enabled')"
                  >
                    {{ $t("settings.replacements.enabledHeader") }}
                    <component :is="replacementSortIconFor('enabled')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead :aria-sort="replacementAriaSortFor('createdAt')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="replacement-sort-created-at"
                    @click="toggleReplacementSort('createdAt')"
                  >
                    {{ $t("settings.replacements.createdAtHeader") }}
                    <component :is="replacementSortIconFor('createdAt')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead class="text-right">{{ $t("settings.replacements.actionsHeader") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="rule in sortedReplacementRules"
                :key="rule.id"
                data-testid="replacement-rule-row"
              >
                <TableCell class="max-w-[220px]">
                  <div class="truncate font-medium" :title="rule.patterns.join(', ')">
                    {{ rule.patterns.join(", ") }}
                  </div>
                </TableCell>
                <TableCell class="max-w-[180px]">
                  <div class="truncate" :title="rule.replacement">
                    {{ rule.replacement }}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {{ $t(`settings.replacements.timing.${rule.timing}`) }}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="rule.isRegex ? 'secondary' : 'outline'">
                    {{ rule.isRegex ? $t("settings.replacements.regexBadge") : $t("settings.replacements.literalBadge") }}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Label :for="`replacement-rule-enabled-${rule.id}`" class="sr-only">
                    {{ $t("settings.replacements.enabledHeader") }}
                  </Label>
                  <Switch
                    :id="`replacement-rule-enabled-${rule.id}`"
                    :model-value="rule.enabled"
                    data-testid="replacement-row-enabled-switch"
                    @update:model-value="handleToggleReplacementRule(rule, $event)"
                  />
                </TableCell>
                <TableCell class="whitespace-nowrap text-sm text-muted-foreground">
                  <span data-testid="replacement-row-created-at" :title="rule.createdAt">
                    {{ formatReplacementCreatedAt(rule.createdAt) }}
                  </span>
                </TableCell>
                <TableCell>
                  <div class="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="replacement-edit-button"
                      @click="startEditingReplacementRule(rule)"
                    >
                      <Pencil class="mr-1 size-4" />
                      {{ $t("settings.replacements.edit") }}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          class="text-destructive hover:text-destructive"
                          data-testid="replacement-delete-button"
                        >
                          <Trash2 class="mr-1 size-4" />
                          {{ $t("common.delete") }}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {{ $t("settings.replacements.deleteConfirmTitle") }}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {{ $t("settings.replacements.deleteConfirmDescription") }}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            {{ $t("common.cancel") }}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            data-testid="replacement-delete-confirm"
                            @click="handleDeleteReplacementRule(rule)"
                          >
                            {{ $t("common.delete") }}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- 智慧字典學習（macOS: AXUIElement；Windows: UI Automation） -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.smartDictionary.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.smartDictionary.description") }}
        </p>

        <SettingsControlRow :feedback="smartDictionaryFeedback.state.value">
          <template #label>
            <Label for="smart-dictionary-toggle">{{ $t("settings.smartDictionary.title") }}</Label>
          </template>
          <Switch
            id="smart-dictionary-toggle"
            :model-value="settingsStore.isSmartDictionaryEnabled"
            @update:model-value="handleToggleSmartDictionary"
          />
        </SettingsControlRow>

        <p class="text-xs text-muted-foreground">
          {{ $t("settings.smartDictionary.privacyNote") }}
        </p>
      </CardContent>
    </Card>

    <!-- 情境注入（opt-in 隱私功能） -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.contextInjection.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.contextInjection.description") }}
        </p>

        <SettingsControlRow :feedback="contextInjectionFeedback.state.value">
          <template #label>
            <Label for="context-injection-toggle">{{ $t("settings.contextInjection.title") }}</Label>
          </template>
          <Switch
            id="context-injection-toggle"
            :model-value="settingsStore.contextInjectionEnabled"
            data-testid="context-injection-switch"
            @update:model-value="handleToggleContextInjection"
          />
        </SettingsControlRow>

        <p class="text-xs text-muted-foreground" data-testid="context-injection-privacy-note">
          {{ $t("settings.contextInjection.privacyNote") }}
        </p>
      </CardContent>
    </Card>

    <!-- 輸入裝置 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.audioInput.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.audioInput.description") }}
        </p>
        <div class="space-y-2">
          <div class="flex items-baseline">
            <Label for="audio-input-device">{{ $t("settings.audioInput.deviceLabel") }}</Label>
            <InlineFeedback :feedback="audioInputFeedback.state.value" class="ms-2" />
          </div>
          <div class="flex items-center gap-2">
            <Select
              :model-value="settingsStore.selectedAudioInputDeviceName || '_default'"
              @update:model-value="handleAudioInputDeviceChange($event === '_default' ? '' : ($event as string))"
            >
              <SelectTrigger id="audio-input-device" class="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">
                  {{
                    defaultInputDeviceName
                      ? $t("settings.audioInput.systemDefaultWithDevice", {
                        device: defaultInputDeviceName,
                      })
                      : $t("settings.audioInput.systemDefault")
                  }}
                </SelectItem>
                <SelectItem
                  v-for="device in audioInputDeviceList"
                  :key="device.name"
                  :value="device.name"
                >
                  {{ device.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              :disabled="isRefreshingDeviceList"
              @click="handleRefreshAudioInputDeviceList"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isRefreshingDeviceList }" />
            </Button>
          </div>
        </div>
        <div
          v-if="isPreviewActive"
          role="meter"
          :aria-valuenow="Math.round(previewLevel * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="$t('settings.audioInput.volumePreview')"
          class="flex items-center gap-2 h-5"
        >
          <Mic class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div class="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-75"
              :style="{ width: `${Math.round(previewLevel * 100)}%` }"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 錄音儲存管理 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.recording.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.recording.description") }}
        </p>

        <SettingsControlRow :feedback="recordingAutoCleanupFeedback.state.value">
          <template #label>
            <Label for="recording-auto-cleanup">{{ $t("settings.recording.autoCleanup") }}</Label>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground">{{ $t("settings.recording.autoCleanupDescription") }}</p>
          </template>
          <Switch
            id="recording-auto-cleanup"
            :model-value="recordingAutoCleanupEnabled"
            @update:model-value="handleToggleRecordingAutoCleanup"
          />
        </SettingsControlRow>

        <SettingsActionRow
          v-if="recordingAutoCleanupEnabled"
          :feedback="recordingCleanupDaysFeedback.state.value"
          align="start"
        >
          <Label for="cleanup-days">{{ $t("settings.recording.retentionDays") }}</Label>
          <Input
            id="cleanup-days"
            v-model.number="recordingAutoCleanupDays"
            type="number"
            min="1"
            class="w-24"
          />
          <span class="text-sm text-muted-foreground">{{ $t("settings.recording.daysUnit") }}</span>
          <Button
            size="sm"
            @click="handleSaveCleanupDays"
          >
            {{ $t("common.save") }}
          </Button>
        </SettingsActionRow>

        <div class="border-t border-border" />

        <SettingsActionRow :feedback="recordingDeleteFeedback.state.value" align="start">
          <AlertDialog>
            <AlertDialogTrigger as-child>
              <Button
                variant="destructive"
                :disabled="isDeletingRecordings"
              >
                <Trash2 class="h-4 w-4 mr-2" />
                {{ $t("settings.recording.deleteAll") }}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{{ $t("settings.recording.deleteConfirmTitle") }}</AlertDialogTitle>
                <AlertDialogDescription>
                  {{ $t("settings.recording.deleteConfirmDescription") }}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{{ $t("common.cancel") }}</AlertDialogCancel>
                <AlertDialogAction @click="handleDeleteAllRecordings">
                  {{ $t("common.delete") }}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsActionRow>
      </CardContent>
    </Card>

    <!-- 應用程式 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.app.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 佈景主題 -->
        <SettingsControlRow :feedback="themeFeedback.state.value">
          <template #label>
            <Label for="theme-select">{{ $t("settings.app.theme") }}</Label>
          </template>
          <Select
            :model-value="settingsStore.themeMode"
            @update:model-value="handleThemeChange($event as ThemeMode)"
          >
            <SelectTrigger id="theme-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="mode in THEME_MODE_VALUES"
                :key="mode"
                :value="mode"
              >
                {{ $t(`settings.app.theme_${mode}`) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsControlRow>

        <!-- 介面語言 -->
        <SettingsControlRow :feedback="localeFeedback.state.value">
          <template #label>
            <Label for="locale-select">{{ $t("settings.app.language") }}</Label>
          </template>
          <Select
            :model-value="settingsStore.selectedLocale"
            @update:model-value="handleLocaleChange($event as SupportedLocale)"
          >
            <SelectTrigger id="locale-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in LANGUAGE_OPTIONS"
                :key="opt.locale"
                :value="opt.locale"
              >
                {{ opt.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsControlRow>

        <!-- 轉錄語言 -->
        <SettingsControlRow :feedback="transcriptionLocaleFeedback.state.value">
          <template #label>
            <Label for="transcription-locale-select">{{ $t("settings.app.transcriptionLanguage") }}</Label>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.transcriptionLanguageDescription") }}</p>
          </template>
          <Select
            :model-value="settingsStore.selectedTranscriptionLocale"
            @update:model-value="handleTranscriptionLocaleChange($event as TranscriptionLocale)"
          >
            <SelectTrigger id="transcription-locale-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in TRANSCRIPTION_LANGUAGE_OPTIONS"
                :key="opt.locale"
                :value="opt.locale"
              >
                {{ opt.locale === 'auto' ? $t('settings.app.autoDetect') : opt.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsControlRow>

        <div class="border-t border-border" />

        <SettingsControlRow :feedback="muteOnRecordingFeedback.state.value">
          <template #label>
            <Label for="mute-on-recording">{{ $t("settings.app.muteOnRecording") }}</Label>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.muteDescription") }}</p>
          </template>
          <Switch
            id="mute-on-recording"
            :model-value="settingsStore.isMuteOnRecordingEnabled"
            @update:model-value="handleToggleMuteOnRecording"
          />
        </SettingsControlRow>

        <div class="border-t border-border" />

        <SettingsControlRow :feedback="copyTranscriptionToClipboardFeedback.state.value">
          <template #label>
            <Label for="copy-transcription-to-clipboard">{{
              $t("settings.app.copyTranscriptionToClipboard.label")
            }}</Label>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground">
              {{
                settingsStore.isCopyTranscriptionToClipboardEnabled
                  ? $t(
                    "settings.app.copyTranscriptionToClipboard.descriptionOn",
                  )
                  : $t(
                    "settings.app.copyTranscriptionToClipboard.descriptionOff",
                  )
              }}
            </p>
          </template>
          <Switch
            id="copy-transcription-to-clipboard"
            :model-value="settingsStore.isCopyTranscriptionToClipboardEnabled"
            @update:model-value="handleToggleCopyTranscriptionToClipboard"
          />
        </SettingsControlRow>

        <div class="border-t border-border" />

        <SettingsControlRow :feedback="soundFeedbackFeedback.state.value">
          <template #label>
            <Label for="sound-feedback">{{ $t("settings.app.soundFeedback") }}</Label>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.soundFeedbackDescription") }}</p>
          </template>
          <Switch
            id="sound-feedback"
            :model-value="settingsStore.isSoundEffectsEnabled"
            @update:model-value="handleToggleSoundFeedback"
          />
        </SettingsControlRow>

        <template v-if="isMac">
          <div class="border-t border-border" />

          <SettingsControlRow :feedback="hideDockIconFeedback.state.value">
            <template #label>
              <Label for="hide-dock-icon">{{ $t("settings.app.hideDockIcon") }}</Label>
            </template>
            <template #description>
              <p class="text-sm text-muted-foreground">{{ $t("settings.app.hideDockIconDescription") }}</p>
            </template>
            <Switch
              id="hide-dock-icon"
              :model-value="settingsStore.isHideDockIconEnabled"
              :disabled="isHideDockIconPending"
              @update:model-value="handleToggleHideDockIcon"
            />
          </SettingsControlRow>
        </template>

        <div class="border-t border-border" />

        <SettingsControlRow :feedback="autoStartFeedback.state.value">
          <template #label>
            <Label for="auto-start">{{ $t("settings.app.autoStart") }}</Label>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.autoStartDescription") }}</p>
          </template>
          <Switch
            id="auto-start"
            :model-value="settingsStore.isAutoStartEnabled"
            :disabled="isTogglingAutoStart"
            @update:model-value="handleToggleAutoStart"
          />
        </SettingsControlRow>
      </CardContent>
    </Card>

    <!-- 備份與還原 -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("settings.backup.title") }}</CardTitle>
        <p class="text-sm text-muted-foreground">
          {{ $t("settings.backup.description") }}
        </p>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- 匯出 -->
        <div class="space-y-4">
          <h3 class="text-sm font-medium text-foreground">
            {{ $t("settings.backup.exportSection") }}
          </h3>

          <div class="flex items-center gap-2">
            <Checkbox
              id="backup-export-settings"
              :model-value="exportSettingsSelected"
              @update:model-value="(v) => (exportSettingsSelected = v === true)"
            />
            <Label for="backup-export-settings" class="cursor-pointer">
              {{ $t("settings.backup.includeSettings") }}
            </Label>
          </div>

          <div class="flex items-center gap-2">
            <Checkbox
              id="backup-export-dictionary"
              :model-value="exportDictionarySelected"
              @update:model-value="(v) => (exportDictionarySelected = v === true)"
            />
            <Label for="backup-export-dictionary" class="cursor-pointer">
              {{ $t("settings.backup.includeDictionary") }}
            </Label>
          </div>

          <div class="flex items-center gap-2">
            <Checkbox
              id="backup-exclude-keys"
              :model-value="excludeKeysSelected"
              :disabled="!exportSettingsSelected"
              @update:model-value="(v) => (excludeKeysSelected = v === true)"
            />
            <Label
              for="backup-exclude-keys"
              class="cursor-pointer"
              :class="{ 'opacity-50': !exportSettingsSelected }"
            >
              {{ $t("settings.backup.excludeKeys") }}
            </Label>
          </div>

          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Lock class="h-4 w-4 text-muted-foreground" />
              <Label for="backup-encrypt">{{ $t("settings.backup.encrypt") }}</Label>
            </div>
            <Switch
              id="backup-encrypt"
              :model-value="encryptEnabled"
              @update:model-value="(v) => (encryptEnabled = v === true)"
            />
          </div>

          <div v-if="encryptEnabled" class="space-y-2">
            <Label for="backup-password">{{ $t("settings.backup.password") }}</Label>
            <Input
              id="backup-password"
              v-model="exportPassword"
              type="password"
              autocomplete="new-password"
              :placeholder="$t('settings.backup.passwordPlaceholder')"
            />
            <Input
              id="backup-password-confirm"
              v-model="exportPasswordConfirm"
              type="password"
              autocomplete="new-password"
              :placeholder="$t('settings.backup.passwordConfirmPlaceholder')"
            />
            <p v-if="exportPasswordMismatch" class="text-sm text-destructive">
              {{ $t("settings.backup.passwordMismatch") }}
            </p>
          </div>

          <div
            v-if="showPlaintextKeyWarning"
            class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
          >
            <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p class="text-sm text-destructive">
              {{ $t("settings.backup.plaintextWarning") }}
            </p>
          </div>

          <SettingsActionRow :feedback="backupExportFeedback.state.value" align="start">
            <Button
              :disabled="!canExport || isExporting"
              @click="handleBackupExport"
            >
              <Download class="mr-1 h-4 w-4" />{{ $t("settings.backup.exportButton") }}
            </Button>
          </SettingsActionRow>
        </div>

        <div class="border-t border-border" />

        <!-- 匯入 -->
        <div class="space-y-4">
          <div class="flex items-baseline">
            <h3 class="text-sm font-medium text-foreground">
              {{ $t("settings.backup.importSection") }}
            </h3>
            <InlineFeedback :feedback="backupImportFeedback.state.value" class="ms-2" />
          </div>

          <Button
            variant="outline"
            :disabled="isImporting || isRecording"
            @click="triggerBackupImport"
          >
            <Upload class="mr-1 h-4 w-4" />{{ $t("settings.backup.chooseFile") }}
          </Button>

          <div v-if="parsedBackup" class="space-y-4 rounded-md border border-border p-4">
            <p class="text-sm text-muted-foreground">
              {{ $t("settings.backup.fileLoaded") }}
            </p>

            <div class="flex items-center gap-2">
              <Checkbox
                id="backup-import-settings"
                :model-value="importSettingsSelected"
                :disabled="!importHasSettings"
                @update:model-value="(v) => (importSettingsSelected = v === true)"
              />
              <Label
                for="backup-import-settings"
                class="cursor-pointer"
                :class="{ 'opacity-50': !importHasSettings }"
              >
                {{ $t("settings.backup.restoreSettings") }}
              </Label>
            </div>

            <div class="flex items-center gap-2">
              <Checkbox
                id="backup-import-dictionary"
                :model-value="importDictionarySelected"
                :disabled="!importHasDictionary"
                @update:model-value="(v) => (importDictionarySelected = v === true)"
              />
              <Label
                for="backup-import-dictionary"
                class="cursor-pointer"
                :class="{ 'opacity-50': !importHasDictionary }"
              >
                {{ $t("settings.backup.restoreDictionary") }}
              </Label>
            </div>

            <div v-if="importedIsEncrypted" class="space-y-2">
              <Label for="backup-import-password">
                {{ $t("settings.backup.password") }}
              </Label>
              <Input
                id="backup-import-password"
                v-model="importPassword"
                type="password"
                autocomplete="off"
                :placeholder="$t('settings.backup.importPasswordPlaceholder')"
              />
            </div>

            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button :disabled="!canApplyImport || isImporting || isRecording">
                  {{ $t("settings.backup.importButton") }}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ $t("settings.backup.confirmTitle") }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ $t("settings.backup.confirmDescription") }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{{ $t("common.cancel") }}</AlertDialogCancel>
                  <AlertDialogAction @click="applyBackupImport">
                    {{ $t("settings.backup.importButton") }}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <Separator />

        <div class="space-y-3">
          <h3 class="text-sm font-medium text-foreground">
            {{ $t("settings.backup.dictImportSection") }}
          </h3>
          <p class="text-sm text-muted-foreground">
            {{ $t("settings.backup.dictImportDescription") }}
          </p>
          <SettingsActionRow :feedback="backupDictionaryImportFeedback.state.value" align="start">
            <Button
              variant="outline"
              :disabled="isDictionaryImporting || isRecording"
              @click="handleExternalDictionaryImport"
            >
              <Upload class="mr-1 h-4 w-4" />{{ $t("settings.backup.dictImportButton") }}
            </Button>
          </SettingsActionRow>
        </div>
      </CardContent>
    </Card>

    <!-- 進階：除錯記錄（Debug Log）-->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base flex items-center gap-2">
          <Bug class="h-4 w-4" />
          {{ $t("settings.debugLog.title") }}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.debugLog.description") }}
        </p>

        <SettingsControlRow :feedback="debugLogToggleFeedback.state.value">
          <template #label>
            <Label for="debug-log-enabled">{{ $t("settings.debugLog.enable") }}</Label>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground">{{ $t("settings.debugLog.enableDescription") }}</p>
          </template>
          <Switch
            id="debug-log-enabled"
            :model-value="debugLogEnabled"
            @update:model-value="handleToggleDebugLog"
          />
        </SettingsControlRow>

        <SettingsActionRow
          v-if="debugLogEnabled"
          :feedback="debugLogDaysFeedback.state.value"
          align="start"
        >
          <Label for="debug-log-days">{{ $t("settings.debugLog.retentionDays") }}</Label>
          <Input
            id="debug-log-days"
            v-model.number="debugLogRetentionDays"
            type="number"
            min="1"
            class="w-24"
          />
          <span class="text-sm text-muted-foreground">{{ $t("settings.debugLog.daysUnit") }}</span>
          <Button size="sm" @click="handleSaveDebugLogDays">
            {{ $t("common.save") }}
          </Button>
        </SettingsActionRow>

        <div class="border-t border-border" />

        <SettingsActionRow :feedback="debugLogFolderFeedback.state.value" align="start">
          <Button variant="outline" @click="handleOpenLogFolder">
            <FolderOpen class="h-4 w-4 mr-2" />
            {{ $t("settings.debugLog.openFolder") }}
          </Button>
        </SettingsActionRow>
      </CardContent>
    </Card>
  </div>
</template>
