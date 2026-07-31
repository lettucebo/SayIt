//! Entra 使用者委派登入的執行期狀態：token 快取、refresh 生命週期、Tauri commands。
//!
//! ## 為什麼快取放 Rust 而不是前端
//!
//! HUD 與 Dashboard 是兩個獨立的 WebView，若各自持有一份 token 快取，
//! 就會有兩份 refresh 節奏；Entra 的 refresh token 每次使用都會輪替，
//! 兩邊各自輪替會互相覆蓋彼此的持久化結果。Rust 是唯一的真實來源。
//!
//! ## 併發
//!
//! 每個帳號一把 `tokio::sync::Mutex`，涵蓋「讀憑證庫 → 查快取 → refresh →
//! 寫回憑證庫 → 更新快取」整段，而不只是 refresh 本身；否則兩個視窗同時
//! 進來仍會各自 refresh 並互相覆蓋。keyring 是同步 API，一律走 `spawn_blocking`。

use super::azure_user_auth::{
    account_key, bind_loopback, build_authorize_url, generate_pkce, open_in_browser,
    parse_account_from_id_token, random_url_safe, sign_in_timeout, validate_client_id,
    validate_tenant_id, wait_for_callback, AzureUserAccount, AzureUserAuthError, ScopeKind,
    StoredSession,
};
use super::secret_store::{OsKeyring, SecretStore, SecretStoreError};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tauri::command;
use tokio::sync::{Mutex as AsyncMutex, Notify};

/// OS 憑證庫的 service 名稱。dev build 用不同名稱，避免開發時覆蓋正式登入狀態。
#[cfg(debug_assertions)]
const KEYRING_SERVICE: &str = "com.sayit.app.dev";
#[cfg(not(debug_assertions))]
const KEYRING_SERVICE: &str = "com.sayit.app";

/// 提前多久視為過期。避免請求送出當下剛好跨過到期線。
const EXPIRY_SKEW: Duration = Duration::from_secs(60);
const TOKEN_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

#[derive(Default)]
pub struct AzureUserAuthState {
    /// key = `{accountKey}::{scopeKind}`
    tokens: StdMutex<HashMap<String, CachedToken>>,
    /// 每個帳號一把鎖，序列化 refresh / 持久化 / 登出
    locks: StdMutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    /// 進行中的登入（同時只允許一個）
    pending: StdMutex<Option<PendingSignIn>>,
}

struct PendingSignIn {
    operation_id: String,
    cancel: Arc<CancelSignal>,
}

/// 取消訊號。
///
/// 不能只用 `Notify::notify_waiters()`：它不保留 permit，而使用者按下取消的
/// 時機很可能落在「已建立 pending，但 `tokio::select!` 的取消分支尚未 arm」
/// 之間（bind loopback、開瀏覽器那段），該次取消會被靜默丟棄，使用者得多等
/// 五分鐘才等到 timeout。改以「旗標 + notify_one（會保留 permit）」組合，
/// 讓任何先後順序都能正確收到取消。
#[derive(Default)]
struct CancelSignal {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancelSignal {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }

    async fn cancelled(&self) {
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return;
            }
            self.notify.notified().await;
        }
    }
}

impl AzureUserAuthState {
    fn lock_for(&self, key: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self.locks.lock().unwrap();
        locks.entry(key.to_string()).or_default().clone()
    }

    fn cached(&self, key: &str, scope: ScopeKind) -> Option<String> {
        let tokens = self.tokens.lock().unwrap();
        tokens
            .get(&cache_key(key, scope))
            .filter(|t| t.expires_at > Instant::now() + EXPIRY_SKEW)
            .map(|t| t.access_token.clone())
    }

    fn store_token(&self, key: &str, scope: ScopeKind, access_token: String, expires_in: u64) {
        let mut tokens = self.tokens.lock().unwrap();
        tokens.insert(
            cache_key(key, scope),
            CachedToken {
                access_token,
                expires_at: Instant::now() + Duration::from_secs(expires_in),
            },
        );
    }

    /// 清掉該帳號**所有** scope 的快取。
    /// 登入、登出、切換帳號都必須呼叫：同一組 tenant/client 換了另一位使用者時
    /// cache key 不變，不清就會繼續回傳上一位使用者的 token。
    fn clear_tokens(&self, key: &str) {
        let prefix = format!("{key}::");
        self.tokens
            .lock()
            .unwrap()
            .retain(|k, _| !k.starts_with(&prefix));
    }

    fn begin_sign_in(&self, operation_id: &str) -> Result<Arc<CancelSignal>, AzureUserAuthError> {
        let mut pending = self.pending.lock().unwrap();
        if pending.is_some() {
            return Err(AzureUserAuthError::AlreadyInProgress);
        }
        let cancel = Arc::new(CancelSignal::default());
        *pending = Some(PendingSignIn {
            operation_id: operation_id.to_string(),
            cancel: cancel.clone(),
        });
        Ok(cancel)
    }

    /// 只清掉「還是自己那一次」的紀錄——避免慢一步的清理誤刪下一次登入。
    fn end_sign_in(&self, operation_id: &str) {
        let mut pending = self.pending.lock().unwrap();
        if pending
            .as_ref()
            .is_some_and(|p| p.operation_id == operation_id)
        {
            *pending = None;
        }
    }

    fn cancel_sign_in(&self, operation_id: &str) {
        let pending = self.pending.lock().unwrap();
        if let Some(p) = pending.as_ref() {
            if p.operation_id == operation_id {
                p.cancel.cancel();
            }
        }
    }
}

fn cache_key(account_key: &str, scope: ScopeKind) -> String {
    format!("{account_key}::{}", scope.as_str())
}

/// 確保 sign-in 結束時一定會清掉 pending 紀錄（含 early return 與 panic 以外的錯誤路徑）。
struct SignInGuard<'a> {
    state: &'a AzureUserAuthState,
    operation_id: String,
}

impl Drop for SignInGuard<'_> {
    fn drop(&mut self) {
        self.state.end_sign_in(&self.operation_id);
    }
}

// ── 憑證庫存取（同步 API → spawn_blocking）───────────────────

/// 憑證庫操作的行程內序列化鎖。
///
/// async 端雖已有 per-account mutex，但 `spawn_blocking` 一旦啟動就不會因為
/// 呼叫端的 future 被 drop（WebView 重載、視窗關閉、command 被取消）而中止。
/// 那種情況下 async guard 已經釋放，下一個 command 可能在舊的 blocking 任務
/// 還在寫入時就進入臨界區，造成「刪除後又被舊的 save 寫回」或 refresh 與
/// sign-out 交錯。因此在 blocking 端再加一道鎖，確保憑證庫操作本身恆為序列化。
static KEYRING_LOCK: StdMutex<()> = StdMutex::new(());

/// 取得憑證庫鎖。中毒（前一個持有者 panic）時仍繼續使用——憑證庫操作本身
/// 沒有跨呼叫的不變式會被破壞，硬中斷只會讓使用者無法登入。
fn keyring_guard() -> std::sync::MutexGuard<'static, ()> {
    KEYRING_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn store() -> SecretStore<OsKeyring> {
    SecretStore::new(OsKeyring::new(KEYRING_SERVICE))
}

async fn load_session(key: String) -> Result<Option<StoredSession>, AzureUserAuthError> {
    tokio::task::spawn_blocking(move || {
        let _guard = keyring_guard();
        match store().load(&key) {
            Ok(Some(raw)) => Ok(serde_json::from_str::<StoredSession>(&raw).ok()),
            Ok(None) => Ok(None),
            // 憑證損毀視為未登入：要求重新登入即可自我修復，比硬錯更好
            Err(SecretStoreError::Corrupted) => Ok(None),
            Err(e) => Err(AzureUserAuthError::Failed(e.to_string())),
        }
    })
    .await
    .map_err(|e| AzureUserAuthError::Failed(e.to_string()))?
}

async fn save_session(key: String, session: &StoredSession) -> Result<(), AzureUserAuthError> {
    let raw = serde_json::to_string(session)
        .map_err(|e| AzureUserAuthError::Failed(format!("failed to encode session: {e}")))?;
    tokio::task::spawn_blocking(move || {
        let _guard = keyring_guard();
        store()
            .save(&key, &raw)
            .map_err(|e| AzureUserAuthError::Failed(e.to_string()))
    })
    .await
    .map_err(|e| AzureUserAuthError::Failed(e.to_string()))?
}

async fn delete_session(key: String) -> Result<(), AzureUserAuthError> {
    tokio::task::spawn_blocking(move || {
        let _guard = keyring_guard();
        store()
            .delete(&key)
            .map_err(|e| AzureUserAuthError::Failed(e.to_string()))
    })
    .await
    .map_err(|e| AzureUserAuthError::Failed(e.to_string()))?
}

// ── Token endpoint ──────────────────────────────────────────

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct TokenErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
}

/// 需要重新互動登入的 OAuth 錯誤碼。這些情況不該只是重試 refresh。
const INTERACTION_REQUIRED_ERRORS: [&str; 4] = [
    "invalid_grant",
    "interaction_required",
    "consent_required",
    "login_required",
];

async fn post_token(
    tenant_id: &str,
    params: &[(&str, &str)],
) -> Result<TokenResponse, AzureUserAuthError> {
    let client = reqwest::Client::builder()
        .timeout(TOKEN_REQUEST_TIMEOUT)
        // 禁止跟隨 redirect：token endpoint 不該重導，若被重導（DNS 汙染、
        // 中間設備）預設行為會把 client_id / code / refresh_token 這些
        // form body 一併送到新位址。
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AzureUserAuthError::Failed(e.to_string()))?;

    let response = client
        .post(format!(
            "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        ))
        .form(params)
        .send()
        .await
        .map_err(|e| AzureUserAuthError::Failed(format!("token request failed: {e}")))?;

    let status = response.status();
    // 這段內容含 token，絕對不可寫進 log 或錯誤訊息
    let raw = response.text().await.unwrap_or_default();

    if !status.is_success() {
        let parsed = serde_json::from_str::<TokenErrorResponse>(&raw).ok();
        let code = parsed
            .as_ref()
            .and_then(|e| e.error.clone())
            .unwrap_or_default();
        let detail = parsed
            .and_then(|e| e.error_description)
            .unwrap_or_default()
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(300)
            .collect::<String>();
        return Err(if INTERACTION_REQUIRED_ERRORS.contains(&code.as_str()) {
            AzureUserAuthError::InteractionRequired(detail)
        } else {
            AzureUserAuthError::Failed(format!("{}: {detail}", status.as_u16()))
        });
    }

    serde_json::from_str(&raw)
        .map_err(|e| AzureUserAuthError::Failed(format!("failed to parse token response: {e}")))
}

// ── Commands ────────────────────────────────────────────────

fn normalize(value: &str) -> String {
    value.trim().to_string()
}

fn require_config(tenant_id: &str, client_id: &str) -> Result<(), AzureUserAuthError> {
    if tenant_id.is_empty() || client_id.is_empty() {
        return Err(AzureUserAuthError::ConfigIncomplete);
    }
    // 安全關鍵：tenant_id 會拼進 authorize/token URL 的 path，未驗證即可被
    // 竄改的設定備份改寫整個授權請求（見 validate_tenant_id 的說明）。
    validate_tenant_id(tenant_id)?;
    validate_client_id(client_id)?;
    Ok(())
}

/// 互動登入：開系統瀏覽器 → 攔 loopback callback → 換 token → 存憑證庫。
#[command]
pub async fn azure_user_sign_in(
    tenant_id: String,
    client_id: String,
    operation_id: String,
    state: tauri::State<'_, AzureUserAuthState>,
) -> Result<AzureUserAccount, AzureUserAuthError> {
    let tenant_id = normalize(&tenant_id);
    let client_id = normalize(&client_id);
    require_config(&tenant_id, &client_id)?;

    let cancel = state.begin_sign_in(&operation_id)?;
    let _guard = SignInGuard {
        state: &state,
        operation_id: operation_id.clone(),
    };

    let pkce = generate_pkce()?;
    let csrf_state = random_url_safe(16)?;
    let nonce = random_url_safe(16)?;

    // 必須先 bind 再開瀏覽器，否則 redirect 可能早於 listener 就緒
    let (listener, redirect_uri) = bind_loopback().await?;
    let authorize_url = build_authorize_url(
        &tenant_id,
        &client_id,
        &redirect_uri,
        &csrf_state,
        &nonce,
        &pkce.challenge,
    );
    open_in_browser(&authorize_url)?;

    let callback = tokio::select! {
        result = wait_for_callback(
            &listener,
            &csrf_state,
            "登入完成",
            "可以關閉這個分頁，回到 SayIt。",
        ) => result?,
        _ = cancel.cancelled() => return Err(AzureUserAuthError::Cancelled),
        _ = tokio::time::sleep(sign_in_timeout()) => return Err(AzureUserAuthError::TimedOut),
    };

    let token = post_token(
        &tenant_id,
        &[
            ("client_id", client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", callback.code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", pkce.verifier.as_str()),
        ],
    )
    .await?;

    let refresh_token = token
        .refresh_token
        .ok_or_else(|| AzureUserAuthError::Failed("no refresh_token in response".to_string()))?;
    let id_token = token
        .id_token
        .ok_or_else(|| AzureUserAuthError::Failed("no id_token in response".to_string()))?;
    let account = parse_account_from_id_token(&id_token, &tenant_id, &client_id, &nonce)?;

    let key = account_key(&tenant_id, &client_id);
    let lock = state.lock_for(&key);
    let _held = lock.lock().await;

    // 換了使用者時 cache key 不變，不先清會回傳上一位使用者的 token
    state.clear_tokens(&key);
    save_session(
        key.clone(),
        &StoredSession {
            refresh_token,
            account: account.clone(),
        },
    )
    .await?;

    if let (Some(access_token), Some(expires_in)) = (token.access_token, token.expires_in) {
        // 授權時要的是 cognitiveservices scope，只有 Whisper 這一份能直接放進快取
        state.store_token(&key, ScopeKind::Whisper, access_token, expires_in);
    }

    Ok(account)
}

/// 取消進行中的登入。帶 operation_id 是為了避免取消到「下一次」登入。
#[command]
pub fn azure_user_cancel_sign_in(
    operation_id: String,
    state: tauri::State<'_, AzureUserAuthState>,
) {
    state.cancel_sign_in(&operation_id);
}

#[command]
pub async fn azure_user_sign_out(
    tenant_id: String,
    client_id: String,
    state: tauri::State<'_, AzureUserAuthState>,
) -> Result<(), AzureUserAuthError> {
    let tenant_id = normalize(&tenant_id);
    let client_id = normalize(&client_id);
    // 登出容許格式不合法的舊值：使用者可能就是要清掉那筆壞掉的設定
    if tenant_id.is_empty() || client_id.is_empty() {
        return Ok(());
    }
    let key = account_key(&tenant_id, &client_id);
    let lock = state.lock_for(&key);
    let _held = lock.lock().await;
    state.clear_tokens(&key);
    delete_session(key).await
}

#[command]
pub async fn azure_user_get_account(
    tenant_id: String,
    client_id: String,
    state: tauri::State<'_, AzureUserAuthState>,
) -> Result<Option<AzureUserAccount>, AzureUserAuthError> {
    let tenant_id = normalize(&tenant_id);
    let client_id = normalize(&client_id);
    // 查詢類操作：格式不合法視為「沒有這個帳號」，不報錯——設定載入時
    // 使用者可能還在輸入一半，不該讓整個設定頁噴錯。
    if require_config(&tenant_id, &client_id).is_err() {
        return Ok(None);
    }
    let key = account_key(&tenant_id, &client_id);
    // 兩個 WebView 啟動時會同時查詢，同一把鎖避免與 refresh/登出交錯
    let lock = state.lock_for(&key);
    let _held = lock.lock().await;
    Ok(load_session(key).await?.map(|s| s.account))
}

/// 取得指定用途的 access token。scope 由 `ScopeKind` 決定，前端無法指定任意 audience。
#[command]
pub async fn azure_user_get_token(
    tenant_id: String,
    client_id: String,
    scope_kind: String,
    state: tauri::State<'_, AzureUserAuthState>,
) -> Result<String, AzureUserAuthError> {
    let tenant_id = normalize(&tenant_id);
    let client_id = normalize(&client_id);
    require_config(&tenant_id, &client_id)?;
    let scope = ScopeKind::parse(&scope_kind)
        .ok_or_else(|| AzureUserAuthError::Failed(format!("unknown scope kind: {scope_kind}")))?;

    let key = account_key(&tenant_id, &client_id);

    if let Some(token) = state.cached(&key, scope) {
        return Ok(token);
    }

    let lock = state.lock_for(&key);
    let _held = lock.lock().await;

    // 取得鎖之後重查：等鎖期間可能已有其他呼叫完成 refresh
    if let Some(token) = state.cached(&key, scope) {
        return Ok(token);
    }

    let session = load_session(key.clone())
        .await?
        .ok_or(AzureUserAuthError::NotSignedIn)?;

    let token = post_token(
        &tenant_id,
        &[
            ("client_id", client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", session.refresh_token.as_str()),
            ("scope", scope.scope()),
        ],
    )
    .await?;

    let access_token = token
        .access_token
        .ok_or_else(|| AzureUserAuthError::Failed("no access_token in response".to_string()))?;

    // refresh token 會輪替；沒拿到新的就沿用舊的（Entra 不保證每次都回）
    if let Some(rotated) = token.refresh_token {
        save_session(
            key.clone(),
            &StoredSession {
                refresh_token: rotated,
                account: session.account,
            },
        )
        .await?;
    }

    state.store_token(
        &key,
        scope,
        access_token.clone(),
        token.expires_in.unwrap_or(3600),
    );
    Ok(access_token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_keys_are_scope_specific() {
        let key = account_key("t", "c");
        assert_ne!(
            cache_key(&key, ScopeKind::Chat),
            cache_key(&key, ScopeKind::Whisper)
        );
    }

    #[test]
    fn clearing_tokens_removes_every_scope() {
        let state = AzureUserAuthState::default();
        let key = account_key("t", "c");
        state.store_token(&key, ScopeKind::Chat, "a".into(), 3600);
        state.store_token(&key, ScopeKind::Whisper, "b".into(), 3600);
        state.clear_tokens(&key);
        assert!(state.cached(&key, ScopeKind::Chat).is_none());
        assert!(state.cached(&key, ScopeKind::Whisper).is_none());
    }

    #[test]
    fn clearing_tokens_does_not_touch_other_accounts() {
        let state = AzureUserAuthState::default();
        let a = account_key("t", "c1");
        let b = account_key("t", "c2");
        state.store_token(&a, ScopeKind::Chat, "a".into(), 3600);
        state.store_token(&b, ScopeKind::Chat, "b".into(), 3600);
        state.clear_tokens(&a);
        assert!(state.cached(&a, ScopeKind::Chat).is_none());
        assert_eq!(state.cached(&b, ScopeKind::Chat).as_deref(), Some("b"));
    }

    #[test]
    fn tokens_within_expiry_skew_are_treated_as_expired() {
        let state = AzureUserAuthState::default();
        let key = account_key("t", "c");
        // 剩餘時間短於 skew → 視為過期，強制重新取得
        state.store_token(&key, ScopeKind::Chat, "soon".into(), 30);
        assert!(state.cached(&key, ScopeKind::Chat).is_none());
        state.store_token(&key, ScopeKind::Chat, "fresh".into(), 3600);
        assert_eq!(
            state.cached(&key, ScopeKind::Chat).as_deref(),
            Some("fresh")
        );
    }

    #[test]
    fn only_one_sign_in_at_a_time() {
        let state = AzureUserAuthState::default();
        assert!(state.begin_sign_in("op-1").is_ok());
        assert!(matches!(
            state.begin_sign_in("op-2"),
            Err(AzureUserAuthError::AlreadyInProgress)
        ));
        state.end_sign_in("op-1");
        assert!(state.begin_sign_in("op-2").is_ok());
    }

    #[test]
    fn stale_end_sign_in_does_not_clear_newer_operation() {
        let state = AzureUserAuthState::default();
        state.begin_sign_in("op-1").unwrap();
        state.end_sign_in("op-1");
        state.begin_sign_in("op-2").unwrap();
        // 遲來的 op-1 清理不可影響進行中的 op-2
        state.end_sign_in("op-1");
        assert!(matches!(
            state.begin_sign_in("op-3"),
            Err(AzureUserAuthError::AlreadyInProgress)
        ));
    }

    #[test]
    fn per_account_locks_are_shared_and_distinct() {
        let state = AzureUserAuthState::default();
        let a1 = state.lock_for("acct-a");
        let a2 = state.lock_for("acct-a");
        let b = state.lock_for("acct-b");
        assert!(Arc::ptr_eq(&a1, &a2));
        assert!(!Arc::ptr_eq(&a1, &b));
    }

    #[test]
    fn classifies_errors_that_require_interactive_sign_in() {
        // 這幾種錯誤重試 refresh 沒有意義，必須引導使用者重新登入；
        // 其餘（限流、暫時性故障）則應維持可重試，不可把使用者踢出去。
        for code in [
            "invalid_grant",
            "interaction_required",
            "consent_required",
            "login_required",
        ] {
            assert!(
                INTERACTION_REQUIRED_ERRORS.contains(&code),
                "{code} should require interactive sign-in"
            );
        }
        for code in [
            "temporarily_unavailable",
            "server_error",
            "invalid_request",
            "slow_down",
            "",
        ] {
            assert!(
                !INTERACTION_REQUIRED_ERRORS.contains(&code),
                "{code} must stay retryable"
            );
        }
    }

    #[test]
    fn errors_serialize_to_plain_strings() {
        // 前端 reject 收到的是字串，不是物件
        let json = serde_json::to_string(&AzureUserAuthError::NotSignedIn).unwrap();
        assert_eq!(json, "\"not signed in\"");
    }

    #[tokio::test]
    async fn cancel_before_await_is_not_lost() {
        // 使用者按取消的時機常落在「已建立 pending、但 select! 尚未 arm」之間
        //（bind loopback、開瀏覽器那段）。若用 notify_waiters() 這次取消會被
        // 靜默丟棄，使用者得多等五分鐘 timeout。
        let signal = CancelSignal::default();
        signal.cancel();
        tokio::time::timeout(Duration::from_millis(200), signal.cancelled())
            .await
            .expect("cancel issued before await must still be observed");
    }

    #[tokio::test]
    async fn cancel_while_awaiting_is_observed() {
        let signal = Arc::new(CancelSignal::default());
        let waiter = signal.clone();
        let handle = tokio::spawn(async move { waiter.cancelled().await });
        tokio::task::yield_now().await;
        signal.cancel();
        tokio::time::timeout(Duration::from_millis(200), handle)
            .await
            .expect("cancel during await must wake the waiter")
            .expect("waiter task should not panic");
    }

    #[tokio::test]
    async fn uncancelled_signal_keeps_waiting() {
        let signal = CancelSignal::default();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), signal.cancelled())
                .await
                .is_err(),
            "signal must not report cancellation before cancel() is called"
        );
    }

    #[test]
    fn cancel_targets_only_the_matching_operation() {
        let state = AzureUserAuthState::default();
        let signal = state.begin_sign_in("op-1").unwrap();
        // 針對別次操作的取消不可影響進行中的這次
        state.cancel_sign_in("op-2");
        assert!(!signal.cancelled.load(Ordering::SeqCst));
        state.cancel_sign_in("op-1");
        assert!(signal.cancelled.load(Ordering::SeqCst));
    }
}
