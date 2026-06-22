use serde::{Deserialize, Serialize};

// Entra ID（client credentials）取 bearer token。
//
// 必須在 Rust（reqwest）端發出，而非前端 WebView：WebView 的 fetch 會帶
// Origin header（dev 時為 http://localhost:1420），Entra 會以
// AADSTS9002326（cross-origin token redemption 僅限 SPA client-type）拒絕
// confidential client 的 client_credentials 請求。reqwest 不帶 Origin。

const TOKEN_REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureTokenResult {
    pub access_token: String,
    pub expires_in: u64,
}

#[derive(Deserialize)]
struct AadTokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct AadError {
    error: Option<String>,
    error_description: Option<String>,
}

#[tauri::command]
pub async fn get_azure_entra_token(
    tenant_id: String,
    client_id: String,
    client_secret: String,
    scope: String,
) -> Result<AzureTokenResult, String> {
    let tenant = tenant_id.trim();
    let client = client_id.trim();
    if tenant.is_empty() || client.is_empty() || client_secret.trim().is_empty() {
        return Err("Entra credentials incomplete".to_string());
    }

    let token_url = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token");

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TOKEN_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let params = [
        ("grant_type", "client_credentials"),
        ("client_id", client),
        ("client_secret", client_secret.as_str()),
        ("scope", scope.as_str()),
    ];

    let response = http
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Azure Entra token request failed: {e}"))?;

    let status = response.status();
    let raw = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "Azure Entra token request failed: {}{}",
            status.as_u16(),
            format_aad_detail(&raw)
        ));
    }

    let parsed: AadTokenResponse = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse Entra token response: {e}"))?;
    let access_token = parsed
        .access_token
        .ok_or_else(|| "No access_token in Entra response".to_string())?;

    Ok(AzureTokenResult {
        access_token,
        expires_in: parsed.expires_in.unwrap_or(3600),
    })
}

/// 從 Entra 錯誤回應取出可讀的 AADSTS 說明（不含機密）。
fn format_aad_detail(body: &str) -> String {
    if body.is_empty() {
        return String::new();
    }
    if let Ok(err) = serde_json::from_str::<AadError>(body) {
        if let Some(desc) = err.error_description.or(err.error) {
            let first_line = desc.lines().next().unwrap_or("");
            let snippet: String = first_line.chars().take(300).collect();
            return format!(" — {snippet}");
        }
    }
    let snippet: String = body.chars().take(200).collect();
    format!(" — {snippet}")
}
