<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BookOpen,
  Download,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Settings,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";
import SiteHeader from "./components/SiteHeader.vue";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFeedbackMessage } from "./composables/useFeedbackMessage";
import InlineFeedback from "./components/InlineFeedback.vue";
import { listenToEvent, VOCABULARY_CHANGED } from "./composables/useTauriEvents";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useVocabularyStore } from "./stores/useVocabularyStore";
import { captureError } from "./lib/sentry";
import { getDatabaseInitError } from "./lib/database";
import { getAutoCheckRetryDelayMs } from "./lib/updateRetryPolicy";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { UpdateCheckResult } from "./lib/autoUpdater";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;
const { t } = useI18n();

const navItems = computed(() => [
  { path: "/dashboard", label: t("mainApp.nav.dashboard"), icon: markRaw(LayoutDashboard) },
  { path: "/history", label: t("mainApp.nav.history"), icon: markRaw(FileText) },
  { path: "/dictionary", label: t("mainApp.nav.dictionary"), icon: markRaw(BookOpen) },
  { path: "/settings", label: t("mainApp.nav.settings"), icon: markRaw(Settings) },
  { path: "/guide", label: t("mainApp.nav.guide"), icon: markRaw(Lightbulb) },
]);

const route = useRoute();
const currentPageTitle = computed(() => {
  const item = navItems.value.find((n) => route.path.startsWith(n.path));
  return item?.label ?? "SayIt";
});

// 必須在 app.mount() 後讀取 — setDatabaseInitError 在 bootstrap catch 中已設定
const databaseError = ref(getDatabaseInitError());
const showAccessibilityGuide = ref(false);

// ── 更新相關狀態 ──
type UpdateUiState = "idle" | "checking" | "downloading" | "ready-to-install" | "installing";
const updateState = ref<UpdateUiState>("idle");
const availableVersion = ref("");
const updateFeedback = useFeedbackMessage();
const AUTO_CHECK_INITIAL_DELAY_MS = 5_000;
let autoCheckTimeoutId: ReturnType<typeof setTimeout> | null = null;
let autoCheckRetryAttempt = 0;

// AlertDialog 控制
const showManualUpdateDialog = ref(false);
const showAutoInstallDialog = ref(false);

// 升級提示（watch 而非 onMounted，因為 loadSettings 在 mount 之後才執行）
const settingsStore = useSettingsStore();
const showUpgradeNoticeDialog = ref(false);
const upgradeNoticeItemCount = 3;
watch(() => settingsStore.showPromptUpgradeNotice, (shouldShow) => {
  if (shouldShow) {
    showUpgradeNoticeDialog.value = true;
    settingsStore.showPromptUpgradeNotice = false;
  }
});

// ── 流程 1：自動偵測（靜默檢查 → 靜默下載 → 通知安裝） ──
// 每次 App 啟動只跑一次；僅在「檢查失敗」時做有限次退避重試。
async function autoCheckAndDownload() {
  // 這個排程已觸發（或本次是啟動首檢）→ 標記為「目前無待執行的自動檢查」，
  // 讓 autoCheckTimeoutId 能忠實代表階梯是否還有排程在等
  autoCheckTimeoutId = null;

  if (updateState.value !== "idle") return;

  // 佔用 checking 狀態，避免與 Sidebar「檢查更新」同時執行而競爭
  // autoUpdater 內的全域 pendingUpdate（可能覆蓋掉已下載好的 Update 物件）
  updateState.value = "checking";

  try {
    const { checkForAppUpdate, downloadUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();

    // checkForAppUpdate 不會拋錯，失敗會回傳 status: "error"，
    // 這裡必須自行處理，否則唯一一次檢查失敗就等於本次啟動再也不檢查更新
    if (result.status === "error") {
      updateState.value = "idle";
      scheduleAutoCheckRetry(result.error);
      return;
    }

    // 檢查成功（不論有無更新）→ 階梯歸零，日後若再失敗可重新獲得完整 1／5／15 額度
    autoCheckRetryAttempt = 0;

    if (result.status !== "update-available" || !result.version) {
      updateState.value = "idle";
      return;
    }

    availableVersion.value = result.version;
    updateState.value = "downloading";

    await downloadUpdate();

    updateState.value = "ready-to-install";

    // 確保 Dashboard 可見再彈 dialog
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();

    showAutoInstallDialog.value = true;
  } catch (err) {
    // 只有「檢查階段」失敗才排重試；已進入下載／彈窗階段代表網路是通的，
    // 重試只會造成重複下載與重複搶焦點的安裝提示
    const failedWhileChecking = updateState.value === "checking";

    console.error("[main-window] Auto update check/download failed:", err);
    captureError(err, { source: "updater", step: "auto-check" });
    updateState.value = "idle";

    if (failedWhileChecking) {
      scheduleAutoCheckRetry(err instanceof Error ? err.message : String(err));
    }
  }
}

/** 排下一次自動重試；次數用盡則回報遙測後停止（本次啟動不再自動檢查）。 */
function scheduleAutoCheckRetry(reason?: string) {
  // 階梯已有排程在等（例如手動檢查失敗時自動重試還沒輪到）：讓它跑完就好。
  // 不重排可避免把剩餘等待時間重設，也避免誤報「已用盡」
  if (autoCheckTimeoutId !== null) return;

  const delayMs = getAutoCheckRetryDelayMs(autoCheckRetryAttempt);

  if (delayMs === null) {
    // 重試用盡且確實沒有排程在等：本次啟動不再自動檢查，
    // 回報以免「靜默永久失效」查無線索
    captureError(
      new Error(`Auto update check failed after all retries: ${reason ?? "unknown"}`),
      { source: "updater", step: "auto-check-retry-exhausted" },
    );
    return;
  }

  autoCheckRetryAttempt += 1;
  autoCheckTimeoutId = setTimeout(autoCheckAndDownload, delayMs);
}

function cancelPendingAutoCheck() {
  if (autoCheckTimeoutId) {
    clearTimeout(autoCheckTimeoutId);
    autoCheckTimeoutId = null;
  }
}

// 使用者在自動流程的 AlertDialog 中點「安裝並重啟」
async function handleAutoInstall() {
  showAutoInstallDialog.value = false;
  updateState.value = "installing";
  try {
    const { installAndRelaunch } = await import("./lib/autoUpdater");
    await installAndRelaunch();
  } catch (err) {
    console.error("[main-window] Auto install failed:", err);
    updateFeedback.show("error", t("mainApp.update.installFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// 使用者在自動流程的 AlertDialog 中點「稍後」
function handleAutoInstallLater() {
  showAutoInstallDialog.value = false;
  // 保持 ready-to-install 狀態，sidebar 仍顯示「立即安裝」按鈕
}

// sidebar footer 的「立即安裝」按鈕（自動下載完成後顯示）
async function handleSidebarInstall() {
  showAutoInstallDialog.value = true;
}

// ── 流程 2：手動檢查更新 ──
async function handleManualCheck() {
  if (updateState.value !== "idle" && updateState.value !== "ready-to-install") return;

  // 如果已有待安裝的更新，直接彈 dialog
  if (updateState.value === "ready-to-install") {
    showAutoInstallDialog.value = true;
    return;
  }

  updateState.value = "checking";
  try {
    const { checkForAppUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();

    if (result.status === "error") {
      // 手動檢查也失敗（多半仍離線）：重新武裝自動重試階梯。
      // 若在此直接取消待執行的重試，自動更新會在本次啟動就此永久停擺
      scheduleAutoCheckRetry(result.error);
    } else {
      // 檢查成功代表網路已通，待執行的自動重試已無意義；階梯一併歸零
      cancelPendingAutoCheck();
      autoCheckRetryAttempt = 0;
    }

    handleManualCheckResult(result);
  } catch (err) {
    console.error("[main-window] Manual update check failed:", err);
    captureError(err, { source: "updater", step: "manual-check" });
    updateFeedback.show("error", t("mainApp.update.checkError"));
    updateState.value = "idle";
    scheduleAutoCheckRetry(err instanceof Error ? err.message : String(err));
  }
}

function handleManualCheckResult(result: UpdateCheckResult) {
  if (result.status === "up-to-date") {
    updateFeedback.show("success", t("mainApp.update.upToDate"));
    updateState.value = "idle";
  } else if (result.status === "update-available") {
    availableVersion.value = result.version ?? "";
    updateState.value = "idle";
    showManualUpdateDialog.value = true;
  } else {
    updateFeedback.show("error", t("mainApp.update.checkFailed"));
    updateState.value = "idle";
  }
}

// 使用者在手動流程的 AlertDialog 中點「開始更新」
async function handleManualUpdate() {
  showManualUpdateDialog.value = false;
  updateState.value = "downloading";
  try {
    const { downloadInstallAndRelaunch } = await import("./lib/autoUpdater");
    await downloadInstallAndRelaunch();
  } catch (err) {
    console.error("[main-window] Manual update failed:", err);
    updateFeedback.show("error", t("mainApp.update.updateFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// ── Sidebar footer 顯示邏輯 ──
const updateButtonLabel = computed(() => {
  switch (updateState.value) {
    case "checking": return t("mainApp.update.checking");
    case "downloading": return t("mainApp.update.downloading");
    case "installing": return t("mainApp.update.installing");
    default: return t("mainApp.update.checkUpdate");
  }
});

const isUpdateBusy = computed(() =>
  updateState.value === "checking" ||
  updateState.value === "downloading" ||
  updateState.value === "installing"
);


const vocabularyStore = useVocabularyStore();
let unlistenVocabularyChanged: UnlistenFn | null = null;

onMounted(async () => {
  // 更新檢查排在最前面：後面的 await（事件監聽、權限檢查）若拋錯，
  // 不能連帶讓這個 App process 永遠不排程更新檢查
  autoCheckTimeoutId = setTimeout(autoCheckAndDownload, AUTO_CHECK_INITIAL_DELAY_MS);

  // 監聽詞彙變更（HUD 視窗 AI 新增詞彙時同步 Dashboard）
  unlistenVocabularyChanged = await listenToEvent(VOCABULARY_CHANGED, () => {
    console.log("[main-window] VOCABULARY_CHANGED received, refreshing termList");
    void vocabularyStore.fetchTermList();
  });

  // macOS 無障礙權限檢查
  const isMacOS = navigator.userAgent.includes("Macintosh");
  if (isMacOS) {
    try {
      const hasAccessibilityPermission = await invoke<boolean>(
        "check_accessibility_permission_command",
      );
      showAccessibilityGuide.value = !hasAccessibilityPermission;
    } catch (error) {
      console.error(
        "[main-window] Failed to check accessibility permission:",
        error,
      );
      captureError(error, { source: "accessibility", step: "check-permission" });
    }
  }
});

onUnmounted(() => {
  unlistenVocabularyChanged?.();
  cancelPendingAutoCheck();
});
</script>

<template>
  <!-- macOS Overlay 自訂標題列：fixed z-20 蓋住 Sidebar(z-10)，整條可拖動 -->
  <div
    data-tauri-drag-region
    class="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background"
  >
    <span data-tauri-drag-region class="text-xs font-medium text-muted-foreground select-none">SayIt - 言</span>
  </div>

  <SidebarProvider class="h-screen !min-h-0 pt-9">
    <Sidebar collapsible="offcanvas">
      <SidebarHeader class="flex-row h-12 items-center gap-3 border-b border-sidebar-border px-4">
        <img src="@/assets/logo-yan.png" alt="言" class="h-7 w-auto" />
        <span class="text-base font-semibold text-sidebar-foreground tracking-wide" style="font-family: 'SF Pro Display', 'Inter', system-ui, sans-serif;">SayIt</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in navItems" :key="item.path">
                <SidebarMenuButton
                  as-child
                  :is-active="route.path.startsWith(item.path)"
                >
                  <RouterLink :to="item.path">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="border-t border-sidebar-border px-4 py-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">v{{ appVersion }}</span>
          <!-- ready-to-install 時不顯示檢查按鈕，改顯示安裝提示 -->
          <Button
            v-if="updateState !== 'ready-to-install'"
            variant="link"
            class="h-auto p-0 text-xs text-muted-foreground"
            :disabled="isUpdateBusy"
            @click="handleManualCheck"
          >
            {{ updateButtonLabel }}
          </Button>
        </div>
        <!-- 自動下載完成：顯示持久的安裝提示 -->
        <div v-if="updateState === 'ready-to-install'" class="mt-1.5 flex items-center justify-between rounded-md bg-primary/10 px-2 py-1.5">
          <span class="text-xs font-medium text-primary">v{{ availableVersion }} {{ $t("mainApp.update.ready") }}</span>
          <Button
            size="sm"
            class="h-6 gap-1 px-2 text-xs"
            @click="handleSidebarInstall"
          >
            <Download class="h-3 w-3" />
            {{ $t("mainApp.update.installNow") }}
          </Button>
        </div>
        <div class="mt-1 min-h-4">
          <InlineFeedback
            :feedback="updateFeedback.state.value"
            class="block text-xs"
          />
        </div>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="overflow-hidden">
      <SiteHeader :title="currentPageTitle" />
      <div
        v-if="databaseError"
        class="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p class="font-medium">{{ $t("errors.databaseInitFailed") }}</p>
        <p class="mt-1 text-xs text-destructive/80">{{ databaseError }}</p>
      </div>
      <div class="flex-1 overflow-y-auto">
        <RouterView />
      </div>
    </SidebarInset>
  </SidebarProvider>

  <AccessibilityGuide
    :visible="showAccessibilityGuide"
    @close="showAccessibilityGuide = false"
  />

  <!-- 自動流程 AlertDialog：更新已下載，詢問是否安裝重啟 -->
  <AlertDialog :open="showAutoInstallDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.autoInstallTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t("mainApp.update.autoInstallDescription", { version: availableVersion }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="handleAutoInstallLater">{{ $t("mainApp.update.later") }}</AlertDialogCancel>
        <AlertDialogAction @click="handleAutoInstall">{{ $t("mainApp.update.installRestart") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 升級提示 AlertDialog -->
  <AlertDialog :open="showUpgradeNoticeDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.upgradeNotice.title") }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <ol class="mt-2 space-y-3 text-sm text-muted-foreground list-decimal list-inside">
            <li v-for="i in upgradeNoticeItemCount" :key="i">
              {{ $t(`mainApp.upgradeNotice.item${i}`) }}
            </li>
          </ol>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction @click="showUpgradeNoticeDialog = false">{{ $t("mainApp.upgradeNotice.dismiss") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 手動流程 AlertDialog：發現新版本，詢問是否開始更新 -->
  <AlertDialog :open="showManualUpdateDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.newVersionTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t("mainApp.update.newVersionDescription", { version: availableVersion }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="showManualUpdateDialog = false">{{ $t("mainApp.update.cancel") }}</AlertDialogCancel>
        <AlertDialogAction @click="handleManualUpdate">{{ $t("mainApp.update.startUpdate") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
