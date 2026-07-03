//! 使用量分析（Aptabase）：隱私優先的匿名產品分析（DAU/MAU、版本/OS 分布、功能事件）。
//!
//! 隱私硬規則：本模組送出的事件屬性「只能」是匿名的枚舉字串與數值 metadata。
//! 絕不可包含任何轉錄／LLM 文字、字典詞、API key／Azure 憑證／Entra token、
//! 其他 App 文字、剪貼簿、欄位文字、檔案路徑或主機名。
//!
//! 開關（opt-out）鏡射 logging::FILE_LOG_ENABLED 模式：以 ANALYTICS_ENABLED
//! AtomicBool 為單一真相，於 setup 期從 settings.json 的 analyticsEnabled
//! 載入初始值，並由前端 set_analytics_enabled command 即時切換。

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_aptabase::EventTracker;

/// 使用量分析開關。預設啟用（opt-out）；完全匿名且可於設定關閉。
pub static ANALYTICS_ENABLED: AtomicBool = AtomicBool::new(true);

/// 是否於編譯期提供了 APTABASE_KEY（與 lib.rs 條件註冊一致）。
///
/// tauri-plugin-aptabase 1.0.0 的 track_event/flush 內部以 `state()` 取用 client，
/// plugin 未註冊時會 panic；因此無 key 時所有埋點都必須先在此把關而直接 no-op。
fn aptabase_configured() -> bool {
    option_env!("APTABASE_KEY")
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.starts_with("__"))
        .is_some()
}

/// 前端切換使用量分析開關（即時生效）。關閉後 track 立即停止送出事件。
#[tauri::command]
pub fn set_analytics_enabled(enabled: bool) {
    ANALYTICS_ENABLED.store(enabled, Ordering::Relaxed);
    log::info!(
        "[analytics] usage analytics {}",
        if enabled { "enabled" } else { "disabled" }
    );
}

/// 統一埋點入口：僅在已設定 key 且使用者未關閉分析時送出事件。
///
/// 隱私硬規則：props 僅允許匿名枚舉／數值 metadata，嚴禁任何機密或文字內容。
pub fn track(app: &AppHandle, name: &str, props: Option<Value>) {
    if !aptabase_configured() || !ANALYTICS_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    if let Err(err) = app.track_event(name, props) {
        log::warn!("[analytics] track_event '{name}' failed: {err}");
    }
}

/// 送出無自訂屬性的事件（便捷版）。
pub fn track_simple(app: &AppHandle, name: &str) {
    track(app, name, None);
}

/// 阻塞式 flush 佇列中的分析事件。用於 shutdown 前確保送出
/// （_exit(0) 會跳過所有 Drop，須顯式呼叫）。
pub fn flush(app: &AppHandle) {
    if !aptabase_configured() {
        return;
    }
    app.flush_events_blocking();
}
