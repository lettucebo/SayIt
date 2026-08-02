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
use std::future::Future;
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
    /// 這次登入最終會寫到哪個帳號。登出／清除必須能找出「同一個帳號」的
    /// 進行中登入並取消它，否則晚回來的 callback 會把 refresh token 寫進
    /// 一個 locator 已被刪掉的位置，變成永遠清不掉的孤兒憑證。
    account_key: String,
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

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    async fn cancelled(&self) {
        loop {
            if self.is_cancelled() {
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

    fn begin_sign_in(
        &self,
        operation_id: &str,
        account_key: &str,
    ) -> Result<Arc<CancelSignal>, AzureUserAuthError> {
        let mut pending = self.pending.lock().unwrap();
        if pending.is_some() {
            return Err(AzureUserAuthError::AlreadyInProgress);
        }
        let cancel = Arc::new(CancelSignal::default());
        *pending = Some(PendingSignIn {
            operation_id: operation_id.to_string(),
            account_key: account_key.to_string(),
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

    /// 取消「寫到同一個帳號」的進行中登入。登出／清除連線必須呼叫：
    /// 呼叫端可能是另一個 WebView（或 reload 後的同一個），它並不知道
    /// 目前的 operation_id，但那次登入的 callback 一樣會寫進同一把 key。
    fn cancel_sign_in_for_account(&self, account_key: &str) {
        let pending = self.pending.lock().unwrap();
        if let Some(p) = pending.as_ref() {
            if p.account_key == account_key {
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

/// 需要重新互動登入的 OAuth 錯誤碼。這些情況重試 refresh 沒有意義。
///
/// ⚠️ 這些碼**不代表 refresh token 必然已永久失效**。Microsoft 的 MSAL 指引
/// 明載：refresh 流程回 `invalid_grant` 的意思是「必須改用互動模式再取得一次
/// token」，成因可能只是租戶套用了更嚴格的登入政策、或使用者需要接受使用條款
/// 之類一次性的動作（見 MSAL.NET「Handle errors and exceptions」）。
/// 因此這裡**不刪除憑證**——把使用者的登入狀態砍掉是不可逆的，
/// 而換來的只是設定頁的顯示更即時，不成比例。顯示層的同步改由前端在收到
/// 這類錯誤時清掉畫面上的帳號快照處理。
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

// ── 生命週期（可測試）───────────────────────────────────────
//
// 登入收尾與 refresh 這兩段是「多步驟且會改動持久化狀態」的流程，也是先前
// 三次資料事故的同一類風險所在。把外部相依（OS 憑證庫、token endpoint）收斂
// 成一個 trait，流程本身就能在沒有網路與憑證庫的情況下被完整測試。

trait SessionBackend: Sync {
    fn load(
        &self,
        key: String,
    ) -> impl Future<Output = Result<Option<StoredSession>, AzureUserAuthError>> + Send;

    fn save(
        &self,
        key: String,
        session: StoredSession,
    ) -> impl Future<Output = Result<(), AzureUserAuthError>> + Send;

    fn delete(&self, key: String) -> impl Future<Output = Result<(), AzureUserAuthError>> + Send;

    fn post_token(
        &self,
        tenant_id: String,
        params: Vec<(&'static str, String)>,
    ) -> impl Future<Output = Result<TokenResponse, AzureUserAuthError>> + Send;
}

struct RealBackend;

impl SessionBackend for RealBackend {
    async fn load(&self, key: String) -> Result<Option<StoredSession>, AzureUserAuthError> {
        load_session(key).await
    }

    async fn save(&self, key: String, session: StoredSession) -> Result<(), AzureUserAuthError> {
        save_session(key, &session).await
    }

    async fn delete(&self, key: String) -> Result<(), AzureUserAuthError> {
        delete_session(key).await
    }

    async fn post_token(
        &self,
        tenant_id: String,
        params: Vec<(&'static str, String)>,
    ) -> Result<TokenResponse, AzureUserAuthError> {
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        post_token(&tenant_id, &borrowed).await
    }
}

/// 登入的收尾：換 token → 驗 id_token → 確認未被取消 → 落地憑證庫。
///
/// 取得 per-account 鎖之後、寫入之前會再確認一次取消旗標：使用者可能在
/// 瀏覽器登入的那段時間就按了取消或「清除連線」。若不檢查就寫回 refresh
/// token，會留下一筆使用者已經無法從 UI 對應到、也就清不掉的孤兒憑證。
#[allow(clippy::too_many_arguments)]
async fn finalize_sign_in<B: SessionBackend>(
    backend: &B,
    state: &AzureUserAuthState,
    cancel: &CancelSignal,
    tenant_id: &str,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
    nonce: &str,
) -> Result<AzureUserAccount, AzureUserAuthError> {
    let token = backend
        .post_token(
            tenant_id.to_string(),
            vec![
                ("client_id", client_id.to_string()),
                ("grant_type", "authorization_code".to_string()),
                ("code", code.to_string()),
                ("redirect_uri", redirect_uri.to_string()),
                ("code_verifier", code_verifier.to_string()),
            ],
        )
        .await?;

    let refresh_token = token
        .refresh_token
        .ok_or_else(|| AzureUserAuthError::Failed("no refresh_token in response".to_string()))?;
    let id_token = token
        .id_token
        .ok_or_else(|| AzureUserAuthError::Failed("no id_token in response".to_string()))?;
    let account = parse_account_from_id_token(&id_token, tenant_id, client_id, nonce)?;

    let key = account_key(tenant_id, client_id);
    let lock = state.lock_for(&key);
    let _held = lock.lock().await;

    if cancel.is_cancelled() {
        return Err(AzureUserAuthError::Cancelled);
    }

    // 換了使用者時 cache key 不變，不先清會回傳上一位使用者的 token
    state.clear_tokens(&key);
    backend
        .save(
            key.clone(),
            StoredSession {
                refresh_token,
                account: account.clone(),
            },
        )
        .await?;

    // 寫入完成後再檢查一次。取消可能落在「上面的檢查通過」到「save 完成」
    // 之間——那段時間鎖還在我們手上，登出／清除會排在後面，於是它刪完之後
    // 我們才把 token 寫回去，留下一筆 UI 再也對應不到的孤兒憑證。
    // 這裡自己收回剛寫入的內容，讓「取消」在任何時序下都不留殘骸。
    if cancel.is_cancelled() {
        if let Err(cleanup) = backend.delete(key.clone()).await {
            log::warn!("failed to roll back cancelled sign-in: {cleanup}");
        }
        state.clear_tokens(&key);
        return Err(AzureUserAuthError::Cancelled);
    }

    if let (Some(access_token), Some(expires_in)) = (token.access_token, token.expires_in) {
        // 授權時要的是 cognitiveservices scope，只有 Whisper 這一份能直接放進快取
        state.store_token(&key, ScopeKind::Whisper, access_token, expires_in);
    }

    Ok(account)
}

/// 取得指定用途的 access token：快取 → per-account 鎖 → 重查 → refresh。
async fn acquire_token<B: SessionBackend>(
    backend: &B,
    state: &AzureUserAuthState,
    tenant_id: &str,
    client_id: &str,
    scope: ScopeKind,
) -> Result<String, AzureUserAuthError> {
    let key = account_key(tenant_id, client_id);

    if let Some(token) = state.cached(&key, scope) {
        return Ok(token);
    }

    let lock = state.lock_for(&key);
    let _held = lock.lock().await;

    // 取得鎖之後重查：等鎖期間可能已有其他呼叫完成 refresh
    if let Some(token) = state.cached(&key, scope) {
        return Ok(token);
    }

    let session = backend
        .load(key.clone())
        .await?
        .ok_or(AzureUserAuthError::NotSignedIn)?;

    let token = backend
        .post_token(
            tenant_id.to_string(),
            vec![
                ("client_id", client_id.to_string()),
                ("grant_type", "refresh_token".to_string()),
                ("refresh_token", session.refresh_token.clone()),
                ("scope", scope.scope().to_string()),
            ],
        )
        .await?;

    let access_token = token
        .access_token
        .ok_or_else(|| AzureUserAuthError::Failed("no access_token in response".to_string()))?;

    // refresh token 會輪替；沒拿到新的就沿用舊的（Entra 不保證每次都回）。
    // 寫入失敗必須讓整個呼叫失敗：此時舊的 refresh token 已被 Entra 消耗，
    // 若還回傳 access token，使用者會在下次過期時才發現已經無法續期。
    if let Some(rotated) = token.refresh_token {
        backend
            .save(
                key.clone(),
                StoredSession {
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

    let cancel = state.begin_sign_in(&operation_id, &account_key(&tenant_id, &client_id))?;
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

    finalize_sign_in(
        &RealBackend,
        &state,
        &cancel,
        &tenant_id,
        &client_id,
        &redirect_uri,
        &callback.code,
        &pkce.verifier,
        &nonce,
    )
    .await
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
    // 先取消寫向同一個帳號的進行中登入：呼叫端可能是另一個 WebView，
    // 不知道 operation_id，但那次登入的 callback 會寫進同一把 key。
    // 取消後它會在拿到下面這把鎖時自行收回已寫入的內容。
    state.cancel_sign_in_for_account(&key);
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

    acquire_token(&RealBackend, &state, &tenant_id, &client_id, scope).await
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
        assert!(state.begin_sign_in("op-1", "acct").is_ok());
        assert!(matches!(
            state.begin_sign_in("op-2", "acct"),
            Err(AzureUserAuthError::AlreadyInProgress)
        ));
        state.end_sign_in("op-1");
        assert!(state.begin_sign_in("op-2", "acct").is_ok());
    }

    #[test]
    fn stale_end_sign_in_does_not_clear_newer_operation() {
        let state = AzureUserAuthState::default();
        state.begin_sign_in("op-1", "acct").unwrap();
        state.end_sign_in("op-1");
        state.begin_sign_in("op-2", "acct").unwrap();
        // 遲來的 op-1 清理不可影響進行中的 op-2
        state.end_sign_in("op-1");
        assert!(matches!(
            state.begin_sign_in("op-3", "acct"),
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
    fn interaction_required_matches_the_frontend_check() {
        // 前端用 message.includes("interaction required") 判斷要不要引導重新登入
        let json = serde_json::to_string(&AzureUserAuthError::InteractionRequired(
            "AADSTS50173".into(),
        ))
        .unwrap();
        assert!(json.contains("interaction required"), "{json}");
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
        let signal = state.begin_sign_in("op-1", "acct").unwrap();
        // 針對別次操作的取消不可影響進行中的這次
        state.cancel_sign_in("op-2");
        assert!(!signal.cancelled.load(Ordering::SeqCst));
        state.cancel_sign_in("op-1");
        assert!(signal.cancelled.load(Ordering::SeqCst));
    }

    // ── 生命週期（finalize_sign_in / acquire_token）─────────────
    //
    // 這兩段是唯一會改動持久化狀態的流程，也是先前三次資料事故的同一類風險
    // 所在。以假的 backend 取代 OS 憑證庫與 token endpoint，驗證整段順序與
    // 各個失敗分支，而不是只驗證周邊的小元件。

    const TENANT: &str = "2aeb30d9-f0a6-4e27-8c47-f97c5b695eb6";
    const CLIENT: &str = "1671ffd4-1234-4321-9876-0123456789ab";
    const NONCE: &str = "nonce-value";

    type TokenParams = Vec<(&'static str, String)>;
    type TokenCall = (String, TokenParams);

    #[derive(Default)]
    struct FakeBackend {
        session: StdMutex<Option<StoredSession>>,
        saves: StdMutex<Vec<StoredSession>>,
        token_calls: StdMutex<Vec<TokenCall>>,
        responses: StdMutex<std::collections::VecDeque<Result<TokenResponse, AzureUserAuthError>>>,
        fail_save: AtomicBool,
        fail_load: AtomicBool,
        fail_delete: AtomicBool,
        deletes: StdMutex<Vec<String>>,
    }

    impl FakeBackend {
        fn with_session(refresh_token: &str) -> Self {
            let fake = Self::default();
            *fake.session.lock().unwrap() = Some(StoredSession {
                refresh_token: refresh_token.to_string(),
                account: account_fixture(),
            });
            fake
        }

        fn queue(&self, response: Result<TokenResponse, AzureUserAuthError>) -> &Self {
            self.responses.lock().unwrap().push_back(response);
            self
        }

        fn stored_refresh(&self) -> Option<String> {
            self.session
                .lock()
                .unwrap()
                .as_ref()
                .map(|s| s.refresh_token.clone())
        }

        fn save_count(&self) -> usize {
            self.saves.lock().unwrap().len()
        }

        fn token_call_count(&self) -> usize {
            self.token_calls.lock().unwrap().len()
        }

        fn delete_count(&self) -> usize {
            self.deletes.lock().unwrap().len()
        }

        fn param(&self, call: usize, name: &str) -> Option<String> {
            self.token_calls
                .lock()
                .unwrap()
                .get(call)
                .and_then(|(_, params)| {
                    params
                        .iter()
                        .find(|(k, _)| *k == name)
                        .map(|(_, v)| v.clone())
                })
        }
    }

    impl SessionBackend for FakeBackend {
        async fn load(&self, _key: String) -> Result<Option<StoredSession>, AzureUserAuthError> {
            if self.fail_load.load(Ordering::SeqCst) {
                return Err(AzureUserAuthError::Failed("keyring locked".to_string()));
            }
            let session = self.session.lock().unwrap().clone();
            Ok(session)
        }

        async fn save(
            &self,
            _key: String,
            session: StoredSession,
        ) -> Result<(), AzureUserAuthError> {
            if self.fail_save.load(Ordering::SeqCst) {
                return Err(AzureUserAuthError::Failed(
                    "keyring write failed".to_string(),
                ));
            }
            self.saves.lock().unwrap().push(session.clone());
            *self.session.lock().unwrap() = Some(session);
            Ok(())
        }

        async fn post_token(
            &self,
            tenant_id: String,
            params: Vec<(&'static str, String)>,
        ) -> Result<TokenResponse, AzureUserAuthError> {
            self.token_calls.lock().unwrap().push((tenant_id, params));
            let canned = self.responses.lock().unwrap().pop_front();
            canned.unwrap_or_else(|| {
                Err(AzureUserAuthError::Failed("no canned response".to_string()))
            })
        }

        async fn delete(&self, key: String) -> Result<(), AzureUserAuthError> {
            self.deletes.lock().unwrap().push(key);
            if self.fail_delete.load(Ordering::SeqCst) {
                return Err(AzureUserAuthError::Failed(
                    "keyring delete failed".to_string(),
                ));
            }
            *self.session.lock().unwrap() = None;
            Ok(())
        }
    }

    fn account_fixture() -> AzureUserAccount {
        AzureUserAccount {
            username: Some("user@contoso.com".to_string()),
            name: Some("Test User".to_string()),
            tenant_id: TENANT.to_string(),
            client_id: CLIENT.to_string(),
        }
    }

    fn token_response(
        access: Option<&str>,
        refresh: Option<&str>,
        id: Option<String>,
        expires_in: Option<u64>,
    ) -> TokenResponse {
        TokenResponse {
            access_token: access.map(str::to_string),
            refresh_token: refresh.map(str::to_string),
            id_token: id,
            expires_in,
        }
    }

    /// 只需要 payload 段能解出 claim——簽章驗證不在這層（見 parse_account_from_id_token）
    fn id_token(aud: &str, tid: &str, nonce: &str) -> String {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let claims = serde_json::json!({
            "aud": aud,
            "tid": tid,
            "nonce": nonce,
            "preferred_username": "user@contoso.com",
            "name": "Test User",
        });
        format!(
            "header.{}.signature",
            URL_SAFE_NO_PAD.encode(claims.to_string())
        )
    }

    async fn finalize(
        backend: &FakeBackend,
        state: &AzureUserAuthState,
        cancel: &CancelSignal,
    ) -> Result<AzureUserAccount, AzureUserAuthError> {
        finalize_sign_in(
            backend,
            state,
            cancel,
            TENANT,
            CLIENT,
            "http://127.0.0.1:1234",
            "auth-code",
            "verifier",
            NONCE,
        )
        .await
    }

    #[tokio::test]
    async fn sign_in_persists_session_and_seeds_only_the_whisper_cache() {
        let backend = FakeBackend::default();
        backend.queue(Ok(token_response(
            Some("access-1"),
            Some("refresh-1"),
            Some(id_token(CLIENT, TENANT, NONCE)),
            Some(3600),
        )));
        let state = AzureUserAuthState::default();

        let account = finalize(&backend, &state, &CancelSignal::default())
            .await
            .expect("sign-in should succeed");

        assert_eq!(account.username.as_deref(), Some("user@contoso.com"));
        assert_eq!(backend.stored_refresh().as_deref(), Some("refresh-1"));
        assert_eq!(
            backend.param(0, "grant_type").as_deref(),
            Some("authorization_code")
        );
        assert_eq!(
            backend.param(0, "code_verifier").as_deref(),
            Some("verifier")
        );

        // 授權時要的是 cognitiveservices scope，chat 那份必須另外換
        let key = account_key(TENANT, CLIENT);
        assert_eq!(
            state.cached(&key, ScopeKind::Whisper).as_deref(),
            Some("access-1")
        );
        assert!(state.cached(&key, ScopeKind::Chat).is_none());
    }

    #[tokio::test]
    async fn sign_in_clears_the_previous_users_cached_tokens() {
        // 同一組 tenant/client 換另一位使用者時 cache key 不變，
        // 不先清就會繼續回傳上一位使用者的 token。
        let backend = FakeBackend::default();
        backend.queue(Ok(token_response(
            None,
            Some("refresh-1"),
            Some(id_token(CLIENT, TENANT, NONCE)),
            None,
        )));
        let state = AzureUserAuthState::default();
        let key = account_key(TENANT, CLIENT);
        state.store_token(&key, ScopeKind::Chat, "old-chat".into(), 3600);
        state.store_token(&key, ScopeKind::Whisper, "old-whisper".into(), 3600);

        finalize(&backend, &state, &CancelSignal::default())
            .await
            .expect("sign-in should succeed");

        assert!(state.cached(&key, ScopeKind::Chat).is_none());
        assert!(state.cached(&key, ScopeKind::Whisper).is_none());
    }

    #[tokio::test]
    async fn sign_in_cancelled_during_the_browser_step_persists_nothing() {
        // 使用者在瀏覽器登入的期間按了取消／清除連線：此時寫回 refresh token
        // 會留下一筆 UI 再也對應不到、也清不掉的孤兒憑證。
        let backend = FakeBackend::default();
        backend.queue(Ok(token_response(
            Some("access-1"),
            Some("refresh-1"),
            Some(id_token(CLIENT, TENANT, NONCE)),
            Some(3600),
        )));
        let state = AzureUserAuthState::default();
        let cancel = CancelSignal::default();
        cancel.cancel();

        let result = finalize(&backend, &state, &cancel).await;

        assert!(matches!(result, Err(AzureUserAuthError::Cancelled)));
        assert_eq!(backend.save_count(), 0);
        assert!(backend.stored_refresh().is_none());
    }

    #[tokio::test]
    async fn sign_in_without_refresh_token_aborts_before_persisting() {
        let backend = FakeBackend::default();
        backend.queue(Ok(token_response(
            Some("access-1"),
            None,
            Some(id_token(CLIENT, TENANT, NONCE)),
            Some(3600),
        )));
        let state = AzureUserAuthState::default();

        assert!(finalize(&backend, &state, &CancelSignal::default())
            .await
            .is_err());
        assert_eq!(backend.save_count(), 0);
    }

    #[tokio::test]
    async fn sign_in_with_foreign_audience_aborts_before_persisting() {
        let backend = FakeBackend::default();
        backend.queue(Ok(token_response(
            Some("access-1"),
            Some("refresh-1"),
            Some(id_token("some-other-app", TENANT, NONCE)),
            Some(3600),
        )));
        let state = AzureUserAuthState::default();

        assert!(finalize(&backend, &state, &CancelSignal::default())
            .await
            .is_err());
        assert_eq!(backend.save_count(), 0);
    }

    #[tokio::test]
    async fn sign_in_reports_failure_when_the_credential_store_rejects_the_write() {
        // 憑證庫寫不進去卻回報成功，使用者會以為已登入，下次啟動才發現沒有
        let backend = FakeBackend::default();
        backend.fail_save.store(true, Ordering::SeqCst);
        backend.queue(Ok(token_response(
            Some("access-1"),
            Some("refresh-1"),
            Some(id_token(CLIENT, TENANT, NONCE)),
            Some(3600),
        )));
        let state = AzureUserAuthState::default();

        assert!(finalize(&backend, &state, &CancelSignal::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn cached_token_short_circuits_before_any_backend_access() {
        let backend = FakeBackend::with_session("refresh-1");
        let state = AzureUserAuthState::default();
        let key = account_key(TENANT, CLIENT);
        state.store_token(&key, ScopeKind::Chat, "cached".into(), 3600);

        let token = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat)
            .await
            .expect("cached token should be returned");

        assert_eq!(token, "cached");
        assert_eq!(backend.token_call_count(), 0);
    }

    #[tokio::test]
    async fn refresh_sends_the_refresh_grant_and_caches_the_result() {
        let backend = FakeBackend::with_session("refresh-1");
        backend.queue(Ok(token_response(Some("access-1"), None, None, Some(3600))));
        let state = AzureUserAuthState::default();

        let token = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat)
            .await
            .expect("refresh should succeed");

        assert_eq!(token, "access-1");
        assert_eq!(
            backend.param(0, "grant_type").as_deref(),
            Some("refresh_token")
        );
        assert_eq!(
            backend.param(0, "refresh_token").as_deref(),
            Some("refresh-1")
        );
        assert_eq!(backend.param(0, "client_id").as_deref(), Some(CLIENT));
        assert_eq!(
            backend.param(0, "scope").as_deref(),
            Some(ScopeKind::Chat.scope())
        );

        // 第二次必須走快取，不可再打一次 token endpoint
        acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat)
            .await
            .unwrap();
        assert_eq!(backend.token_call_count(), 1);
    }

    #[tokio::test]
    async fn rotated_refresh_token_replaces_the_stored_one() {
        let backend = FakeBackend::with_session("refresh-1");
        backend.queue(Ok(token_response(
            Some("access-1"),
            Some("refresh-2"),
            None,
            Some(3600),
        )));
        let state = AzureUserAuthState::default();

        acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Whisper)
            .await
            .unwrap();

        assert_eq!(backend.stored_refresh().as_deref(), Some("refresh-2"));
    }

    #[tokio::test]
    async fn absent_rotation_leaves_the_stored_refresh_token_untouched() {
        // Entra 不保證每次都回新的 refresh token；沒回就必須沿用舊的，
        // 不可寫入空值把使用者的登入狀態毀掉。
        let backend = FakeBackend::with_session("refresh-1");
        backend.queue(Ok(token_response(Some("access-1"), None, None, Some(3600))));
        let state = AzureUserAuthState::default();

        acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat)
            .await
            .unwrap();

        assert_eq!(backend.save_count(), 0);
        assert_eq!(backend.stored_refresh().as_deref(), Some("refresh-1"));
    }

    #[tokio::test]
    async fn missing_session_reports_not_signed_in_without_calling_the_token_endpoint() {
        let backend = FakeBackend::default();
        let state = AzureUserAuthState::default();

        let result = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat).await;

        assert!(matches!(result, Err(AzureUserAuthError::NotSignedIn)));
        assert_eq!(backend.token_call_count(), 0);
    }

    #[tokio::test]
    async fn failing_to_persist_the_rotated_token_fails_the_whole_call() {
        // 舊的 refresh token 此時已被 Entra 消耗，若還回傳 access token，
        // 使用者要等到下次過期才會發現已經無法續期。
        let backend = FakeBackend::with_session("refresh-1");
        backend.fail_save.store(true, Ordering::SeqCst);
        backend.queue(Ok(token_response(
            Some("access-1"),
            Some("refresh-2"),
            None,
            Some(3600),
        )));
        let state = AzureUserAuthState::default();

        let result = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat).await;

        assert!(result.is_err());
        // 不可留下一個「拿得到 token 但續期鏈已斷」的快取
        assert!(state
            .cached(&account_key(TENANT, CLIENT), ScopeKind::Chat)
            .is_none());
    }

    #[tokio::test]
    async fn interaction_required_propagates_and_caches_nothing() {
        let backend = FakeBackend::with_session("refresh-1");
        backend.queue(Err(AzureUserAuthError::InteractionRequired(
            "AADSTS65001".to_string(),
        )));
        let state = AzureUserAuthState::default();

        let result = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat).await;

        assert!(matches!(
            result,
            Err(AzureUserAuthError::InteractionRequired(_))
        ));
        assert!(state
            .cached(&account_key(TENANT, CLIENT), ScopeKind::Chat)
            .is_none());
        assert_eq!(backend.save_count(), 0);
        // refresh 失敗**不可**刪憑證：Microsoft 的指引明載 refresh 流程回
        // invalid_grant 只代表「必須改用互動模式再取得一次 token」，成因可能
        // 只是租戶套用了更嚴格的登入政策，憑證本身不一定已永久失效。
        assert_eq!(backend.delete_count(), 0);
        assert_eq!(backend.stored_refresh().as_deref(), Some("refresh-1"));
    }

    #[tokio::test]
    async fn cancelled_sign_in_rolls_back_what_it_already_wrote() {
        // 取消可能落在「寫入前的檢查通過」與「save 完成」之間。若不收回，
        // 隨後（或已完成）的登出／清除就對應不到這筆憑證，變成永久孤兒。
        struct CancelOnSave<'a> {
            inner: FakeBackend,
            cancel: &'a CancelSignal,
        }
        impl SessionBackend for CancelOnSave<'_> {
            async fn load(&self, key: String) -> Result<Option<StoredSession>, AzureUserAuthError> {
                self.inner.load(key).await
            }
            async fn save(
                &self,
                key: String,
                session: StoredSession,
            ) -> Result<(), AzureUserAuthError> {
                // 模擬「寫入期間使用者按下清除連線」
                self.cancel.cancel();
                self.inner.save(key, session).await
            }
            async fn delete(&self, key: String) -> Result<(), AzureUserAuthError> {
                self.inner.delete(key).await
            }
            async fn post_token(
                &self,
                tenant_id: String,
                params: Vec<(&'static str, String)>,
            ) -> Result<TokenResponse, AzureUserAuthError> {
                self.inner.post_token(tenant_id, params).await
            }
        }

        let cancel = CancelSignal::default();
        let backend = CancelOnSave {
            inner: FakeBackend::default(),
            cancel: &cancel,
        };
        backend.inner.queue(Ok(token_response(
            Some("access-1"),
            Some("refresh-1"),
            Some(id_token(CLIENT, TENANT, NONCE)),
            Some(3600),
        )));
        let state = AzureUserAuthState::default();

        let result = finalize_sign_in(
            &backend,
            &state,
            &cancel,
            TENANT,
            CLIENT,
            "http://127.0.0.1:1234",
            "auth-code",
            "verifier",
            NONCE,
        )
        .await;

        assert!(matches!(result, Err(AzureUserAuthError::Cancelled)));
        assert_eq!(backend.inner.delete_count(), 1);
        assert!(backend.inner.stored_refresh().is_none());
        assert!(state
            .cached(&account_key(TENANT, CLIENT), ScopeKind::Whisper)
            .is_none());
    }

    #[test]
    fn sign_out_cancels_a_pending_sign_in_for_the_same_account() {
        // 登出／清除的呼叫端可能是另一個 WebView，不知道 operation_id，
        // 但那次登入的 callback 會寫進同一把 key。
        let state = AzureUserAuthState::default();
        let key = account_key(TENANT, CLIENT);
        let signal = state.begin_sign_in("op-1", &key).unwrap();

        state.cancel_sign_in_for_account(&account_key(TENANT, "other-client"));
        assert!(!signal.cancelled.load(Ordering::SeqCst));

        state.cancel_sign_in_for_account(&key);
        assert!(signal.cancelled.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn credential_store_failure_is_not_reported_as_signed_out() {
        // 憑證庫暫時讀不到（鎖住／權限）不等於沒登入——回 NotSignedIn 會讓
        // UI 把使用者踢出去，但實際上憑證還在。
        let backend = FakeBackend::with_session("refresh-1");
        backend.fail_load.store(true, Ordering::SeqCst);
        let state = AzureUserAuthState::default();

        let result = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat).await;

        assert!(matches!(result, Err(AzureUserAuthError::Failed(_))));
        assert_eq!(backend.token_call_count(), 0);
    }

    #[tokio::test]
    async fn chat_and_whisper_are_refreshed_and_cached_independently() {
        let backend = FakeBackend::with_session("refresh-1");
        backend
            .queue(Ok(token_response(
                Some("chat-token"),
                None,
                None,
                Some(3600),
            )))
            .queue(Ok(token_response(
                Some("whisper-token"),
                None,
                None,
                Some(3600),
            )));
        let state = AzureUserAuthState::default();

        let chat = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Chat)
            .await
            .unwrap();
        let whisper = acquire_token(&backend, &state, TENANT, CLIENT, ScopeKind::Whisper)
            .await
            .unwrap();

        assert_eq!(chat, "chat-token");
        assert_eq!(whisper, "whisper-token");
        assert_ne!(
            backend.param(0, "scope").unwrap(),
            backend.param(1, "scope").unwrap()
        );
    }
}
