//! Entra ID 使用者委派登入（Authorization Code + PKCE，public client）。
//!
//! 取代 client secret：使用者用自己的公司帳號登入，App 不再持有任何長期共享密鑰。
//! refresh token 存 OS 原生憑證庫（見 `secret_store`），access token 只留在記憶體。
//!
//! ## 實作上的關鍵限制（皆為實測結果，改動前請先確認）
//!
//! 1. **redirect_uri 不可帶路徑**：App Registration 註冊的是 `http://127.0.0.1`，
//!    Entra 比對時會忽略 port 但**不會**忽略路徑；`http://127.0.0.1:1234/callback`
//!    會被拒（AADSTS50011）。
//! 2. **綁 `127.0.0.1` 而非 `localhost`**：listener 只綁 IPv4 時，若 redirect 用
//!    `localhost`，瀏覽器可能先解析到 `::1` 而連不上。
//! 3. **開瀏覽器不可經過 shell**：`cmd /c start "" <url>` 會把 URL 裡的 `&` 當成
//!    命令分隔符，只送出第一個 query 參數 → Entra 回 AADSTS900144（缺 scope）。
//! 4. **必須循環 accept**：瀏覽器預連線、favicon 請求或安全軟體可能先佔用一次連線，
//!    只 accept 一次會漏掉真正的 callback。

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// 等待使用者在瀏覽器完成登入的上限。
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// 單一連線讀取 request line 的上限，避免慢速/惡意連線卡住流程。
const SOCKET_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// HTTP request 首行長度上限（authorization code 可能很長，但不會到 8KB）。
const MAX_REQUEST_BYTES: usize = 8192;

/// 前端只傳這個列舉，實際 scope 由 Rust 決定——避免 WebView 能指定任意 audience。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScopeKind {
    Chat,
    Whisper,
}

impl ScopeKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "chat" => Some(Self::Chat),
            "whisper" => Some(Self::Whisper),
            _ => None,
        }
    }

    /// 實測：v1 chat 與 deployments/Whisper 兩條路徑其實兩個 audience 都接受，
    /// 但仍沿用與 API 路徑對應的 scope，維持與既有 key 模式一致的語意。
    pub fn scope(self) -> &'static str {
        match self {
            Self::Chat => "https://ai.azure.com/.default",
            Self::Whisper => "https://cognitiveservices.azure.com/.default",
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Whisper => "whisper",
        }
    }
}

/// 互動授權時請求的 scope。取得的 refresh token 之後可跨資源換另一個 audience
/// （實測可行），所以只需要一次登入、一次同意。
const AUTHORIZE_SCOPE: &str =
    "https://cognitiveservices.azure.com/.default offline_access openid profile";

#[derive(Debug, thiserror::Error)]
pub enum AzureUserAuthError {
    #[error("Entra configuration incomplete")]
    ConfigIncomplete,
    #[error("sign-in already in progress")]
    AlreadyInProgress,
    #[error("sign-in cancelled")]
    Cancelled,
    /// 被 tenant 政策（Conditional Access 等）拒絕。與使用者自行取消區分開，
    /// 才能把 AADSTS 說明帶給使用者去找 IT。
    #[error("sign-in blocked by policy: {0}")]
    PolicyDenied(String),
    #[error("sign-in timed out")]
    TimedOut,
    #[error("not signed in")]
    NotSignedIn,
    /// tenant/client 識別碼格式不合法。這是安全檢查而非便利性檢查——見
    /// `validate_tenant_id` 的說明。
    #[error("invalid tenant id")]
    InvalidTenantId,
    #[error("invalid client id")]
    InvalidClientId,
    /// refresh token 已失效（撤銷／過期／密碼變更）→ 必須重新互動登入。
    #[error("interaction required: {0}")]
    InteractionRequired(String),
    #[error("{0}")]
    Failed(String),
}

// Rust 錯誤一律序列化成純字串，前端用 extractErrorMessage 正規化。
impl serde::Serialize for AzureUserAuthError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// 顯示在設定頁的已登入帳號。所有身分欄位都可能缺——不同 tenant／帳號類型
/// 發出的 id_token claim 組合並不一致，不可假設任何一個必然存在。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AzureUserAccount {
    /// preferred_username / upn / sub，取第一個有值的
    pub username: Option<String>,
    pub name: Option<String>,
    pub tenant_id: String,
    /// 綁定用：帳號狀態必須同時對應 tenant + client，否則改了 client id 會誤判已登入
    pub client_id: String,
}

/// 存進 OS 憑證庫的內容。
#[derive(Serialize, Deserialize)]
pub struct StoredSession {
    pub refresh_token: String,
    pub account: AzureUserAccount,
}

pub fn account_key(tenant_id: &str, client_id: &str) -> String {
    format!("azure-user::{tenant_id}::{client_id}")
}

// ── 識別碼驗證（安全關鍵）─────────────────────────────────

/// 8-4-4-4-12 的 GUID 形式。
fn is_guid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    bytes.iter().enumerate().all(|(i, b)| match i {
        8 | 13 | 18 | 23 => *b == b'-',
        _ => b.is_ascii_hexdigit(),
    })
}

/// domain 形式的 tenant（例如 `contoso.onmicrosoft.com`）。
fn is_domain_like_tenant(value: &str) -> bool {
    if value.is_empty() || value.len() > 253 || !value.contains('.') || value.contains("..") {
        return false;
    }
    if value.starts_with(['-', '.']) || value.ends_with(['-', '.']) {
        return false;
    }
    value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
}

/// 驗證 tenant 識別碼。**這是安全檢查，不是輸入便利性檢查。**
///
/// `tenant_id` 會被直接拼進 authorize / token URL 的 **path** 段。若允許
/// `?`、`#`、`/` 等字元，攻擊者可用被竄改的設定備份把整個授權請求改寫成
/// 自己的 `client_id` / `redirect_uri` / `scope`——而 host 仍然是真正的
/// `login.microsoftonline.com`（合法憑證、真實的同意畫面），我方原本的參數
/// 則被推進 fragment 永不送出。使用者恰好在「預期出現 Microsoft 登入」的
/// 時機看到真實同意畫面，同意後 authorization code 就落到攻擊者手上。
///
/// 因此採白名單：GUID、已知別名，或 domain 形式，其餘一律拒絕。
pub fn validate_tenant_id(value: &str) -> Result<(), AzureUserAuthError> {
    let ok = is_guid(value)
        || matches!(value, "common" | "organizations" | "consumers")
        || is_domain_like_tenant(value);
    if ok {
        Ok(())
    } else {
        Err(AzureUserAuthError::InvalidTenantId)
    }
}

/// client_id 一律要求 GUID。除了同樣避免 URL 注入，也保證它不會撞到
/// `account_key()` 的 `::` 分隔符而讓不同設定對應到同一筆憑證庫項目。
pub fn validate_client_id(value: &str) -> Result<(), AzureUserAuthError> {
    if is_guid(value) {
        Ok(())
    } else {
        Err(AzureUserAuthError::InvalidClientId)
    }
}

// ── PKCE ────────────────────────────────────────────────────

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce() -> Result<Pkce, AzureUserAuthError> {
    let verifier = random_url_safe(32)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Ok(Pkce {
        verifier,
        challenge,
    })
}

pub fn random_url_safe(bytes: usize) -> Result<String, AzureUserAuthError> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf)
        .map_err(|e| AzureUserAuthError::Failed(format!("failed to generate randomness: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

// ── Authorize URL ───────────────────────────────────────────

fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub fn build_authorize_url(
    tenant_id: &str,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    nonce: &str,
    challenge: &str,
) -> String {
    let params = [
        ("client_id", client_id),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("response_mode", "query"),
        ("scope", AUTHORIZE_SCOPE),
        ("state", state),
        ("nonce", nonce),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        // 讓使用者能選擇要用哪個帳號（同時避免靜默沿用瀏覽器既有的錯誤帳號）
        ("prompt", "select_account"),
    ]
    .iter()
    .map(|(k, v)| format!("{k}={}", percent_encode(v)))
    .collect::<Vec<_>>()
    .join("&");

    format!("https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize?{params}")
}

// ── Loopback callback ───────────────────────────────────────

pub struct CallbackResult {
    pub code: String,
}

/// 解析 HTTP request 首行的 query 參數。非預期路徑回 `None`（呼叫端應回 404 並繼續等）。
fn parse_callback_query(request_line: &str) -> Option<Vec<(String, String)>> {
    let target = request_line.split_whitespace().nth(1)?;
    // redirect_uri 不帶路徑，因此只接受 "/" 與 "/?..."
    let query = match target.split_once('?') {
        Some(("/", q)) => q,
        Some(_) => return None,
        None if target == "/" => "",
        None => return None,
    };
    Some(
        query
            .split('&')
            .filter(|s| !s.is_empty())
            .filter_map(|pair| {
                let (k, v) = pair.split_once('=')?;
                Some((url_decode(k), url_decode(v)))
            })
            .collect(),
    )
}

fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn response_page(title: &str, body: &str) -> String {
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head>\
<body style=\"font-family:system-ui;padding:48px;background:#111;color:#eee\">\
<h2>{title}</h2><p>{body}</p></body></html>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    )
}

const NOT_FOUND_RESPONSE: &str =
    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

/// 讀出 HTTP request line（首行）。
///
/// **不能假設一次 `read()` 就拿到完整首行**：TCP 是位元組流，request 被分段
/// 送達時，只讀一次會拿到半截 URL，於是把真正的 callback 當成無效請求回 404。
/// 瀏覽器不會重送，使用者就只能乾等五分鐘逾時。因此持續讀到 `\r\n` 為止，
/// 並以總長與 deadline 雙重設限，避免慢速/惡意連線把流程拖住。
async fn read_request_line(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let deadline = tokio::time::Instant::now() + SOCKET_READ_TIMEOUT;

    loop {
        if let Some(pos) = buf.windows(2).position(|w| w == b"\r\n") {
            return Some(String::from_utf8_lossy(&buf[..pos]).into_owned());
        }
        if buf.len() >= MAX_REQUEST_BYTES {
            return None;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match tokio::time::timeout(remaining, stream.read(&mut chunk)).await {
            // 對端關閉且尚未讀到 CRLF
            Ok(Ok(0)) => return None,
            Ok(Ok(n)) => buf.extend_from_slice(&chunk[..n]),
            _ => return None,
        }
    }
}

/// 循環接受連線直到收到合法 callback。
///
/// 刻意不在第一個連線就結束：瀏覽器的預連線、favicon 請求或安全軟體的探測
/// 都可能先佔用一次 accept，只接一次會直接漏掉真正的授權回呼。
pub async fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
    success_title: &str,
    success_body: &str,
) -> Result<CallbackResult, AzureUserAuthError> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| AzureUserAuthError::Failed(format!("callback accept failed: {e}")))?;

        let Some(first_line) = read_request_line(&mut stream).await else {
            // 讀不到完整首行就放掉這條連線，繼續等下一個
            continue;
        };
        let Some(params) = parse_callback_query(&first_line) else {
            let _ = stream.write_all(NOT_FOUND_RESPONSE.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        };

        let get = |key: &str| {
            params
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.clone())
        };

        // state 不符 → 可能是舊分頁重放或 CSRF；不結束流程，繼續等正確的回呼
        if get("state").as_deref() != Some(expected_state) {
            let _ = stream.write_all(NOT_FOUND_RESPONSE.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        }

        if let Some(error) = get("error") {
            let description = get("error_description").unwrap_or_default();
            let _ = stream
                .write_all(response_page("登入失敗", "可以關閉這個分頁，回到 SayIt。").as_bytes())
                .await;
            let _ = stream.shutdown().await;
            let detail = description.lines().next().unwrap_or("").to_string();
            // `access_denied` 同時代表兩件事：使用者自己按了取消，以及
            // Conditional Access 之類的政策擋下。只有前者沒有 error_description，
            // 後者會帶 AADSTS 說明——若一律當成「已取消」，被公司政策擋下的
            // 使用者會以為是自己取消，完全不知道該去找 IT。
            return Err(if error == "access_denied" && detail.is_empty() {
                AzureUserAuthError::Cancelled
            } else if error == "access_denied" {
                AzureUserAuthError::PolicyDenied(detail)
            } else {
                AzureUserAuthError::Failed(format!("{error}: {detail}"))
            });
        }

        let Some(code) = get("code") else {
            let _ = stream.write_all(NOT_FOUND_RESPONSE.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        };

        let _ = stream
            .write_all(response_page(success_title, success_body).as_bytes())
            .await;
        let _ = stream.shutdown().await;
        return Ok(CallbackResult { code });
    }
}

pub fn sign_in_timeout() -> Duration {
    SIGN_IN_TIMEOUT
}

/// 綁 `127.0.0.1:0` 取得臨時 port。**必須在開瀏覽器之前完成**，否則 redirect
/// 可能早於 listener 就緒。
pub async fn bind_loopback() -> Result<(TcpListener, String), AzureUserAuthError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AzureUserAuthError::Failed(format!("failed to bind loopback: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AzureUserAuthError::Failed(format!("failed to read local addr: {e}")))?
        .port();
    // 不帶路徑：App Registration 註冊的是 http://127.0.0.1，帶路徑會被 Entra 拒絕
    Ok((listener, format!("http://127.0.0.1:{port}")))
}

// ── 開瀏覽器 ────────────────────────────────────────────────

/// 用系統預設瀏覽器開啟授權頁。
///
/// 沿用專案既有做法（`logging::open_log_folder`）用 `std::process::Command` 直接
/// spawn，argv 直傳、**不經 shell**。Windows 特意用 `rundll32` 而非
/// `cmd /c start`：後者會把 URL 裡的 `&` 當成命令分隔符，導致只送出第一個
/// query 參數，Entra 會回 AADSTS900144。
pub fn open_in_browser(url: &str) -> Result<(), AzureUserAuthError> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .spawn()
            .map_err(|e| AzureUserAuthError::Failed(format!("failed to open browser: {e}")))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| AzureUserAuthError::Failed(format!("failed to open browser: {e}")))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| AzureUserAuthError::Failed(format!("failed to open browser: {e}")))?;
    }

    Ok(())
}

// ── id_token ────────────────────────────────────────────────

#[derive(Deserialize)]
struct IdTokenClaims {
    aud: Option<String>,
    tid: Option<String>,
    nonce: Option<String>,
    preferred_username: Option<String>,
    upn: Option<String>,
    name: Option<String>,
    sub: Option<String>,
}

/// 從 id_token 取出顯示用的帳號資訊。
///
/// **刻意不驗簽**：這個 id_token 是我們自己剛從 token endpoint 經 HTTPS 取得、
/// 且受 PKCE 與 nonce 綁定，並非來自不受信任的來源；claims 也只拿來顯示，
/// 不用於任何授權決策。仍然檢查 aud/tid/nonce 以確保回應對應到本次請求。
pub fn parse_account_from_id_token(
    id_token: &str,
    tenant_id: &str,
    client_id: &str,
    expected_nonce: &str,
) -> Result<AzureUserAccount, AzureUserAuthError> {
    let payload = id_token
        .split('.')
        .nth(1)
        .ok_or_else(|| AzureUserAuthError::Failed("malformed id_token".to_string()))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|e| AzureUserAuthError::Failed(format!("failed to decode id_token: {e}")))?;
    let claims: IdTokenClaims = serde_json::from_slice(&decoded)
        .map_err(|e| AzureUserAuthError::Failed(format!("failed to parse id_token: {e}")))?;

    if claims.aud.as_deref() != Some(client_id) {
        return Err(AzureUserAuthError::Failed(
            "id_token audience mismatch".to_string(),
        ));
    }
    if let Some(tid) = claims.tid.as_deref() {
        if !tid.eq_ignore_ascii_case(tenant_id) {
            return Err(AzureUserAuthError::Failed(
                "id_token tenant mismatch".to_string(),
            ));
        }
    }
    // nonce 缺席時不硬性失敗（少數設定不回傳），但有值就必須相符
    if let Some(nonce) = claims.nonce.as_deref() {
        if nonce != expected_nonce {
            return Err(AzureUserAuthError::Failed(
                "id_token nonce mismatch".to_string(),
            ));
        }
    }

    Ok(AzureUserAccount {
        username: claims
            .preferred_username
            .or(claims.upn)
            .or(claims.sub.clone()),
        name: claims.name,
        tenant_id: tenant_id.to_string(),
        client_id: client_id.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_sha256_of_verifier() {
        let pkce = generate_pkce().unwrap();
        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(pkce.verifier.as_bytes()));
        assert_eq!(pkce.challenge, expected);
        // base64url 不可含 padding 或非 URL-safe 字元
        assert!(!pkce.challenge.contains('='));
        assert!(!pkce.challenge.contains('+'));
        assert!(!pkce.challenge.contains('/'));
    }

    #[test]
    fn pkce_verifier_is_unique_per_call() {
        assert_ne!(
            generate_pkce().unwrap().verifier,
            generate_pkce().unwrap().verifier
        );
    }

    #[test]
    fn scope_kind_maps_to_fixed_scopes() {
        assert_eq!(
            ScopeKind::parse("chat").unwrap().scope(),
            "https://ai.azure.com/.default"
        );
        assert_eq!(
            ScopeKind::parse("whisper").unwrap().scope(),
            "https://cognitiveservices.azure.com/.default"
        );
        // 前端不得指定任意 audience
        assert!(ScopeKind::parse("https://evil.example.com/.default").is_none());
        assert!(ScopeKind::parse("").is_none());
    }

    #[test]
    fn authorize_url_encodes_parameters() {
        let url = build_authorize_url(
            "tenant",
            "client",
            "http://127.0.0.1:1234",
            "st/ate+",
            "nonce",
            "chal",
        );
        assert!(url.starts_with("https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1234"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=st%2Fate%2B"));
        // scope 內的空白必須編碼，否則 URL 會被截斷
        assert!(!url.contains("offline_access openid"));
        assert!(url.contains("offline_access%20openid%20profile"));
    }

    #[test]
    fn callback_accepts_path_less_redirect_only() {
        // App Registration 註冊的是 http://127.0.0.1（無路徑），帶路徑會被 Entra 拒絕，
        // 所以 listener 也只接受根路徑。
        assert!(parse_callback_query("GET /?code=abc&state=xyz HTTP/1.1").is_some());
        assert!(parse_callback_query("GET / HTTP/1.1").is_some());
        assert!(parse_callback_query("GET /callback?code=abc HTTP/1.1").is_none());
        assert!(parse_callback_query("GET /favicon.ico HTTP/1.1").is_none());
    }

    #[test]
    fn callback_decodes_percent_encoded_values() {
        let params = parse_callback_query("GET /?code=a%2Fb%2Bc&state=x%20y HTTP/1.1").unwrap();
        let get = |k: &str| {
            params
                .iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.clone())
                .unwrap()
        };
        assert_eq!(get("code"), "a/b+c");
        assert_eq!(get("state"), "x y");
    }

    fn make_id_token(claims: serde_json::Value) -> String {
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        format!("header.{payload}.signature")
    }

    #[test]
    fn parses_account_from_full_claims() {
        let token = make_id_token(serde_json::json!({
            "aud": "client", "tid": "tenant", "nonce": "n1",
            "preferred_username": "user@contoso.com", "name": "User Name", "sub": "s"
        }));
        let account = parse_account_from_id_token(&token, "tenant", "client", "n1").unwrap();
        assert_eq!(account.username.as_deref(), Some("user@contoso.com"));
        assert_eq!(account.name.as_deref(), Some("User Name"));
        assert_eq!(account.client_id, "client");
    }

    #[test]
    fn tolerates_missing_optional_claims() {
        // 不同帳號類型的 claim 組合不一致——缺 preferred_username / name 不該失敗
        let token = make_id_token(serde_json::json!({
            "aud": "client", "tid": "tenant", "sub": "subject-id"
        }));
        let account = parse_account_from_id_token(&token, "tenant", "client", "n1").unwrap();
        assert_eq!(account.username.as_deref(), Some("subject-id"));
        assert_eq!(account.name, None);
    }

    #[test]
    fn falls_back_to_upn_when_preferred_username_missing() {
        let token = make_id_token(serde_json::json!({
            "aud": "client", "tid": "tenant", "upn": "upn@contoso.com"
        }));
        let account = parse_account_from_id_token(&token, "tenant", "client", "n1").unwrap();
        assert_eq!(account.username.as_deref(), Some("upn@contoso.com"));
    }

    #[test]
    fn rejects_audience_tenant_and_nonce_mismatch() {
        let wrong_aud = make_id_token(serde_json::json!({ "aud": "other", "tid": "tenant" }));
        assert!(parse_account_from_id_token(&wrong_aud, "tenant", "client", "n1").is_err());

        let wrong_tid = make_id_token(serde_json::json!({ "aud": "client", "tid": "other" }));
        assert!(parse_account_from_id_token(&wrong_tid, "tenant", "client", "n1").is_err());

        let wrong_nonce =
            make_id_token(serde_json::json!({ "aud": "client", "tid": "tenant", "nonce": "bad" }));
        assert!(parse_account_from_id_token(&wrong_nonce, "tenant", "client", "n1").is_err());
    }

    #[test]
    fn tenant_comparison_is_case_insensitive() {
        let token = make_id_token(serde_json::json!({ "aud": "client", "tid": "ABC-DEF" }));
        assert!(parse_account_from_id_token(&token, "abc-def", "client", "n1").is_ok());
    }

    #[test]
    fn account_key_binds_tenant_and_client() {
        assert_ne!(account_key("t", "c1"), account_key("t", "c2"));
        assert_ne!(account_key("t1", "c"), account_key("t2", "c"));
    }

    /// 用真的 TcpStream 把 callback 拆成多段送出，驗證不會因為 TCP 分段而漏掉。
    async fn callback_over_fragmented_stream(
        chunks: &[&str],
        expected_state: &str,
    ) -> Result<CallbackResult, AzureUserAuthError> {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let owned: Vec<String> = chunks.iter().map(|s| s.to_string()).collect();

        tokio::spawn(async move {
            let mut client = tokio::net::TcpStream::connect(addr).await.unwrap();
            for chunk in owned {
                client.write_all(chunk.as_bytes()).await.unwrap();
                client.flush().await.unwrap();
                // 強制分段抵達，而非被合併成一個 segment
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            let mut sink = Vec::new();
            let _ = client.read_to_end(&mut sink).await;
        });

        tokio::time::timeout(
            Duration::from_secs(5),
            wait_for_callback(&listener, expected_state, "ok", "ok"),
        )
        .await
        .expect("wait_for_callback should not hang on fragmented input")
    }

    #[tokio::test]
    async fn accepts_callback_split_across_tcp_segments() {
        // TCP 不保證一次 read 就拿到完整首行。舊實作只讀一次，分段時會把真正的
        // callback 當成無效請求回 404——瀏覽器不會重送，使用者只能等五分鐘逾時。
        let result = callback_over_fragmented_stream(
            &[
                "GET /?code=frag",
                "mented-code&state=st",
                "ate-value HTTP/1.1\r\n",
                "Host: 127.0.0.1\r\n\r\n",
            ],
            "state-value",
        )
        .await
        .expect("fragmented callback must be accepted");
        assert_eq!(result.code, "fragmented-code");
    }

    #[tokio::test]
    async fn accepts_callback_delivered_byte_by_byte() {
        let line = "GET /?code=slow&state=s1 HTTP/1.1\r\n\r\n";
        let chunks: Vec<String> = line.chars().map(|c| c.to_string()).collect();
        let refs: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
        let result = callback_over_fragmented_stream(&refs, "s1")
            .await
            .expect("byte-by-byte callback must be accepted");
        assert_eq!(result.code, "slow");
    }

    #[test]
    fn accepts_legitimate_tenant_and_client_ids() {
        for tenant in [
            "2aeb30d9-f0a6-4e27-8c47-f97c5b695eb6",
            "2AEB30D9-F0A6-4E27-8C47-F97C5B695EB6",
            "common",
            "organizations",
            "consumers",
            "contoso.onmicrosoft.com",
            "contoso.com",
        ] {
            assert!(
                validate_tenant_id(tenant).is_ok(),
                "should accept tenant {tenant}"
            );
        }
        assert!(validate_client_id("1671ffd4-5c2a-44dd-83a2-e1c8267aa51b").is_ok());
    }

    #[test]
    fn rejects_tenant_ids_that_could_rewrite_the_authorize_request() {
        // tenant_id 被拼進 URL 的 path：含 `?` / `#` 就能把整個授權請求換成
        // 攻擊者的 client_id / redirect_uri / scope，而 host 仍是真的
        // login.microsoftonline.com（使用者會看到貨真價實的同意畫面）。
        let payload = "00000000-1111-2222-3333-444444444444/oauth2/v2.0/authorize\
?client_id=ATTACKER&redirect_uri=https%3A%2F%2Fevil.example%2Fcb#";
        assert!(validate_tenant_id(payload).is_err());

        for tenant in [
            "",
            "tenant/../other",
            "tenant?x=1",
            "tenant#frag",
            "tenant\\evil",
            "tenant%2F",
            "tenant with space",
            "tenant:8080",
            "tenant@evil",
            // 未含點的裸字串不是合法 domain 形式，也不是 GUID/別名
            "nodot",
            // GUID 長度或分隔符不對
            "2aeb30d9f0a64e278c47f97c5b695eb6",
            "2aeb30d9-f0a6-4e27-8c47-f97c5b695eb",
            "..",
            ".contoso.com",
            "contoso..com",
        ] {
            assert!(
                validate_tenant_id(tenant).is_err(),
                "should reject tenant {tenant:?}"
            );
        }
    }

    #[test]
    fn client_id_must_be_a_guid() {
        // 非 GUID 除了 URL 注入風險，也可能撞到 account_key 的 `::` 分隔符，
        // 讓不同設定對應到同一筆憑證庫項目
        for client in [
            "",
            "not-a-guid",
            "contoso.com",
            "common",
            "a::b",
            "1671ffd4-5c2a-44dd-83a2-e1c8267aa51",
        ] {
            assert!(
                validate_client_id(client).is_err(),
                "should reject client {client:?}"
            );
        }
    }
}
