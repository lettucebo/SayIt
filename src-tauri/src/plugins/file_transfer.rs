//! 通用文字檔讀寫指令，供備份匯出／匯入使用。
//!
//! 路徑由前端原生對話框（`@tauri-apps/plugin-dialog`）取得後傳入，
//! 實際檔案 I/O 在 Rust 端以 `std::fs` 執行，符合本專案「Rust 處理檔案 I/O」慣例
//! （對照 `audio_recorder::save_recording_file`），亦避開 `plugin-fs` 的 scope 設定。

use std::io::Read;

/// 備份檔大小上限（位元組），對齊前端 `settingsTransfer.ts` 的 `MAX_BACKUP_FILE_BYTES`。
const MAX_BACKUP_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// 將文字內容寫入指定路徑（覆寫）。
#[tauri::command]
pub fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {e}"))
}

/// 讀取指定路徑的文字檔。
///
/// 以開啟後的 handle metadata 確認為一般檔案並檢查大小，再以 cap 後的 reader
/// （`take(MAX + 1)`）讀取——即使 metadata 檢查與實際讀取之間檔案被替換（TOCTOU），
/// 也不會讀入超過上限的內容。超過上限回傳符號錯誤 `"FILE_TOO_LARGE"`
/// （前端據此對應 `settings.backup.errorTooLarge`）。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let file = std::fs::File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
    let metadata = file
        .metadata()
        .map_err(|e| format!("Failed to read file metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("Not a regular file".to_string());
    }
    if metadata.len() > MAX_BACKUP_FILE_BYTES {
        return Err("FILE_TOO_LARGE".to_string());
    }
    let mut buf = Vec::new();
    file.take(MAX_BACKUP_FILE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if buf.len() as u64 > MAX_BACKUP_FILE_BYTES {
        return Err("FILE_TOO_LARGE".to_string());
    }
    String::from_utf8(buf).map_err(|_| "Invalid UTF-8 in file".to_string())
}
