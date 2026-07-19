---
applyTo: "src-tauri/**/*.rs"
---

# Rust / Tauri backend 規則

適用 `src-tauri/**/*.rs`。全域規則見 `.github/copilot-instructions.md`。

## Command 註冊

- 每個 `#[command]` 寫在 `src/plugins/<module>.rs`，**必須**在 `src/lib.rs` 的 `generate_handler!` 註冊——**漏註冊 → 前端 `invoke()` 會 timeout**。
- 功能切在 `src/plugins/*.rs`：`hotkey_listener`、`clipboard_paste`、`audio_recorder`、`transcription`、`keyboard_monitor`、`audio_control`、`text_field_reader`、`sound_feedback`、`azure_auth`、`logging`、`file_transfer`。
- 變更 IPC（Command/Event）後用 **`ipc-review` / `tauri-reviewer` subagent** 審查 Rust↔Vue 對齊（Command 註冊、Event 名稱、Payload 型別）。

## 錯誤處理

- Command 回 `Result<T, E>`；錯誤 enum 以 `serialize_str` 序列化成**純字串**（前端 reject 收到的是字串、不是物件，故前端須 `extractErrorMessage` 正規化）。

## 網路

- 轉錄 HTTP client 用 **rustls**：`transcription.rs` `TranscriptionState::new()` 以 `.use_rustls_tls()` 建 reqwest；`Cargo.toml` reqwest features 須同時保留 `rustls-tls` **與** `rustls-tls-native-roots`（Windows native-tls/schannel 會截斷大型 multipart upload → Azure 回 HTTP 400）。Groq 與 Azure Whisper 共用此 client。
- `transcription.rs` / `azure_auth.rs` 用 reqwest 直連，**不**受 `capabilities/default.json` allowlist 約束（僅前端 HTTP 受）。`get_azure_entra_token` 用 reqwest 取 token（不帶 browser `Origin`，避免 `AADSTS9002326`）。

## Windows 專屬（硬規則）

- **Copilot 鍵 `VK_F23`(0x86)**：`hotkey_listener.rs` 低階鍵盤 hook 取出 `kbd` 後須**立刻放行** F23（`if kbd.vkCode == VK_F23 { return CallNextHookEx(...); }`），禁止開放為自訂熱鍵（見 `docs/adr-windows-vk-f23.md`）。
- **`windows` crate 0.61**：`AttachThreadInput` 從 `Win32::UI::Input::KeyboardAndMouse` 搬到 `Win32::System::Threading`（Cargo.toml features 需含 `Win32_System_Threading`）；`BOOL` 是 `windows::core::BOOL`；UI Automation 需 feature `Win32_UI_Accessibility`。
- macOS 本地 `cargo check` **不編譯** `#[cfg(target_os="windows")]` 區塊，Windows hook 須靠 CI / 實機驗證。

## 驗證

- `cd src-tauri && cargo test --workspace`（單一測試：`cargo test <fn>`）。
- `cargo clippy --workspace --all-targets -- -D warnings`（CI 在 macOS + Windows 跑）。
- 編輯後跑 `cargo fmt`。
