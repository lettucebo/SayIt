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

impl OsKeyring {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, account: &str) -> Result<keyring::v1::Entry, String> {
        keyring::v1::Entry::new(&self.service, account).map_err(|e| e.to_string())
    }
}

impl KeyringBackend for OsKeyring {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>, String> {
        match self.entry(account)?.get_secret() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::v1::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, account: &str, value: &[u8]) -> Result<(), String> {
        self.entry(account)?
            .set_secret(value)
            .map_err(|e| e.to_string())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
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
        if manifest.chunks > MAX_CHUNKS {
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

        // 舊 generation 清理失敗不影響正確性（manifest 已指向新的），僅留下孤兒項目。
        if let Some(old) = previous {
            self.purge_generation(key, &old.generation, old.chunks);
        }
        Ok(())
    }

    /// 刪除 manifest 與兩個 generation 的所有分段（含可能殘留的孤兒）。
    pub fn delete(&self, key: &str) -> Result<(), SecretStoreError> {
        let manifest = self.read_manifest(key)?;
        self.backend
            .delete(&manifest_account(key))
            .map_err(SecretStoreError::Unavailable)?;
        let known = manifest.map(|m| m.chunks).unwrap_or(MAX_CHUNKS);
        for generation in ["a", "b"] {
            self.purge_generation(key, generation, known.max(MAX_CHUNKS));
        }
        Ok(())
    }

    fn purge_generation(&self, key: &str, generation: &str, chunks: usize) {
        for i in 0..chunks.min(MAX_CHUNKS) {
            let _ = self.backend.delete(&chunk_account(key, generation, i));
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
    }

    impl FakeKeyring {
        fn fail_after(n: usize) -> Self {
            let f = Self::default();
            *f.fail_set_after.lock().unwrap() = Some(n);
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
            self.data
                .lock()
                .unwrap()
                .insert(account.to_string(), value.to_vec());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
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
    fn rejects_secret_beyond_max_chunks() {
        let store = SecretStore::new(FakeKeyring::default());
        let huge = secret_of(CHUNK_SIZE * (MAX_CHUNKS + 1));
        assert!(matches!(
            store.save("acct", &huge),
            Err(SecretStoreError::TooLarge(_))
        ));
    }
}
