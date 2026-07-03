import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { listenToEvent, SETTINGS_UPDATED } from "../composables/useTauriEvents";
import type { SettingsUpdatedPayload } from "../types/events";

// 使用量分析（Aptabase）前端埋點。
//
// 隱私硬規則：事件屬性「只能」是匿名的枚舉字串與數值 metadata。
// 絕不可包含轉錄／LLM 文字、字典詞、API key／Azure 憑證、剪貼簿、
// 欄位文字、檔案路徑等任何機密或使用者內容。
//
// 送出實作走 Rust plugin command（plugin:aptabase|track_event），由 Rust 端
// 以 reqwest 發送，因此不受 CSP / http allowlist 約束。若編譯期未提供
// APTABASE_KEY，plugin 未註冊 → command 不存在 → invoke reject → 靜默忽略。

const STORE_NAME = "settings.json";

/** 允許送出的匿名事件名。 */
export type AnalyticsEvent =
  | "transcription_completed"
  | "transcription_failed"
  | "vocabulary_learned"
  | "provider_changed"
  | "screen_view";

/** 事件屬性僅允許匿名 string／number（Aptabase 限制 + 隱私硬規則）。 */
export type AnalyticsProps = Record<string, string | number>;

let enabled = true;
let initialized = false;

/** 從持久化設定載入 opt-out 狀態，並監聽跨視窗切換。冪等。 */
export async function initAnalytics(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const store = await load(STORE_NAME);
    enabled = (await store.get<boolean>("analyticsEnabled")) ?? true;
  } catch {
    enabled = true;
  }

  try {
    await listenToEvent<SettingsUpdatedPayload>(SETTINGS_UPDATED, (event) => {
      if (event?.payload?.key === "analyticsEnabled") {
        enabled = event.payload.value === true;
      }
    });
  } catch {
    // 無 Tauri 環境（如測試，listenToEvent 未 mock）或監聽失敗時忽略，不影響主流程。
  }
}

/** 送出匿名使用量事件。永不 throw；analytics 不可影響主流程。 */
export function trackEvent(name: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!enabled) return;
  try {
    void invoke("plugin:aptabase|track_event", {
      name,
      props: props ?? null,
    }).catch(() => {
      // 無 APTABASE_KEY（plugin 未註冊）或送出失敗時靜默忽略。
    });
  } catch {
    // 無 Tauri 環境（如測試，invoke 未 mock）時靜默忽略。
  }
}

void initAnalytics();
