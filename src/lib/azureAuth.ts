import { invoke } from "@tauri-apps/api/core";

// ── Entra ID（App Registration / client credentials）認證 ──────
//
// Azure / Microsoft Foundry 資源常設 disableLocalAuth=true（僅 Entra），
// 因此需以 service principal 換取 bearer token 呼叫資料面 REST。
// token 約 60–90 分到期且無 refresh token，過期後重打即可，這裡做記憶體快取。

export interface AzureEntraCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

// Entra token scope（受眾）依「呼叫的 API 路徑」決定，而非 endpoint host：
//  - v1 推論路徑（/openai/v1/...，本專案 chat 整理）→ ai.azure.com 受眾
//  - 傳統 deployments 資料面（/openai/deployments/.../audio/transcriptions?api-version=，
//    本專案 Whisper 轉錄）→ cognitiveservices.azure.com 受眾
// 同一個 Foundry / Azure OpenAI 資源上，這兩條路徑各自要求不同受眾，
// 因此不能用 host 推導（否則其中一條路徑會拿到錯受眾的 token 而 401）。
export const AZURE_SCOPE_FOUNDRY = "https://ai.azure.com/.default";
export const AZURE_SCOPE_COGNITIVE =
  "https://cognitiveservices.azure.com/.default";

export type AzureApiKind = "chat" | "whisper";

/**
 * 依呼叫的 API 種類選擇 Entra token scope：
 *  - "chat"（v1 路徑 /openai/v1/）→ ai.azure.com 受眾
 *  - "whisper"（傳統 deployments 路徑）→ cognitiveservices 受眾
 */
export function getAzureScopeForApiKind(kind: AzureApiKind): string {
  return kind === "chat" ? AZURE_SCOPE_FOUNDRY : AZURE_SCOPE_COGNITIVE;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const tokenCache = new Map<string, CachedToken>();
// 提前 60 秒刷新，避免邊界期 token 剛好失效
const EXPIRY_BUFFER_MS = 60_000;

function buildCacheKey(
  credentials: AzureEntraCredentials,
  scope: string,
): string {
  return `${credentials.tenantId}|${credentials.clientId}|${scope}`;
}

interface AzureTokenResult {
  accessToken: string;
  expiresIn: number;
}

export async function getAzureAccessToken(
  credentials: AzureEntraCredentials,
  scope: string,
): Promise<string> {
  if (
    !credentials.tenantId ||
    !credentials.clientId ||
    !credentials.clientSecret
  ) {
    throw new Error("Entra credentials incomplete");
  }

  const cacheKey = buildCacheKey(credentials, scope);
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - EXPIRY_BUFFER_MS > now) {
    return cached.accessToken;
  }

  // 透過 Rust（reqwest）取 token，而非 WebView fetch：WebView 會帶 Origin
  // header，Entra 會以 AADSTS9002326 拒絕瀏覽器來源的 client_credentials
  // token redemption（cross-origin redemption 僅限 SPA client-type）。
  const result = await invoke<AzureTokenResult>("get_azure_entra_token", {
    tenantId: credentials.tenantId,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    scope,
  });

  tokenCache.set(cacheKey, {
    accessToken: result.accessToken,
    expiresAtMs: now + result.expiresIn * 1000,
  });

  return result.accessToken;
}

/** 憑證變更或刪除時呼叫，清掉舊 token 快取。 */
export function clearAzureTokenCache(): void {
  tokenCache.clear();
}
