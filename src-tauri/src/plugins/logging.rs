//! 除錯記錄（Debug Log）相關 command。
//!
//! 檔案 Log 由官方 `tauri-plugin-log` 寫入 `app_log_dir()`；本模組提供：
//! - `FILE_LOG_ENABLED`：執行期開關旗標，由 plugin-log 的 `.filter` 讀取（見 `lib.rs`）。
//! - `set_file_logging_enabled`：前端設定開關時即時切換（免重啟）。
//! - `open_log_folder`：以系統檔案管理員開啟 Log 資料夾。
//! - `cleanup_old_logs`：刪除超過 N 天的舊 Log 檔（鏡像 `audio_recorder::cleanup_old_recordings`）。

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{command, AppHandle, Manager};

/// 檔案 Log 開關旗標。預設關閉，由前端 `set_file_logging_enabled` 設定。
/// `tauri-plugin-log` 的 `.filter` 會讀取此旗標決定是否處理 log record。
pub static FILE_LOG_ENABLED: AtomicBool = AtomicBool::new(false);

/// plugin-log 的 LogDir 檔名基底（不含副檔名）。active 檔為 `{LOG_FILE_NAME}.log`，
/// rotated 檔為 `{LOG_FILE_NAME}_<date>.log`。`lib.rs` 設定 LogDir target 時共用此常數，
/// `cleanup_old_logs` 也用它判斷 active 檔以避免誤刪。
pub const LOG_FILE_NAME: &str = "sayit";

/// 設定是否開啟檔案 Log 記錄（即時生效，免重啟）。
#[command]
pub fn set_file_logging_enabled(enabled: bool) {
    FILE_LOG_ENABLED.store(enabled, Ordering::Relaxed);
    log::info!(
        "[logging] File logging {}",
        if enabled { "enabled" } else { "disabled" }
    );
}

/// 以系統檔案管理員開啟 Log 資料夾（macOS `open`、Windows `explorer`）。
#[command]
pub fn open_log_folder(app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log dir: {e}"))?;

    // 首次尚未產生任何 log 時資料夾可能不存在，先建立避免開啟失敗。
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 刪除超過 `days` 天的舊 `.log` 檔，回傳已刪除的檔名清單。
///
/// 目前正在寫入的 log 檔 mtime 為近期，不會落在 cutoff 之前，因此不會被刪到；
/// 單一檔案刪除失敗（例如 Windows 檔案鎖定）僅記錄警告並繼續，不中斷整批清理。
#[command]
pub fn cleanup_old_logs(days: u32, app: AppHandle) -> Result<Vec<String>, String> {
    // 防呆：days=0 會把 cutoff 設成現在，刪掉所有非 active log；至少保留 1 天。
    let days = days.max(1);

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log dir: {e}"))?;

    if !log_dir.exists() {
        return Ok(vec![]);
    }

    let active_file = format!("{LOG_FILE_NAME}.log");
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(u64::from(days) * 24 * 60 * 60);

    let mut deleted_name_list: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(&log_dir).map_err(|e| format!("Failed to read log dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "log") {
            continue;
        }
        // 永不刪除 plugin-log 目前寫入中的 active 檔（避免 unlink 開啟中的檔案造成 log 不可見）
        if path.file_name().and_then(|s| s.to_str()) == Some(active_file.as_str()) {
            continue;
        }
        let metadata =
            std::fs::metadata(&path).map_err(|e| format!("Failed to get metadata: {e}"))?;
        let modified = metadata
            .modified()
            .map_err(|e| format!("Failed to get modified time: {e}"))?;
        if modified < cutoff {
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                        deleted_name_list.push(name.to_string());
                    }
                }
                Err(e) => {
                    log::warn!("[logging] Failed to delete {}: {}", path.display(), e);
                }
            }
        }
    }

    log::info!(
        "[logging] Cleaned up {} old log files (>{} days)",
        deleted_name_list.len(),
        days
    );
    Ok(deleted_name_list)
}
