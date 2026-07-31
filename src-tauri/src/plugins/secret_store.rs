//! OS 原生憑證儲存（Windows Credential Manager / macOS Keychain）。
//!
//! ## 為什麼需要分段
//!
//! 實測 Windows Credential Manager 的上限：
//!   - `set_password`（字串，內部轉 UTF-16）→ **1280 字元**
//!   - `set_secret`（二進位）→ **2560 bytes**
//!
//! 而 Entra 的 refresh token 實測約 1500–1700 bytes，包成 JSON 後更大。
//! 字串模式必定寫入失敗，二進位模式雖然放得下但裕度不足 1.5 倍，
//! 因此一律走二進位 + 分段。
//!
//! ## 為什麼需要 A/B generation
//!
//! refresh token 會在每次續期時輪替。若採「就地覆寫各段、最後才更新段數」，
//! 過程中斷（當機／keychain 拒絕）會讓 manifest 指向半新半舊的分段，
//! 讀回來是一段無效字串——使用者只會看到「莫名其妙要重新登入」。
//!
//! 因此改為：寫入完整的新 generation → 讀回驗證 SHA-256 → 原子換掉 manifest
//! → 才刪除舊 generation。任何一步失敗，舊資料都仍然完整可用。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// 單段大小。低於實測的 2560 bytes 上限，保留餘裕給不同平台的實作差異。
const CHUNK_SIZE: usize = 2048;
/// 分段數上限（約 64KB）。防止損壞的 manifest 造成大量無謂的 keychain 讀取。
const MAX_CHUNKS: usize = 32;

#[derive(Debug, thiserror::Error)]
pub enum SecretStoreError {
    #[error("secret store unavailable: {0}")]
    Unavailable(String),
    #[error("secret too large: {0} bytes")]
    TooLarge(usize),
    #[error("stored secret is corrupted")]
    Corrupted,
}

/// 描述目前有效的那一份資料。換掉這筆等於原子切換 generation。
#[derive(Serialize, Deserialize)]
struct Manifest {
    /// "a" 或 "b"
    generation: String,
    chunks: usize,
    len: usize,
    /// 明文的 SHA-256（hex）。讀回時比對，可測出分段遺失或殘缺。
    sha256: String,
}

/// keychain 後端。抽成 trait 讓單元測試能用假的實作，
/// 不去污染開發者機器上真實的 Credential Manager / Keychain。
pub trait KeyringBackend: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>, String>;
    fn set(&self, account: &str, value: &[u8]) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

pub struct OsKeyring {
    service: String,
}

/// 平台憑證庫只需初始化一次。
static STORE_INIT: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();

/// 明確設定 keyring-core 的預設 store。
///
/// 不走 `keyring` crate 的 v1 相容層，因為那一層不提供 entry modifier，
/// 而 Windows 憑證管理員的 persistence 只能逐筆用 modifier 指定
/// （store 層的 `new_with_configuration` 只支援 prefix/divider/suffix）。
fn ensure_store() -> Result<(), String> {
    STORE_INIT
        .get_or_init(|| {
            #[cfg(target_os = "windows")]
            {
                let store =
                    windows_native_keyring_store::Store::new().map_err(|e| e.to_string())?;
                keyring_core::set_default_store(store);
            }
            #[cfg(target_os = "macos")]
            {
                let store = apple_native_keyring_store::keychain::Store::new()
                    .map_err(|e| e.to_string())?;
                keyring_core::set_default_store(store);
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                return Err("no credential store for this platform".to_string());
            }
            #[allow(unreachable_code)]
            Ok(())
        })
        .clone()
}

impl OsKeyring {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, account: &str) -> Result<keyring_core::Entry, String> {
        ensure_store()?;
        let mut modifiers: HashMap<&str, &str> = HashMap::new();
        // Windows 憑證管理員預設是 Enterprise persistence——那會讓憑證隨
        // 使用者設定檔漫遊到其他機器。refresh token 不該離開這台裝置，
        // 因此明確指定 Local。（實測預設值確實是 Enterprise。）
        #[cfg(target_os = "windows")]
        modifiers.insert("persistence", "Local");
        keyring_core::Entry::new_with_modifiers(&self.service, account, &modifiers)
            .map_err(|e| e.to_string())
    }
}

impl KeyringBackend for OsKeyring {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>, String> {
        match self.entry(account)?.get_secret() {
            Ok(v) => Ok(Some(v)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, account: &str, value: &[u8]) -> Result<(), String> {
        let entry = self.entry(account)?;
        // Windows 把 Enterprise（會隨設定檔漫遊）與 Local 的憑證存在**兩個獨立的
        // 儲存區**，同一個 target_name 可同時存在於兩者；此時寫入會落在 Local，
        // 讀取卻可能一直拿到舊的 Enterprise 版，造成「寫入看似成功卻讀到舊值」。
        // 因此先把非 Local 的殘留刪乾淨再寫。用迴圈是因為一次 delete 只會移除
        // 其中一筆，理論上可能兩邊都有。
        #[cfg(target_os = "windows")]
        {
            for _ in 0..4 {
                match entry.get_attributes() {
                    Ok(attrs) if attrs.get("persistence").map(|s| s.as_str()) != Some("Local") => {
                        if entry.delete_credential().is_err() {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        }
        entry.set_secret(value).map_err(|e| e.to_string())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        let entry = self.entry(account)?;
        // 同上：同一 target_name 可能在 Enterprise 與 Local 兩區各有一筆，
        // 只刪一次會留下殘留，之後讀取仍可能拿到舊值。刪到沒有為止（有上限）。
        for _ in 0..4 {
            match entry.delete_credential() {
                Ok(()) => continue,
                Err(keyring_core::Error::NoEntry) => return Ok(()),
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }
}

pub struct SecretStore<B: KeyringBackend> {
    backend: B,
}

fn manifest_account(key: &str) -> String {
    format!("{key}::meta")
}

fn chunk_account(key: &str, generation: &str, index: usize) -> String {
    format!("{key}::{generation}::{index}")
}

fn digest_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

impl<B: KeyringBackend> SecretStore<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    fn read_manifest(&self, key: &str) -> Result<Option<Manifest>, SecretStoreError> {
        let raw = self
            .backend
            .get(&manifest_account(key))
            .map_err(SecretStoreError::Unavailable)?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        // manifest 壞掉時視為「沒有資料」而非硬錯：使用者重新登入即可自我修復。
        Ok(serde_json::from_slice::<Manifest>(&raw).ok())
    }

    /// 讀出明文。找不到回 `None`；資料殘缺回 `Corrupted`（呼叫端應要求重新登入）。
    pub fn load(&self, key: &str) -> Result<Option<String>, SecretStoreError> {
        let Some(manifest) = self.read_manifest(key)? else {
            return Ok(None);
        };
        // 上限檢查同時涵蓋段數與總長：損壞或被竄改的 manifest 若宣稱一個
        // 巨大的 len，`with_capacity` 會直接吃掉大量記憶體甚至讓程序被 OOM 終止。
        if manifest.chunks > MAX_CHUNKS || manifest.len > CHUNK_SIZE * MAX_CHUNKS {
            return Err(SecretStoreError::Corrupted);
        }

        let mut buf = Vec::with_capacity(manifest.len);
        for i in 0..manifest.chunks {
            let account = chunk_account(key, &manifest.generation, i);
            let chunk = self
                .backend
                .get(&account)
                .map_err(SecretStoreError::Unavailable)?
                .ok_or(SecretStoreError::Corrupted)?;
            buf.extend_from_slice(&chunk);
        }

        if buf.len() != manifest.len || digest_hex(&buf) != manifest.sha256 {
            return Err(SecretStoreError::Corrupted);
        }
        String::from_utf8(buf)
            .map(Some)
            .map_err(|_| SecretStoreError::Corrupted)
    }

    /// 原子寫入：新 generation 完整寫好並驗證通過，才切換 manifest。
    pub fn save(&self, key: &str, secret: &str) -> Result<(), SecretStoreError> {
        let bytes = secret.as_bytes();
        let chunks: Vec<&[u8]> = if bytes.is_empty() {
            Vec::new()
        } else {
            bytes.chunks(CHUNK_SIZE).collect()
        };
        if chunks.len() > MAX_CHUNKS {
            return Err(SecretStoreError::TooLarge(bytes.len()));
        }

        let previous = self.read_manifest(key)?;
        let next_generation = match previous.as_ref().map(|m| m.generation.as_str()) {
            Some("a") => "b",
            _ => "a",
        };

        for (i, chunk) in chunks.iter().enumerate() {
            self.backend
                .set(&chunk_account(key, next_generation, i), chunk)
                .map_err(SecretStoreError::Unavailable)?;
        }

        // 切換 manifest 前先讀回驗證，確保這份 generation 真的完整可用。
        let mut verify = Vec::with_capacity(bytes.len());
        for i in 0..chunks.len() {
            let chunk = self
                .backend
                .get(&chunk_account(key, next_generation, i))
                .map_err(SecretStoreError::Unavailable)?
                .ok_or(SecretStoreError::Corrupted)?;
            verify.extend_from_slice(&chunk);
        }
        if verify != bytes {
            return Err(SecretStoreError::Corrupted);
        }

        let manifest = Manifest {
            generation: next_generation.to_string(),
            chunks: chunks.len(),
            len: bytes.len(),
            sha256: digest_hex(bytes),
        };
        let encoded = serde_json::to_vec(&manifest).map_err(|e| {
            SecretStoreError::Unavailable(format!("failed to encode manifest: {e}"))
        })?;
        self.backend
            .set(&manifest_account(key), &encoded)
            .map_err(SecretStoreError::Unavailable)?;

        // 讀回驗證 manifest —— backend 回 Ok **不等於**資料真的落地。
        // 實例：Windows 憑證管理員無法就地變更既有憑證的 persistence，
        // CredWrite 會回成功卻不套用，寫入等同靜默失效。若不驗證就往下
        // 清除舊 generation，manifest 會指向已被刪掉的資料 → 必然損毀。
        // 驗證失敗就中止並保留舊 generation，讓舊資料仍然完整可讀。
        let written = self
            .backend
            .get(&manifest_account(key))
            .map_err(SecretStoreError::Unavailable)?;
        if written.as_deref() != Some(encoded.as_slice()) {
            return Err(SecretStoreError::Corrupted);
        }

        // 舊 generation 清理失敗不影響正確性（manifest 已確認指向新的），僅留下孤兒項目。
        if let Some(old) = previous {
            let _ = self.purge_generation(key, &old.generation);
        }
        Ok(())
    }

    /// 刪除 manifest 與兩個 generation 的所有分段（含可能殘留的孤兒）。
    ///
    /// **順序刻意是「先清分段、再刪 manifest」**：真正的祕密在分段裡，manifest
    /// 只是中繼資料。若先刪 manifest 又中途以 `?` 提早返回，最敏感的那批資料
    /// 反而會因為最不敏感的那筆失敗而留下；而呼叫端接著就會把 tenant/client
    /// 從設定移除，屆時再也算不出 key，殘留的 refresh token 就永遠清不掉。
    /// 因此全程收集失敗而不提早返回，manifest 讀不到時退化成掃描兩個 generation。
    pub fn delete(&self, key: &str) -> Result<(), SecretStoreError> {
        let mut failures: Vec<String> = Vec::new();

        // manifest 讀不到（損毀／後端暫時失敗）不該中止清除，改為全掃
        if let Err(e) = self.read_manifest(key) {
            failures.push(format!("manifest unreadable: {e}"));
        }

        for generation in ["a", "b"] {
            if let Err(e) = self.purge_generation(key, generation) {
                failures.push(e);
            }
        }

        if let Err(e) = self.backend.delete(&manifest_account(key)) {
            failures.push(format!("manifest: {e}"));
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(SecretStoreError::Unavailable(format!(
                "failed to fully remove stored credential: {}",
                failures.join("; ")
            )))
        }
    }

    /// 清掉某個 generation 的所有分段。回報失敗數量，呼叫端決定是否視為錯誤。
    fn purge_generation(&self, key: &str, generation: &str) -> Result<(), String> {
        let mut failed = 0usize;
        for i in 0..MAX_CHUNKS {
            if self
                .backend
                .delete(&chunk_account(key, generation, i))
                .is_err()
            {
                failed += 1;
            }
        }
        if failed == 0 {
            Ok(())
        } else {
            Err(format!("{failed} chunk(s) in generation {generation}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeKeyring {
        data: Mutex<HashMap<String, Vec<u8>>>,
        /// 大於 0 時，第 N 次 `set` 會失敗——用來模擬寫到一半中斷。
        fail_set_after: Mutex<Option<usize>>,
        set_calls: Mutex<usize>,
        /// true 時所有 `delete` 都失敗——用來模擬憑證庫拒絕刪除。
        fail_delete: Mutex<bool>,
        /// 命中此 account 時，`set` 回 Ok 但**不真的寫入**——重現 Windows
        /// 無法就地變更 persistence 時 CredWrite「回成功卻沒生效」的行為。
        silently_ignore_set: Mutex<Option<String>>,
    }

    impl FakeKeyring {
        fn fail_after(n: usize) -> Self {
            let f = Self::default();
            *f.fail_set_after.lock().unwrap() = Some(n);
            f
        }

        fn failing_delete() -> Self {
            let f = Self::default();
            *f.fail_delete.lock().unwrap() = true;
            f
        }

        fn silently_ignoring(account_suffix: &str) -> Self {
            let f = Self::default();
            *f.silently_ignore_set.lock().unwrap() = Some(account_suffix.to_string());
            f
        }
    }

    impl KeyringBackend for FakeKeyring {
        fn get(&self, account: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(self.data.lock().unwrap().get(account).cloned())
        }

        fn set(&self, account: &str, value: &[u8]) -> Result<(), String> {
            let mut calls = self.set_calls.lock().unwrap();
            *calls += 1;
            if let Some(limit) = *self.fail_set_after.lock().unwrap() {
                if *calls > limit {
                    return Err("simulated keyring failure".to_string());
                }
            }
            // 回 Ok 但不寫入：重現 CredWrite 靜默失效
            if let Some(suffix) = self.silently_ignore_set.lock().unwrap().as_deref() {
                if account.ends_with(suffix) {
                    return Ok(());
                }
            }
            self.data
                .lock()
                .unwrap()
                .insert(account.to_string(), value.to_vec());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            if *self.fail_delete.lock().unwrap() {
                return Err("simulated delete failure".to_string());
            }
            self.data.lock().unwrap().remove(account);
            Ok(())
        }
    }

    fn secret_of(len: usize) -> String {
        (0..len).map(|i| (b'a' + (i % 26) as u8) as char).collect()
    }

    #[test]
    fn round_trips_secret_larger_than_single_chunk() {
        let store = SecretStore::new(FakeKeyring::default());
        // 實測 Entra refresh token 約 1635 bytes；這裡刻意用跨多段的長度
        let secret = secret_of(5000);
        store.save("acct", &secret).unwrap();
        assert_eq!(store.load("acct").unwrap(), Some(secret));
    }

    #[test]
    fn round_trips_realistic_refresh_token_length() {
        let store = SecretStore::new(FakeKeyring::default());
        let secret = secret_of(1635);
        store.save("acct", &secret).unwrap();
        assert_eq!(store.load("acct").unwrap(), Some(secret));
    }

    #[test]
    fn missing_entry_returns_none() {
        let store = SecretStore::new(FakeKeyring::default());
        assert_eq!(store.load("acct").unwrap(), None);
    }

    #[test]
    fn rotation_alternates_generation() {
        let store = SecretStore::new(FakeKeyring::default());
        store.save("acct", "first").unwrap();
        store.save("acct", "second").unwrap();
        store.save("acct", "third").unwrap();
        assert_eq!(store.load("acct").unwrap(), Some("third".to_string()));
    }

    #[test]
    fn interrupted_write_leaves_previous_value_readable() {
        // 先寫入一份完好的資料，再讓後續寫入中途失敗
        let backend = FakeKeyring::default();
        let store = SecretStore::new(backend);
        store.save("acct", "original").unwrap();

        // 用同一份資料重建 store，但這次限制 set 次數以模擬中斷
        let data = store.backend.data.lock().unwrap().clone();
        let failing = FakeKeyring::fail_after(1);
        *failing.data.lock().unwrap() = data;
        let store2 = SecretStore::new(failing);

        let long = secret_of(5000);
        assert!(store2.save("acct", &long).is_err());
        // manifest 未被切換 → 舊值仍然完整
        assert_eq!(store2.load("acct").unwrap(), Some("original".to_string()));
    }

    #[test]
    fn missing_chunk_reports_corrupted() {
        let store = SecretStore::new(FakeKeyring::default());
        store.save("acct", &secret_of(5000)).unwrap();
        store.backend.data.lock().unwrap().remove("acct::a::1");
        assert!(matches!(
            store.load("acct"),
            Err(SecretStoreError::Corrupted)
        ));
    }

    #[test]
    fn tampered_chunk_reports_corrupted() {
        let store = SecretStore::new(FakeKeyring::default());
        store.save("acct", &secret_of(5000)).unwrap();
        store
            .backend
            .data
            .lock()
            .unwrap()
            .insert("acct::a::1".to_string(), b"tampered".to_vec());
        assert!(matches!(
            store.load("acct"),
            Err(SecretStoreError::Corrupted)
        ));
    }

    #[test]
    fn delete_removes_everything() {
        let store = SecretStore::new(FakeKeyring::default());
        store.save("acct", &secret_of(5000)).unwrap();
        store.delete("acct").unwrap();
        assert_eq!(store.load("acct").unwrap(), None);
        assert!(store.backend.data.lock().unwrap().is_empty());
    }

    #[test]
    fn delete_failure_is_reported_not_swallowed() {
        // 登出若宣稱成功卻留下可用的 refresh token，使用者會以為已經清乾淨。
        // Microsoft 不會因為輪替就立刻讓舊 token 失效，殘留物仍可能有效。
        let backend = FakeKeyring::default();
        let store = SecretStore::new(backend);
        store.save("acct", "secret-value").unwrap();

        let data = store.backend.data.lock().unwrap().clone();
        let failing = FakeKeyring::failing_delete();
        *failing.data.lock().unwrap() = data;
        let store2 = SecretStore::new(failing);

        assert!(
            store2.delete("acct").is_err(),
            "delete failure must surface to the caller"
        );
    }

    #[test]
    fn corrupted_manifest_length_is_rejected() {
        // 被竄改的 manifest 若宣稱巨大的 len，with_capacity 會吃掉大量記憶體
        let store = SecretStore::new(FakeKeyring::default());
        store.save("acct", "small").unwrap();
        let bogus = serde_json::json!({
            "generation": "a",
            "chunks": 1,
            "len": usize::MAX,
            "sha256": "deadbeef",
        });
        store.backend.data.lock().unwrap().insert(
            "acct::meta".to_string(),
            serde_json::to_vec(&bogus).unwrap(),
        );
        assert!(matches!(
            store.load("acct"),
            Err(SecretStoreError::Corrupted)
        ));
    }

    #[test]
    fn rejects_secret_beyond_max_chunks() {
        let store = SecretStore::new(FakeKeyring::default());
        let huge = secret_of(CHUNK_SIZE * (MAX_CHUNKS + 1));
        assert!(matches!(
            store.save("acct", &huge),
            Err(SecretStoreError::TooLarge(_))
        ));
    }

    #[test]
    fn delete_failure_still_purges_the_actual_secret_chunks() {
        // 真正的祕密在分段裡，manifest 只是中繼資料。舊實作先刪 manifest 且
        // 以 `?` 提早返回，最敏感的資料反而會因為最不敏感的那筆失敗而留下；
        // 呼叫端接著刪掉 tenant/client 後就再也算不出 key 來清除。
        struct ManifestDeleteFails(FakeKeyring);
        impl KeyringBackend for ManifestDeleteFails {
            fn get(&self, a: &str) -> Result<Option<Vec<u8>>, String> {
                self.0.get(a)
            }
            fn set(&self, a: &str, v: &[u8]) -> Result<(), String> {
                self.0.set(a, v)
            }
            fn delete(&self, a: &str) -> Result<(), String> {
                if a.ends_with("::meta") {
                    return Err("simulated manifest delete failure".to_string());
                }
                self.0.delete(a)
            }
        }

        let seed = SecretStore::new(FakeKeyring::default());
        seed.save("acct", &secret_of(3000)).unwrap();
        let data = seed.backend.data.lock().unwrap().clone();

        let inner = FakeKeyring::default();
        *inner.data.lock().unwrap() = data;
        let store = SecretStore::new(ManifestDeleteFails(inner));

        // 應回報失敗（manifest 沒刪掉）……
        assert!(store.delete("acct").is_err());

        // ……但真正的祕密分段必須已經清乾淨
        let left = store.backend.0.data.lock().unwrap();
        let secret_chunks: Vec<_> = left
            .keys()
            .filter(|k| !k.ends_with("::meta"))
            .cloned()
            .collect();
        assert!(
            secret_chunks.is_empty(),
            "secret chunks must be purged even when manifest delete fails, left: {secret_chunks:?}"
        );
    }

    #[test]
    fn silently_ignored_manifest_write_does_not_destroy_previous_value() {
        // 真實事故重現：Windows 無法就地變更既有憑證的 persistence，
        // CredWrite 回報成功卻沒有生效。若不驗證 manifest 就清除舊 generation，
        // manifest 會指向已被刪掉的資料 —— 使用者的登入狀態直接損毀。
        let backend = FakeKeyring::default();
        let store = SecretStore::new(backend);
        store.save("acct", "original-secret").unwrap();
        let data = store.backend.data.lock().unwrap().clone();
        let before = store.load("acct").unwrap();
        assert_eq!(before.as_deref(), Some("original-secret"));

        // 換一個「meta 寫入會被靜默忽略」的 backend
        let ignoring = FakeKeyring::silently_ignoring("::meta");
        *ignoring.data.lock().unwrap() = data;
        let store2 = SecretStore::new(ignoring);

        // 寫入必須失敗，而不是回報成功後留下損毀狀態
        assert!(
            store2.save("acct", "rotated-secret").is_err(),
            "manifest write that did not land must be reported as an error"
        );

        // 關鍵：舊值必須仍然完整可讀（沒有被清掉）
        assert_eq!(
            store2.load("acct").unwrap().as_deref(),
            Some("original-secret"),
            "previous generation must survive a failed manifest update"
        );
    }
}
