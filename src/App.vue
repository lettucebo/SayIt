<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AzureAuthStateChangedPayload } from "./types/events";
import NotchHud from "./components/NotchHud.vue";
import { Window } from "@tauri-apps/api/window";
import { useVoiceFlowStore } from "./stores/useVoiceFlowStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useVocabularyStore } from "./stores/useVocabularyStore";
import { useReplacementStore } from "./stores/useReplacementStore";
import { connectToDatabase } from "./lib/database";
import {
  listenToEvent,
  SETTINGS_UPDATED,
  VOCABULARY_CHANGED,
  REPLACEMENTS_CHANGED,
  AZURE_AUTH_STATE_CHANGED,
  waitForDatabaseReady,
} from "./composables/useTauriEvents";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const voiceFlowStore = useVoiceFlowStore();
const settingsStore = useSettingsStore();
const vocabularyStore = useVocabularyStore();
const replacementStore = useReplacementStore();
let unlistenSettingsUpdated: UnlistenFn | null = null;
let unlistenAzureAuthChanged: UnlistenFn | null = null;
let unlistenVocabularyChanged: UnlistenFn | null = null;
let unlistenReplacementsChanged: UnlistenFn | null = null;

const promptModeLabel = computed(() => {
  const mode = settingsStore.promptMode;
  switch (mode) {
    case "minimal":
      return t("settings.prompt.modeMinimal");
    case "active":
      return t("settings.prompt.modeActive");
    case "custom":
      return t("settings.prompt.modeCustom");
    default:
      return "";
  }
});

onMounted(async () => {
  console.log("[App] Mounted, initializing voice flow...");

  // 設定變更監聽須在任何 await 前註冊，避免啟動期錯過 Dashboard 的主題/設定同步
  unlistenSettingsUpdated = await listenToEvent(SETTINGS_UPDATED, () => {
    void settingsStore.refreshCrossWindowSettings();
  });

  // Dashboard 完成 Entra 登入/登出後，HUD 必須同步帳號快照——否則
  // hasWhisperConfig / hasLlmApiKey 會一直停在登入前的狀態直到 App 重啟。
  //
  // 明確為「未登入」時直接套用 payload，不回頭重讀憑證庫：登入失效
  //（需要重新互動）時憑證仍然存在，重讀會把帳號又變回「已登入」，
  // 使用者就會一直看到可用、實際每次都失敗。
  unlistenAzureAuthChanged = await listenToEvent<AzureAuthStateChangedPayload>(
    AZURE_AUTH_STATE_CHANGED,
    (event) => {
      if (event.payload?.signedIn === false) {
        settingsStore.clearAzureUserAccountSnapshot();
        return;
      }
      // 對方剛登入成功 → 解除本視窗的「需要重新登入」標記再重讀
      settingsStore.clearAzureUserReauthFlag();
      void settingsStore.refreshAzureUserAccount();
    },
  );

  // 初始化 DB（供 vocabularyStore 使用）
  let isDatabaseReady = false;
  try {
    // 等 Dashboard 完成 migration 再存取連線池，避免併發破壞 migration。
    // 逾時（Dashboard 缺席或 migration 過久）才 fallback 直接連線；
    // connectToDatabase() 自帶 retry，HUD 的 DB 讀取亦各有錯誤處理。
    const databaseReady = await waitForDatabaseReady();
    if (!databaseReady) {
      console.warn("[App] DATABASE_READY 逾時，改用 connectToDatabase fallback");
    }
    await connectToDatabase();
    isDatabaseReady = true;
  } catch (err) {
    console.error("[App] Database init failed:", err);
  }

  // 載入詞彙（供 transcriber + enhancer 使用），DB 初始化失敗時跳過
  if (isDatabaseReady) {
    try {
      await vocabularyStore.fetchTermList();
    } catch (err) {
      console.error("[App] Vocabulary fetch failed:", err);
    }
  }

  // 監聽詞彙變更（Main Window 新增/刪除詞彙時同步）
  unlistenVocabularyChanged = await listenToEvent(
    VOCABULARY_CHANGED,
    () => {
      void vocabularyStore.fetchTermList();
    },
  );

  unlistenReplacementsChanged = await listenToEvent(
    REPLACEMENTS_CHANGED,
    () => {
      void replacementStore.reload();
    },
  );

  try {
    await invoke("set_hud_visibility", {
      visible: true,
      clickThrough: true,
    });
  } catch (err) {
    console.error("[App] startup: show HUD failed:", err);
  }
  await voiceFlowStore.initialize();

  // 啟動時直接顯示 main-window（dashboard），然後隱藏 overlay
  try {
    const mainWindow = await Window.getByLabel("main-window");
    if (mainWindow) {
      await mainWindow.show();
      await mainWindow.setFocus();
    }
  } catch (err) {
    console.error("[App] startup: show main-window failed:", err);
  }

  try {
    await invoke("set_hud_visibility", {
      visible: false,
      clickThrough: true,
    });
  } catch (err) {
    console.error("[App] startup: hide HUD failed:", err);
  }
});

function handleRetry() {
  void voiceFlowStore.handleRetryTranscription();
}

onUnmounted(() => {
  unlistenSettingsUpdated?.();
  unlistenAzureAuthChanged?.();
  unlistenVocabularyChanged?.();
  unlistenReplacementsChanged?.();
  voiceFlowStore.cleanup();
});
</script>

<template>
  <div class="h-screen w-screen bg-transparent">
    <NotchHud
      :status="voiceFlowStore.status"
      :message="voiceFlowStore.message"
      :recording-elapsed-seconds="voiceFlowStore.recordingElapsedSeconds"
      :can-retry="voiceFlowStore.canRetry"
      :prompt-mode-label="promptModeLabel"
      :mode-switch-label="voiceFlowStore.modeSwitchLabel"
      :is-edit-mode="voiceFlowStore.isEditMode"
      @retry="handleRetry"
    />
  </div>
</template>
